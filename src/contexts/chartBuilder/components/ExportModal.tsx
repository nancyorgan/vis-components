import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	downloadVisualsBundle,
	sanitizeVisualFilename,
} from "../lib/downloadVisuals"
import { upsertEmbedInstance } from "../lib/embedInstances"
import {
	DEFAULT_EXPORT_HEIGHT,
	DEFAULT_EXPORT_WIDTH,
	DEFAULT_PIXEL_RATIO,
	MAX_EXPORT_DIM,
	MIN_EXPORT_DIM,
	clampExportDim,
	clampPixelRatio,
	renderExport,
} from "../lib/exportImage"
import type { ImageFormat } from "../lib/exportImage"
import {
	pxToUnit,
	unitToPx,
	UNIT_OPTIONS,
	UNIT_STEP,
} from "../lib/displayUnits"
import { pickSaveTarget, writeSaveTarget } from "../lib/saveFile"
import type { SaveFileType } from "../lib/saveFile"
import type { ExportUnit } from "../lib/storage"
import { getStorageAdapter } from "../lib/storage/registry"
import {
	currentChannelConfigsAtom,
	currentDataTableConfigAtom,
	embedInstancesAtom,
	exportSizesAtom,
	exportUnitAtom,
	visualsAtom,
} from "../store/atoms"
import { migrateDataTableConfig } from "../lib/dataTableConfig"
import { usePublishEmbed, useUnpublishEmbed } from "../store/publishEmbed"
import { useCurrentDatasetView } from "../store/useCurrentDatasetView"
import { useEffectiveGeographyLevel } from "../store/useEffectiveGeographyLevel"
import { EXPORT_TABLE_HEIGHT_MESSAGE } from "./viz/DataTableBlock"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"
import { NumberInput } from "../../../components/ui/NumberInput"
import { Select } from "../../../components/ui/Select"
import { Textarea } from "../../../components/ui/Input"

type Props = {
	open: boolean
	onClose: () => void
	visualId: string | null
}

type PinMode = "live" | "pinned"
type Tab = "embed" | "export"

/** What the Save-as dialog offers for each format. The first extension is
 *  the one the suggested filename carries. */
const IMAGE_FILE_TYPES: Record<ImageFormat, SaveFileType> = {
	png: { description: "PNG image", mimeType: "image/png", extensions: [".png"] },
	jpeg: {
		description: "JPEG image",
		mimeType: "image/jpeg",
		extensions: [".jpg", ".jpeg"],
	},
	svg: {
		description: "SVG image",
		mimeType: "image/svg+xml",
		extensions: [".svg"],
	},
	pdf: {
		description: "PDF document",
		mimeType: "application/pdf",
		extensions: [".pdf"],
	},
}

const FORMAT_OPTIONS: Array<{ value: ImageFormat; label: string }> = [
	{ value: "png", label: "PNG" },
	{ value: "jpeg", label: "JPEG" },
	{ value: "svg", label: "SVG" },
	{ value: "pdf", label: "PDF" },
]

const RESOLUTION_OPTIONS = [1, 2, 3, 4]

// Fallback iframe dimensions for the embed snippets, used only when the
// on-screen chart / legend can't be measured (e.g. modal opened before the
// chart mounted).
const EMBED_FALLBACK_FULL = { width: 800, height: 500 }
const EMBED_FALLBACK_CHART = { width: 650, height: 400 }
const EMBED_FALLBACK_LEGEND = { width: 220, height: 400 }

// Horizontal chrome inside the panel around the preview image: modal content
// padding (p-4 → 16px each side) plus the preview box padding (p-3 → 12px each
// side) plus its border. Used to cap the image width to the panel's slot.
const PREVIEW_CHROME_X = 58
// Space reserved for everything above and below the preview image (title,
// tabs, controls row, buttons, gaps, paddings, preview-box padding — measured
// at 312px) PLUS the backdrop's py-6 and breathing room to the viewport
// bottom, when capping the image height. Too small and the top-anchored popup
// grows past the bottom of the screen.
const PREVIEW_CHROME_Y = 380
// Breathing room kept between the popup's slot and the viewport edges.
const VIEWPORT_MARGIN = 48
// The export tab's SLOT — the fixed, viewport-derived layout box the popup is
// pinned to the top-left of — spans the viewport, so the preview can show at
// TRUE SIZE all the way to the screen's right edge. The popup resizes with
// the preview inside it, growing DOWN and to the RIGHT only, so the controls
// (pinned to the top-left) never move and the drag handles track the cursor
// 1:1. ANCHOR_WIDTH sets where the pinned left edge sits: where a centered
// popup of that width would start, so a small popup doesn't hug the screen's
// left edge.
const MIN_PANEL_WIDTH = 420
const ANCHOR_WIDTH = 960
// Content width of the Embed tab (the panel hugs its content in fitWidth
// mode, and prose would otherwise stretch it to the slot).
const EMBED_TAB_WIDTH = 640

/** Measure an on-screen element's rendered size, clamped to the export
 *  bounds. Returns integer px dims, or `null` when the element is absent or
 *  not yet sized. Used to seed export/embed dimensions from what the user
 *  sees on screen. */
const measureElementSize = (
	selector: string
): { width: number; height: number } | null => {
	if (typeof document === "undefined") return null
	const el = document.querySelector<HTMLElement>(selector)
	if (!el) return null
	// Layout size, not the bounding rect: on a phone the fixed canvas is
	// shrunk with a CSS transform (EditorLayout), and the export must
	// default to the size the chart actually laid out at.
	const rect = { width: el.offsetWidth, height: el.offsetHeight }
	if (rect.width < MIN_EXPORT_DIM || rect.height < MIN_EXPORT_DIM) return null
	const clamp = (n: number) =>
		Math.min(MAX_EXPORT_DIM, Math.max(MIN_EXPORT_DIM, Math.round(n)))
	return { width: clamp(rect.width), height: clamp(rect.height) }
}

/** The editor's on-screen chart area (the container that wraps
 *  `<ChartCanvas>`, tagged `data-editor-chart-viewport` in EditorLayout).
 *  Seeds the export dimensions so the exported layout matches what the user
 *  sees. */
const measureEditorChartSize = () =>
	measureElementSize("[data-editor-chart-viewport]")

/** Track the viewport size so the export preview can scale down to fit. */
const useViewportSize = () => {
	const [size, setSize] = useState(() => ({
		w: typeof window === "undefined" ? 1024 : window.innerWidth,
		h: typeof window === "undefined" ? 768 : window.innerHeight,
	}))
	useEffect(() => {
		const onResize = () =>
			setSize({ w: window.innerWidth, h: window.innerHeight })
		window.addEventListener("resize", onResize)
		return () => window.removeEventListener("resize", onResize)
	}, [])
	return size
}

export const ExportModal = ({ open, onClose, visualId }: Props) => {
	const [tab, setTab] = useState<Tab>("export")
	const [width, setWidth] = useState(DEFAULT_EXPORT_WIDTH)
	const [height, setHeight] = useState(DEFAULT_EXPORT_HEIGHT)
	const [aspectLocked, setAspectLocked] = useState(false)
	// Frozen aspect ratio used while the lock is engaged. Re-captured on lock.
	const ratioRef = useRef<number>(DEFAULT_EXPORT_WIDTH / DEFAULT_EXPORT_HEIGHT)
	const viewport = useViewportSize()
	const exportSizes = useAtomValue(exportSizesAtom)
	// The modal always opens for the CURRENT visual (SaveBar), so the current
	// channel configs are this visual's. A fixed canvas size prescribes the
	// export dimensions outright — see the open effect below.
	const canvasSizeCfg = useAtomValue(currentChannelConfigsAtom).canvasSize
	const fixedCanvas = canvasSizeCfg?.enabled ? canvasSizeCfg : null
	const setUnit = useSetAtom(exportUnitAtom)
	// "Include data table" (offered only while the visual has a table on):
	// the image is the chart at the chosen size with the table added below,
	// so the preview grows by the table's height, which the embed reports.
	const hasDataTable = migrateDataTableConfig(
		useAtomValue(currentDataTableConfigAtom)
	).enabled
	const [includeTableChoice, setIncludeTable] = useState(false)
	const includeTable = hasDataTable && includeTableChoice
	const [tableHeight, setTableHeight] = useState(0)
	const extraHeight = includeTable ? tableHeight : 0

	useEffect(() => {
		if (aspectLocked) ratioRef.current = width / height
	}, [aspectLocked, width, height])

	// On open, seed the export size. A fixed canvas size (Aesthetics → Canvas
	// size) wins outright — the user prescribed exact dimensions, so exports
	// carry them through (including the unit they were set in), regardless of
	// what any previous export used. Otherwise restore the size this visual
	// was last exported at; with no saved size, default to the editor's
	// CURRENT on-screen chart size (not a fixed 650×400): the export embed
	// then solves the same layout, so absolute-pixel title offsets export
	// exactly where the user placed them. Falls back to the fixed default
	// only when the editor chart isn't measurable (e.g. modal opened before
	// the chart mounted).
	//
	// Seeds ONCE per open (the ref): the effect's deps also change post-export
	// (exportSizes) and on config edits, and re-seeding then would snap a size
	// the user tweaked inside the modal back to the canvas dims.
	const seededRef = useRef(false)
	useEffect(() => {
		if (!open) {
			seededRef.current = false
			return
		}
		if (!visualId || seededRef.current) return
		seededRef.current = true
		const saved = exportSizes[visualId]
		if (fixedCanvas) {
			setWidth(clampExportDim(fixedCanvas.width))
			setHeight(clampExportDim(fixedCanvas.height))
			setAspectLocked(saved?.aspectLocked ?? false)
			setUnit(fixedCanvas.unit ?? "px")
			return
		}
		const editorSize = saved ? null : measureEditorChartSize()
		setWidth(saved?.width ?? editorSize?.width ?? DEFAULT_EXPORT_WIDTH)
		setHeight(saved?.height ?? editorSize?.height ?? DEFAULT_EXPORT_HEIGHT)
		setAspectLocked(saved?.aspectLocked ?? false)
	}, [open, visualId, exportSizes, fixedCanvas, setUnit])

	if (!visualId) return null

	const onWidthChange = (v: number) => {
		setWidth(v)
		if (aspectLocked && ratioRef.current > 0) {
			setHeight(Math.max(50, Math.round(v / ratioRef.current)))
		}
	}
	const onHeightChange = (v: number) => {
		setHeight(v)
		if (aspectLocked && ratioRef.current > 0) {
			setWidth(Math.max(50, Math.round(v * ratioRef.current)))
		}
	}

	// The popup is pinned to the top-left of a fixed, viewport-spanning slot
	// and resizes WITH the preview — growing down and to the right only, so
	// the preview shows at true size (the window communicates how big the
	// figure is) while the controls above it never move. The image only scales
	// down (never the popup's position) when it physically can't fit between
	// its pinned top-left anchor and the screen's bottom/right edges.
	// On a phone the floor would exceed the screen; there the slot is the
	// viewport less a hair, so the preview scales to what actually fits.
	const slotWidth = Math.max(
		Math.min(MIN_PANEL_WIDTH, viewport.w - 16),
		viewport.w - VIEWPORT_MARGIN
	)
	const anchorOffset = Math.max(0, (slotWidth - ANCHOR_WIDTH) / 2)
	const availW = Math.max(240, slotWidth - anchorOffset - PREVIEW_CHROME_X)
	const availH = Math.max(160, viewport.h - PREVIEW_CHROME_Y)
	const previewScale = Math.min(
		1,
		availW / width,
		availH / (height + extraHeight)
	)

	return (
		// Both tabs use the same pinned top-left slot layout, so switching tabs
		// never moves the popup or the tab row — only the right/bottom edges
		// differ per tab.
		<Modal
			open={open}
			onClose={onClose}
			title="Export this visualization"
			maxWidthPx={slotWidth}
			anchorTop
			fitWidth
			fitWidthOffsetPx={anchorOffset}
		>
			<div className="flex flex-col gap-4">
				<div className="flex items-stretch gap-3 border-b border-stone-200 dark:border-stone-700">
					{/* Not a tab: the JSON bundle downloads straight away, so it sits
					    beside the two panes rather than opening one. Wrapped so the
					    button centers vertically while the tabs stay full height and
					    keep their active underline flush with the row's border. */}
					<div className="flex items-center pb-2">
						<DownloadJsonButton visualId={visualId} />
					</div>
					<TabButton active={tab === "embed"} onClick={() => setTab("embed")}>
						Embed
					</TabButton>
					<TabButton active={tab === "export"} onClick={() => setTab("export")}>
						Export image
					</TabButton>
				</div>
				{tab === "embed" ? (
					// Fixed content width (the panel hugs its content in fitWidth
					// mode): matches the max-w-2xl (672px) panel this tab used to
					// get, minus the panel's p-4 padding.
					<div className="max-w-full" style={{ width: EMBED_TAB_WIDTH }}>
						<EmbedTab visualId={visualId} onClose={onClose} />
					</div>
				) : (
					<ExportTab
						visualId={visualId}
						onClose={onClose}
						width={width}
						height={height}
						aspectLocked={aspectLocked}
						onWidthChange={onWidthChange}
						onHeightChange={onHeightChange}
						onAspectLockedChange={setAspectLocked}
						previewScale={previewScale}
						hasDataTable={hasDataTable}
						includeTable={includeTable}
						onIncludeTableChange={(on) => {
							setIncludeTable(on)
							// The preview reloads; its table reports a fresh height.
							setTableHeight(0)
						}}
						tableHeight={extraHeight}
						onTableHeight={setTableHeight}
					/>
				)}
			</div>
		</Modal>
	)
}

/** Download this visualization as a library bundle (JSON) — the same file
 *  Settings → Sharing writes and imports, so the recipient gets the chart,
 *  its data set, its folder, and its custom theme in one file. Named after
 *  the SAVED visual (an unsaved rename isn't in the bundle either). */
const DownloadJsonButton = ({ visualId }: { visualId: string }) => {
	const visuals = useAtomValue(visualsAtom)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const name = visuals.find((v) => v.id === visualId)?.name ?? "visualization"

	const onDownload = async () => {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			await downloadVisualsBundle([{ id: visualId, name }])
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<Button
				compact
				disabled={busy}
				onClick={() => {
					void onDownload()
				}}
				title="Download this visualization as a JSON bundle someone else can import"
			>
				{busy ? "Downloading…" : "Download JSON"}
			</Button>
			{error !== null && (
				<span className="self-center text-sm text-red-700 dark:text-red-300">
					{error}
				</span>
			)}
		</>
	)
}

const TabButton = ({
	active,
	onClick,
	children,
}: {
	active: boolean
	onClick: () => void
	children: React.ReactNode
}) => (
	<button
		type="button"
		onClick={onClick}
		className={`px-4 py-2 text-sm font-medium transition-colors ${
			active
				? "border-b-2 border-stone-900 text-stone-900 dark:border-white dark:text-white"
				: "hover:text-stone-800 dark:hover:text-white vc-muted"
		}`}
	>
		{children}
	</button>
)

// ---------------------------------------------------------------------------
// Embed tab
// ---------------------------------------------------------------------------

const EmbedTab = ({
	visualId,
	onClose,
}: {
	visualId: string
	onClose: () => void
}) => {
	const view = useCurrentDatasetView()
	const instances = useAtomValue(embedInstancesAtom)
	const setEmbedInstances = useSetAtom(embedInstancesAtom)
	const publishEmbed = usePublishEmbed()
	const unpublishEmbed = useUnpublishEmbed()
	// ZIP-level maps inline their boundary topology into the payload — the
	// published file fetches nothing. Derived here (not in the publish hook)
	// because the effective level is a hook over the live editor atoms.
	const geographyLevel = useEffectiveGeographyLevel()
	// Base for the snippet textareas' ids so each visible label targets its
	// own textarea via htmlFor.
	const snippetIdBase = useId()
	// The iframe's accessible name — the visual's saved name, escaped for an
	// HTML attribute.
	const embedTitleAttr = (
		useAtomValue(visualsAtom).find((v) => v.id === visualId)?.name.trim() ||
		"Chart"
	)
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
	const [mode, setMode] = useState<PinMode>("live")
	const [splitLegend, setSplitLegend] = useState(false)
	const [copied, setCopied] = useState<"main" | "legend" | null>(null)
	const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null)
	const [publishError, setPublishError] = useState<string | null>(null)
	// Unpublishing kills public URLs, so the button asks twice (inline).
	const [confirmUnpublish, setConfirmUnpublish] = useState(false)
	// User-edited snippet text, keyed by snippet. Seeded from the generated
	// value and reset whenever the underlying publish changes, so tweaking
	// dimensions by hand survives until a republish rebuilds the snippet.
	const [drafts, setDrafts] = useState<Record<string, string>>({})
	const [draftsSignature, setDraftsSignature] = useState<string | null>(null)

	// Publishing writes through the self-host server — in a browser-local
	// session there is nowhere to publish to. `remoteLoad` is true exactly
	// when the boot probe found the server and installed the HTTP adapter.
	const canPublish = getStorageAdapter().capabilities.remoteLoad

	// The instance this tab is looking at: one embed per (visual, pin) pair.
	const versionId = mode === "pinned" && view ? view.versionId : null
	const instance = Object.values(instances).find(
		(i) => i.visualId === visualId && i.versionId === versionId
	)
	const published =
		instance?.publishId !== undefined && instance.publishedUrls !== undefined
			? instance
			: null

	// Seed the iframe dimensions from the live on-screen chart so the embed
	// inherits the size the user sees. Measured once when the tab mounts (the
	// editor sits behind the modal, so its DOM is still present); the split
	// "chart" iframe measures the plot area alone and the legend iframe the
	// legend subtree, so each snippet matches its part. Falls back to fixed
	// sizes when a piece can't be measured.
	const embedSizes = useMemo(
		() => ({
			full: measureEditorChartSize() ?? EMBED_FALLBACK_FULL,
			chart:
				measureElementSize("[data-editor-chart-plot]") ?? EMBED_FALLBACK_CHART,
			legend:
				measureElementSize("[data-legend-root]") ?? EMBED_FALLBACK_LEGEND,
		}),
		[]
	)

	// Snippets come from the PUBLISHED urls — there is no URL to offer until
	// a publish has succeeded (0016 rule 4).
	const { snippets, embedUrl } = useMemo(() => {
		const urls = published?.publishedUrls
		if (!urls) {
			return {
				snippets: [] as Array<{
					key: "main" | "legend"
					label: string
					value: string
				}>,
				embedUrl: null as string | null,
			}
		}
		const iframe = (src: string, size: { width: number; height: number }) =>
			`<iframe src="${src}" title="${embedTitleAttr}" width="${size.width}" height="${size.height}" frameborder="0"></iframe>`
		if (urls.full) {
			return {
				snippets: [
					{
						key: "main" as const,
						label: "Iframe",
						value: iframe(urls.full, embedSizes.full),
					},
				],
				embedUrl: urls.full,
			}
		}
		const out: Array<{ key: "main" | "legend"; label: string; value: string }> = []
		if (urls.chart) {
			out.push({
				key: "main",
				label: "Chart iframe",
				value: iframe(urls.chart, embedSizes.chart),
			})
		}
		if (urls.legend) {
			out.push({
				key: "legend",
				label: "Legend iframe",
				value: iframe(urls.legend, embedSizes.legend),
			})
		}
		return { snippets: out, embedUrl: urls.chart ?? urls.legend ?? null }
	}, [published?.publishedUrls, embedSizes, embedTitleAttr])

	// Reset the editable drafts only when the underlying publish changes.
	// Keyed on a stable signature rather than the `snippets` reference so an
	// unrelated store update can't clobber the user's edits. Done during
	// render (React's "adjust state on change" pattern) so the reset lands
	// before paint, no effect.
	const snippetSignature = `${visualId}|${mode}|${published?.publishId ?? ""}|${
		published?.publishedAt ?? ""
	}`
	if (snippetSignature !== draftsSignature) {
		setDraftsSignature(snippetSignature)
		setDrafts(Object.fromEntries(snippets.map((s) => [s.key, s.value])))
		setConfirmUnpublish(false)
	}

	const onPublish = async () => {
		if (busy) return
		setBusy("publish")
		setPublishError(null)
		try {
			await publishEmbed({
				visualId,
				versionId,
				split: splitLegend,
				includeZctaTopology: geographyLevel === "zcta",
			})
		} catch (e) {
			setPublishError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(null)
		}
	}

	const onUnpublish = async () => {
		if (busy || !instance) return
		if (!confirmUnpublish) {
			setConfirmUnpublish(true)
			return
		}
		setBusy("unpublish")
		setPublishError(null)
		try {
			await unpublishEmbed(instance.id)
			setConfirmUnpublish(false)
		} catch (e) {
			setPublishError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(null)
		}
	}

	const onCopy = async (key: "main" | "legend", value: string) => {
		try {
			await globalThis.navigator.clipboard.writeText(value)
			setCopied(key)
			window.setTimeout(() => setCopied(null), 1500)
		} catch {
			// Older browsers — let the user select+copy manually.
		}
		setEmbedInstances((prev) => upsertEmbedInstance(prev, visualId, versionId))
	}

	const formatVersionLabel = (): string => {
		if (!view) return ""
		const index =
			view.totalVersions === 1 ? "v1" : `v${view.versionIndex} of ${view.totalVersions}`
		const date = new Date(view.versionCreatedAt).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		})
		return `${index}, ${date}${view.versionNote ? ` · ${view.versionNote}` : ""}`
	}
	const versionLabel = formatVersionLabel()

	// The publish button republishes when the pin already has public URLs —
	// same URLs, fresh snapshot.
	const publishLabel =
		busy === "publish"
			? "Publishing…"
			: published
				? "Republish"
				: "Publish embed"

	if (!canPublish) {
		return (
			<div className="flex flex-col gap-4">
				<div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
					Publishing embeds requires the self-host server — this session is
					running browser-local, so there is nowhere public to publish to.
				</div>
				<div className="flex items-center justify-end">
					<Button compact onClick={onClose}>
						Done
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<fieldset className="flex flex-col gap-3">
				<legend className="text-sm font-medium text-stone-900 dark:text-stone-100">
					Pin behavior
				</legend>
				{/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- native label wraps the radio; its text sits below the rule's depth-2 scan */}
				<label className="flex items-start gap-2 text-sm">
					<input
						type="radio"
						className="mt-1"
						checked={mode === "live"}
						onChange={() => setMode("live")}
					/>
					<div>
						<div className="font-medium text-stone-900 dark:text-stone-100">
							Latest at publish
						</div>
						<div className="text-sm vc-muted">
							Publishes a snapshot of the latest data. Republish any time to
							update the embed in place — the URL never changes.
						</div>
					</div>
				</label>
				{/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- native label wraps the radio; its text sits below the rule's depth-2 scan */}
				<label className="flex items-start gap-2 text-sm">
					<input
						type="radio"
						className="mt-1"
						checked={mode === "pinned"}
						onChange={() => setMode("pinned")}
						disabled={!view}
					/>
					<div>
						<div className="font-medium text-stone-900 dark:text-stone-100">
							Pin to current version{view ? ` (${versionLabel})` : ""}
						</div>
						<div className="text-sm vc-muted">
							The embed stays on this data version; republishing refreshes the
							styling but keeps the pinned data.
						</div>
					</div>
				</label>
			</fieldset>

			{/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- native label wraps the checkbox; its text sits below the rule's depth-2 scan */}
			<label className="flex items-start gap-2 rounded-sm bg-stone-50 px-3 py-2 text-sm dark:bg-stone-800/60">
				<input
					type="checkbox"
					className="mt-0.5"
					checked={splitLegend}
					onChange={(e) => setSplitLegend(e.target.checked)}
				/>
				<div>
					<div className="font-medium text-stone-900 dark:text-stone-100">
						Publish legend as a separate iframe
					</div>
					<div className="text-sm vc-muted">
						Get two snippets — chart and legend in independently sized iframes,
						so you can place the legend wherever it fits your page layout.
					</div>
				</div>
			</label>

			<div className="flex items-center gap-3">
				<Button compact disabled={busy !== null} onClick={() => void onPublish()}>
					{publishLabel}
				</Button>
				{published && (
					<Button
						compact
						disabled={busy !== null}
						onClick={() => void onUnpublish()}
					>
						{busy === "unpublish"
							? "Unpublishing…"
							: confirmUnpublish
								? "Really unpublish? The public URL will stop working"
								: "Unpublish"}
					</Button>
				)}
			</div>

			{publishError !== null && (
				<div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
					{publishError}
				</div>
			)}

			{published && snippets.length > 0 && (
				<div className="flex flex-col gap-3">
					{snippets.map((s) => {
						const value = drafts[s.key] ?? s.value
						return (
							<div key={s.key} className="flex flex-col gap-2">
								<label
									htmlFor={`${snippetIdBase}-${s.key}`}
									className="text-sm font-medium text-stone-900 dark:text-stone-100"
								>
									{s.label}
								</label>
								<Textarea
									id={`${snippetIdBase}-${s.key}`}
									value={value}
									onChange={(e) =>
										setDrafts((prev) => ({ ...prev, [s.key]: e.target.value }))
									}
									rows={3}
									className="font-mono"
									onFocus={(e) => e.currentTarget.select()}
								/>
								<div className="flex items-center justify-end">
									<Button compact onClick={() => onCopy(s.key, value)}>
										{copied === s.key ? "Copied!" : "Copy snippet"}
									</Button>
								</div>
							</div>
						)
					})}
				</div>
			)}

			<div
				className={`flex items-center ${
					published && embedUrl !== null ? "justify-between" : "justify-end"
				}`}
			>
				{published && embedUrl !== null && (
					<a
						href={embedUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-sm text-blue-700 underline hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
					>
						Open embed in new tab
					</a>
				)}
				<Button compact onClick={onClose}>
					Done
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Export tab
// ---------------------------------------------------------------------------

const ExportTab = ({
	visualId,
	onClose,
	width,
	height,
	aspectLocked,
	onWidthChange,
	onHeightChange,
	onAspectLockedChange,
	previewScale,
	hasDataTable,
	includeTable,
	onIncludeTableChange,
	tableHeight,
	onTableHeight,
}: {
	visualId: string
	onClose: () => void
	width: number
	/** The CHART's height; an included table adds `tableHeight` below it. */
	height: number
	aspectLocked: boolean
	onWidthChange: (v: number) => void
	onHeightChange: (v: number) => void
	onAspectLockedChange: (v: boolean) => void
	previewScale: number
	hasDataTable: boolean
	includeTable: boolean
	onIncludeTableChange: (v: boolean) => void
	/** The included table's height in px (0 when not included). */
	tableHeight: number
	onTableHeight: (v: number) => void
}) => {
	const view = useCurrentDatasetView()
	const setExportSizes = useSetAtom(exportSizesAtom)
	const visuals = useAtomValue(visualsAtom)
	// The file is named after the SAVED visual, like the JSON download.
	const visualName =
		visuals.find((v) => v.id === visualId)?.name ?? "visualization"
	// Persists on change, so the unit picked here is the default next export.
	const [unit, setUnit] = useAtom(exportUnitAtom)
	const [format, setFormat] = useState<ImageFormat>("png")
	const [pixelRatio, setPixelRatio] = useState(DEFAULT_PIXEL_RATIO)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const iframeRef = useRef<HTMLIFrameElement>(null)

	// The whole image: the chart, plus the data table under it if included.
	const imageHeight = height + tableHeight
	// SVG is vector — resolution doesn't apply.
	const rasterized = format !== "svg"
	const effectiveRatio = clampPixelRatio(width, imageHeight, pixelRatio)

	const previewUrl = useMemo(() => {
		const origin = typeof window === "undefined" ? "" : window.location.origin
		const params = new URLSearchParams()
		if (view) params.set("v", view.versionId)
		// Without the table, the image is the chart alone at the requested
		// size. With it (`table=image`), the embed lays the table out under
		// the chart and reports its height, and the iframe grows by that
		// much so the chart keeps the requested size.
		params.set("table", includeTable ? "image" : "off")
		return `${origin}/embed/${visualId}?${params.toString()}`
	}, [visualId, view, includeTable])

	useEffect(() => {
		if (!includeTable) return
		const onMessage = (e: MessageEvent<unknown>) => {
			if (e.source !== iframeRef.current?.contentWindow) return
			const data = e.data
			if (
				typeof data === "object" &&
				data !== null &&
				"type" in data &&
				data.type === EXPORT_TABLE_HEIGHT_MESSAGE &&
				"height" in data &&
				typeof data.height === "number"
			) {
				onTableHeight(data.height)
			}
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [includeTable, onTableHeight])

	const onDownload = async () => {
		setError(null)
		setBusy(true)
		try {
			// Ask where to save FIRST, while the click's user activation is
			// still live — the capture below can take seconds, after which the
			// browser would refuse to open the dialog. Browsers without a
			// Save-as dialog get a plain download under the suggested name.
			const fileType = IMAGE_FILE_TYPES[format]
			const filename = `${sanitizeVisualFilename(visualName)}${fileType.extensions[0]}`
			const target = await pickSaveTarget({
				suggestedName: filename,
				type: fileType,
				rememberAs: "vis-export-image",
			})
			// The user closed the dialog — nothing to export.
			if (target === null) return

			const blob = await renderExport(
				iframeRef.current,
				format,
				width,
				imageHeight,
				effectiveRatio
			)
			await writeSaveTarget(target, blob, filename)
			// Remember the size this visual was exported at so the modal
			// reopens with it next time (only on success — a failed capture
			// shouldn't overwrite a size that previously worked).
			setExportSizes((prev) => ({
				...prev,
				[visualId]: { width, height, aspectLocked },
			}))
			// The file is written — the modal's job is done. A cancelled
			// Save-as dialog (early return above) or a failed capture (catch
			// below) keeps it open so the user can retry.
			onClose()
		} catch (error_) {
			setError(error_ instanceof Error ? error_.message : "Export failed.")
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{/* One left-packed row of controls (labels above, controls bottom-
			    aligned). Left-packing keeps every control pinned in place while
			    the panel grows/shrinks with the preview. Resolution sits LAST so
			    hiding it (SVG) doesn't shift its neighbors. */}
			<div className="flex flex-wrap items-end gap-3">
				<NumberInput
					label={`Width (${unit})`}
					labelClassName="vc-muted"
					inline={false}
					value={pxToUnit(width, unit)}
					min={pxToUnit(MIN_EXPORT_DIM, unit)}
					max={pxToUnit(MAX_EXPORT_DIM, unit)}
					step={UNIT_STEP[unit]}
					// Preserve the raw input's guard: an all-cleared / zero entry
					// falls back to the default rather than committing 0.
					onChange={(v) => onWidthChange(unitToPx(v, unit) || DEFAULT_EXPORT_WIDTH)}
					inputClassName="w-24"
				/>
				<NumberInput
					label={`Height (${unit})`}
					labelClassName="vc-muted"
					inline={false}
					value={pxToUnit(height, unit)}
					min={pxToUnit(MIN_EXPORT_DIM, unit)}
					max={pxToUnit(MAX_EXPORT_DIM, unit)}
					step={UNIT_STEP[unit]}
					onChange={(v) => onHeightChange(unitToPx(v, unit) || DEFAULT_EXPORT_HEIGHT)}
					inputClassName="w-24"
				/>
				<label className="flex flex-col gap-1 text-sm">
					<span className="vc-muted">Units</span>
					<Select
						value={unit}
						onChange={(e) => setUnit(e.target.value as ExportUnit)}
					>
						{UNIT_OPTIONS.map((u) => (
							<option key={u} value={u}>
								{u}
							</option>
						))}
					</Select>
				</label>
				{/* Bottom padding centers the checkbox against the input row. */}
				<label className="flex items-center gap-2 pb-1.5 text-sm">
					<input
						type="checkbox"
						checked={aspectLocked}
						onChange={(e) => onAspectLockedChange(e.target.checked)}
					/>
					<span className="vc-muted">
						Lock aspect ratio
					</span>
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="vc-muted">Format</span>
					<Select
						value={format}
						onChange={(e) => setFormat(e.target.value as ImageFormat)}
					>
						{FORMAT_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</Select>
				</label>
				{rasterized && (
					<label className="flex flex-col gap-1 text-sm">
						<span className="vc-muted">
							Resolution
						</span>
						<Select
							value={pixelRatio}
							onChange={(e) => setPixelRatio(Number(e.target.value))}
						>
							{RESOLUTION_OPTIONS.map((r) => (
								<option key={r} value={r}>
									{r}×
								</option>
							))}
						</Select>
					</label>
				)}
			</div>
			{/* Its own row, under Width — tucked up to the controls (the
			    column's gap-4 would read as a separate group). */}
			{hasDataTable && (
				<label className="-mt-2 flex w-fit items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={includeTable}
						onChange={(e) => onIncludeTableChange(e.target.checked)}
					/>
					<span className="vc-muted">Include data table</span>
				</label>
			)}

			{error && (
				<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
					{error}
				</div>
			)}

			<div className="flex flex-col gap-2">
				<span className="text-sm vc-muted">
					Preview ({pxToUnit(width, unit)} × {pxToUnit(height, unit)}
					{unit === "px" ? "" : ` ${unit}`}
					{includeTable && ", plus the data table"})
					{(format === "png" || format === "jpeg") &&
						(effectiveRatio > 1 || unit !== "px" || includeTable) && (
							<span className="vc-faint">
								{" "}
								— exports at {Math.round(width * effectiveRatio)} ×{" "}
								{Math.round(imageHeight * effectiveRatio)} px
								{/* The file is DPI-stamped, so physical-size consumers
								    (PowerPoint, Word) insert it at the chosen in/cm. */}
								{unit !== "px" && ` (${Math.round(96 * effectiveRatio)} dpi)`}
							</span>
						)}
					{previewScale < 1 && (
						<span className="vc-faint">
							{" "}
							— shown at {Math.round(previewScale * 100)}%
						</span>
					)}
				</span>
				<div className="w-fit rounded border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
					{/* The box hugs the preview, so the popup resizes WITH the image —
					    growing down/right only (the popup is pinned top-left), keeping
					    the controls above in place and the drag handles tracking the
					    cursor 1:1. The iframe still renders at the true export
					    resolution (the transform is display-only and doesn't affect
					    capture). */}
					<div
						className="relative"
						style={{
							width: width * previewScale,
							height: imageHeight * previewScale,
						}}
					>
						<iframe
							ref={iframeRef}
							src={previewUrl}
							width={width}
							height={imageHeight}
							title="Export preview"
							className="block bg-white shadow-sm dark:bg-stone-900"
							style={{
								transform: `scale(${previewScale})`,
								transformOrigin: "top left",
							}}
						/>
						{/* The handles frame the whole image; a height drag resizes
						    the chart (the table's height is its own). */}
						<ResizeHandles
							width={width}
							height={imageHeight}
							previewScale={previewScale}
							aspectLocked={aspectLocked}
							onWidthChange={onWidthChange}
							onHeightChange={(v) =>
								onHeightChange(Math.max(MIN_EXPORT_DIM, v - tableHeight))
							}
						/>
					</div>
				</div>
			</div>

			{/* Actions ride the popup's bottom-right corner, below the preview —
			    they move as the popup resizes with the image, by design. */}
			<div className="flex justify-end gap-2">
				<Button compact onClick={onClose}>
					Cancel
				</Button>
				<Button compact onClick={onDownload} disabled={busy}>
					{busy ? "Exporting…" : `Save ${format.toUpperCase()}`}
				</Button>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Drag-to-resize handles
// ---------------------------------------------------------------------------

type DragAxis = "x" | "y" | "both"

/** Edge/corner handles overlaid on the preview so the export size can be
 * dragged directly. Pointer deltas are divided by the drag-start display
 * scale so movement tracks true export pixels, and changes flow through the
 * same onWidthChange/onHeightChange the number inputs use — the two
 * mechanisms stay in sync and the aspect lock keeps working (a locked
 * corner/right drag lets width drive; the handler derives height). Pointer
 * capture keeps the drag alive even when the cursor crosses the iframe. */
const ResizeHandles = ({
	width,
	height,
	previewScale,
	aspectLocked,
	onWidthChange,
	onHeightChange,
}: {
	width: number
	height: number
	previewScale: number
	aspectLocked: boolean
	onWidthChange: (v: number) => void
	onHeightChange: (v: number) => void
}) => {
	const dragRef = useRef<{
		axis: DragAxis
		startX: number
		startY: number
		startW: number
		startH: number
		scale: number
	} | null>(null)

	const startDrag =
		(axis: DragAxis) => (e: React.PointerEvent<HTMLDivElement>) => {
			e.preventDefault()
			e.currentTarget.setPointerCapture(e.pointerId)
			dragRef.current = {
				axis,
				startX: e.clientX,
				startY: e.clientY,
				startW: width,
				startH: height,
				scale: previewScale,
			}
		}
	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		if (!drag) return
		const clamp = (v: number) =>
			Math.min(MAX_EXPORT_DIM, Math.max(MIN_EXPORT_DIM, Math.round(v)))
		const dw = (e.clientX - drag.startX) / drag.scale
		const dh = (e.clientY - drag.startY) / drag.scale
		if (drag.axis !== "y") onWidthChange(clamp(drag.startW + dw))
		if (drag.axis === "y") {
			onHeightChange(clamp(drag.startH + dh))
		} else if (drag.axis === "both" && !aspectLocked) {
			onHeightChange(clamp(drag.startH + dh))
		}
	}
	const endDrag = () => {
		dragRef.current = null
	}
	const shared = {
		onPointerMove,
		onPointerUp: endDrag,
		onPointerCancel: endDrag,
	}

	return (
		<>
			<div
				{...shared}
				onPointerDown={startDrag("x")}
				data-testid="export-resize-right"
				className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none"
			/>
			<div
				{...shared}
				onPointerDown={startDrag("y")}
				data-testid="export-resize-bottom"
				className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none"
			/>
			<div
				{...shared}
				onPointerDown={startDrag("both")}
				data-testid="export-resize-corner"
				className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end p-0.5"
			>
				{/* Textarea-style corner grip so the affordance is discoverable. */}
				<svg
					width="10"
					height="10"
					viewBox="0 0 10 10"
					className="vc-muted"
					aria-hidden="true"
				>
					<path
						d="M2 9 L9 2 M5.5 9 L9 5.5"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						fill="none"
					/>
				</svg>
			</div>
		</>
	)
}
