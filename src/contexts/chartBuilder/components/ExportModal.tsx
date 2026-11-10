import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { sanitizeVisualFilename } from "../lib/downloadVisuals"
import { publishedInstancesOf, upsertEmbedInstance } from "../lib/embedInstances"
import {
	DEFAULT_HEIGHT,
	DEFAULT_PIXEL_RATIO,
	DEFAULT_WIDTH,
	MAX_EXPORT_DIM,
	MIN_EXPORT_DIM,
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
	republishOnSaveFor,
	republishOnSaveVisualsAtom,
	visualsAtom,
	withRepublishOnSave,
} from "../store/atoms"
import { migrateDataTableConfig } from "../lib/dataTableConfig"
import {
	embedPictureFailuresAtom,
	usePublishEmbed,
	useUnpublishEmbed,
} from "../store/publishEmbed"
import { useCurrentDatasetView } from "../store/useCurrentDatasetView"
import { useEffectiveGeographyLevel } from "../store/useEffectiveGeographyLevel"
import { LinkedPictureRow } from "./LinkedPictureRow"
import { EXPORT_TABLE_HEIGHT_MESSAGE } from "./viz/DataTableBlock"

import { Button } from "../../../components/ui/Button"
import { Checkbox } from "../../../components/ui/Checkbox"
import { SectionChevron } from "../../../components/ui/Chevron"
import { CopyButton } from "../../../components/ui/CopyButton"
import { Modal } from "../../../components/ui/Modal"
import { NumberInput } from "../../../components/ui/NumberInput"
import { Segmented } from "../../../components/ui/Segmented"
import { Select } from "../../../components/ui/Select"
import { Textarea } from "../../../components/ui/Input"

type Props = {
	open: boolean
	onClose: () => void
	visualId: string | null
}

type PinMode = "live" | "pinned"
/** The two tabs, named by what the user wants: an image file, or a
 *  published copy to link from slides, documents and web pages. */
type Tab = "download" | "publish"

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
	const [tab, setTab] = useState<Tab>("download")
	// Each open lands on the tab with work in it: Publish when this
	// visual is already published (its links and republish live there, and
	// the editor is showing the published-content warning), Download image
	// otherwise. Tab state survives while the modal sits mounted but closed,
	// so the choice is remade on the open transition — and only then, so
	// publishing or unpublishing from the Publish tab never yanks the user
	// off it. Same adjust-state-on-prop-change pattern as the snippet drafts.
	const embedInstances = useAtomValue(embedInstancesAtom)
	const isPublished = Object.values(embedInstances).some(
		(i) =>
			i.visualId === visualId &&
			i.publishId !== undefined &&
			i.publishedUrls !== undefined
	)
	const [seenOpen, setSeenOpen] = useState(false)
	if (open !== seenOpen) {
		setSeenOpen(open)
		if (open) setTab(isPublished ? "publish" : "download")
	}
	// ONE figure size for the whole dialog: the downloaded file and the
	// published pictures / iframe are all the embed laid out at this size,
	// shown live in the preview under the controls on both tabs.
	const [width, setWidth] = useState(DEFAULT_WIDTH)
	const [height, setHeight] = useState(DEFAULT_HEIGHT)
	const [aspectLocked, setAspectLocked] = useState(false)
	// Frozen aspect ratio used while the lock is engaged. Re-captured on lock.
	const ratioRef = useRef<number>(DEFAULT_WIDTH / DEFAULT_HEIGHT)
	const viewport = useViewportSize()
	const exportSizes = useAtomValue(exportSizesAtom)
	const view = useCurrentDatasetView()
	// The modal always opens for the CURRENT visual (SaveBar), so the current
	// channel configs are this visual's. A fixed canvas size prescribes the
	// figure size outright — see the open effect below.
	const canvasSizeCfg = useAtomValue(currentChannelConfigsAtom).canvasSize
	const fixedCanvas = canvasSizeCfg?.enabled ? canvasSizeCfg : null
	const [unit, setUnit] = useAtom(exportUnitAtom)
	// "Include data table" (offered only while the visual has a table on):
	// the figure is the chart at the chosen size with the table added below,
	// so the preview grows by the table's height, which the embed reports.
	const hasDataTable = migrateDataTableConfig(
		useAtomValue(currentDataTableConfigAtom)
	).enabled
	const [includeTableChoice, setIncludeTable] = useState(false)
	const includeTable = hasDataTable && includeTableChoice
	const [tableHeight, setTableHeight] = useState(0)
	const extraHeight = includeTable ? tableHeight : 0
	// The whole figure: the chart, plus the data table under it if included.
	const imageHeight = height + extraHeight
	const iframeRef = useRef<HTMLIFrameElement>(null)

	useEffect(() => {
		if (aspectLocked) ratioRef.current = width / height
	}, [aspectLocked, width, height])

	// On open, seed the figure size. A fixed canvas size (Aesthetics → Canvas
	// size) wins outright — the user prescribed exact dimensions, so exports
	// carry them through (including the unit they were set in), regardless of
	// what any previous export used. Otherwise restore the size this visual
	// was last exported or published at; with no saved size, default to the
	// editor's CURRENT on-screen chart size (not a fixed 650×400): the embed
	// then solves the same layout, so absolute-pixel title offsets land
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
			const clampDim = (n: number) =>
				Math.min(MAX_EXPORT_DIM, Math.max(MIN_EXPORT_DIM, Math.round(n)))
			setWidth(clampDim(fixedCanvas.width))
			setHeight(clampDim(fixedCanvas.height))
			setAspectLocked(saved?.aspectLocked ?? false)
			setUnit(fixedCanvas.unit ?? "px")
			return
		}
		const editorSize = saved ? null : measureEditorChartSize()
		setWidth(saved?.width ?? editorSize?.width ?? DEFAULT_WIDTH)
		setHeight(saved?.height ?? editorSize?.height ?? DEFAULT_HEIGHT)
		setAspectLocked(saved?.aspectLocked ?? false)
	}, [open, visualId, exportSizes, fixedCanvas, setUnit])

	// The preview: the embed page at the chosen size — what a download
	// captures and what a publish captures.
	const previewUrl = useMemo(() => {
		if (!visualId) return ""
		const origin = typeof window === "undefined" ? "" : window.location.origin
		const params = new URLSearchParams()
		if (view) params.set("v", view.versionId)
		// Without the table, the figure is the chart alone at the requested
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
				setTableHeight(data.height)
			}
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [includeTable])

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
	const previewScale = Math.min(1, availW / width, availH / imageHeight)

	const figure: FigureProps = {
		width,
		height,
		imageHeight,
		unit,
		setUnit,
		aspectLocked,
		onWidthChange,
		onHeightChange,
		onAspectLockedChange: setAspectLocked,
		hasDataTable,
		includeTable,
		onIncludeTableChange: (on) => {
			setIncludeTable(on)
			// The preview reloads; its table reports a fresh height.
			setTableHeight(0)
		},
		tableHeight: extraHeight,
		previewScale,
		previewUrl,
		iframeRef,
	}

	return (
		// Both tabs use the same pinned top-left slot layout, so switching tabs
		// never moves the popup or the tab row — only the right/bottom edges
		// differ per tab.
		<Modal
			open={open}
			onClose={onClose}
			title="Export this visualization"
			closeButton
			tipDialog="export"
			maxWidthPx={slotWidth}
			anchorTop
			fitWidth
			fitWidthOffsetPx={anchorOffset}
		>
			<div className="flex flex-col gap-4">
				<div
					role="tablist"
					className="flex items-stretch gap-3 border-b border-stone-200 dark:border-stone-700"
				>
					<TabButton
						active={tab === "download"}
						onClick={() => setTab("download")}
						tipAnchor="export-image-tab"
					>
						Download image
					</TabButton>
					<TabButton
						active={tab === "publish"}
						onClick={() => setTab("publish")}
						tipAnchor="export-embed-tab"
					>
						Publish
					</TabButton>
				</div>
				{tab === "publish" ? (
					<PublishTab visualId={visualId} figure={figure} />
				) : (
					<DownloadTab visualId={visualId} onClose={onClose} figure={figure} />
				)}
			</div>
		</Modal>
	)
}

const TabButton = ({
	active,
	onClick,
	children,
	tipAnchor,
}: {
	active: boolean
	onClick: () => void
	children: React.ReactNode
	/** `data-tip` anchor for a helper tip (src/tips/tips.ts). */
	tipAnchor?: string
}) => (
	<button
		type="button"
		role="tab"
		aria-selected={active}
		onClick={onClick}
		data-tip={tipAnchor}
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
// The figure: size controls + live preview, the same on both tabs
// ---------------------------------------------------------------------------

type FigureProps = {
	width: number
	/** The CHART's height; an included table adds `tableHeight` below it. */
	height: number
	/** The whole figure's height (chart + included table). */
	imageHeight: number
	unit: ExportUnit
	setUnit: (u: ExportUnit) => void
	aspectLocked: boolean
	onWidthChange: (v: number) => void
	onHeightChange: (v: number) => void
	onAspectLockedChange: (v: boolean) => void
	hasDataTable: boolean
	includeTable: boolean
	onIncludeTableChange: (v: boolean) => void
	/** The included table's height in px (0 when not included). */
	tableHeight: number
	previewScale: number
	previewUrl: string
	iframeRef: React.RefObject<HTMLIFrameElement>
}

/** Width / Height / Units / Lock aspect ratio (+ Include data table) over
 *  the live preview with its drag handles. Rendered by BOTH tabs, always
 *  visible and always FIRST: this is the figure the file, the pictures and
 *  the iframe will be, so resizing here is how users see how it all fits,
 *  and the shared controls sit in the same place whichever tab is open. */
const FigureBlock = ({
	figure,
	trailing,
	note,
}: {
	figure: FigureProps
	/** The tab's own controls, after the shared ones (Format / Resolution). */
	trailing?: React.ReactNode
	/** The tab's own line under the Preview caption (the export size). */
	note?: React.ReactNode
}) => {
	const {
		width,
		height,
		imageHeight,
		unit,
		setUnit,
		aspectLocked,
		onWidthChange,
		onHeightChange,
		onAspectLockedChange,
		hasDataTable,
		includeTable,
		onIncludeTableChange,
		tableHeight,
		previewScale,
		previewUrl,
		iframeRef,
	} = figure
	return (
		<div className="flex flex-col gap-3">
			{/* One left-packed row of controls (labels above, controls bottom-
			    aligned). Left-packing keeps every control pinned in place while
			    the panel grows/shrinks with the preview. */}
			<div className="flex flex-wrap items-end gap-3">
				<NumberInput
					label={`Width (${unit})`}
					labelClassName="vc-heading font-medium"
					inline={false}
					value={pxToUnit(width, unit)}
					min={pxToUnit(MIN_EXPORT_DIM, unit)}
					max={pxToUnit(MAX_EXPORT_DIM, unit)}
					step={UNIT_STEP[unit]}
					// Preserve the raw input's guard: an all-cleared / zero entry
					// falls back to the default rather than committing 0.
					onChange={(v) => onWidthChange(unitToPx(v, unit) || DEFAULT_WIDTH)}
					inputClassName="w-24"
				/>
				<NumberInput
					label={`Height (${unit})`}
					labelClassName="vc-heading font-medium"
					inline={false}
					value={pxToUnit(height, unit)}
					min={pxToUnit(MIN_EXPORT_DIM, unit)}
					max={pxToUnit(MAX_EXPORT_DIM, unit)}
					step={UNIT_STEP[unit]}
					onChange={(v) => onHeightChange(unitToPx(v, unit) || DEFAULT_HEIGHT)}
					inputClassName="w-24"
				/>
				<label className="flex flex-col gap-1 text-sm">
					<span className="vc-heading font-medium">Units</span>
					<Select value={unit} onChange={(e) => setUnit(e.target.value as ExportUnit)}>
						{UNIT_OPTIONS.map((u) => (
							<option key={u} value={u}>
								{u}
							</option>
						))}
					</Select>
				</label>
				{/* Bottom padding centers the checkboxes against the input row. */}
				<label className="flex items-center gap-2 pb-1.5 text-sm">
					<input
						type="checkbox"
						checked={aspectLocked}
						onChange={(e) => onAspectLockedChange(e.target.checked)}
					/>
					<span className="vc-heading font-medium">Lock aspect ratio</span>
				</label>
				{hasDataTable && (
					<label className="flex items-center gap-2 pb-1.5 text-sm">
						<input
							type="checkbox"
							checked={includeTable}
							onChange={(e) => onIncludeTableChange(e.target.checked)}
						/>
						<span className="vc-heading font-medium">Include data table</span>
					</label>
				)}
				{trailing}
			</div>
			<div className="flex flex-col gap-2">
				<div className="flex flex-col text-sm">
					<span className="vc-muted">
						Preview ({pxToUnit(width, unit)} × {pxToUnit(height, unit)}
						{unit === "px" ? "" : ` ${unit}`}
						{includeTable && ", plus the data table"})
						{previewScale < 1 && (
							<span className="vc-faint">
								{" "}
								— shown at {Math.round(previewScale * 100)}%
							</span>
						)}
					</span>
					{/* The tab's own line under it: the raster export size, say. */}
					{note !== undefined && <span className="vc-faint">{note}</span>}
				</div>
				<div className="w-fit rounded border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
					{/* The box hugs the preview, so the popup resizes WITH the image —
					    growing down/right only (the popup is pinned top-left), keeping
					    the controls above in place and the drag handles tracking the
					    cursor 1:1. The iframe still renders at the true size (the
					    transform is display-only and doesn't affect capture). */}
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
		</div>
	)
}

// ---------------------------------------------------------------------------
// Publish tab
// ---------------------------------------------------------------------------

type LinkFor = "slides" | "web"

const LINK_FOR_SEGMENTS: ReadonlyArray<{ key: LinkFor; label: string }> = [
	{ key: "slides", label: "Slides & documents" },
	{ key: "web", label: "Web page" },
]

const PublishTab = ({ visualId, figure }: { visualId: string; figure: FigureProps }) => {
	const view = useCurrentDatasetView()
	const instances = useAtomValue(embedInstancesAtom)
	const setEmbedInstances = useSetAtom(embedInstancesAtom)
	// "Republish on every save": this user's, this browser's, per visual —
	// not on the shared instances (see `republishOnSaveVisualsAtom`).
	const [republishOnSaveVisuals, setRepublishOnSaveVisuals] = useAtom(
		republishOnSaveVisualsAtom
	)
	const publishEmbed = usePublishEmbed()
	const pictureFailures = useAtomValue(embedPictureFailuresAtom)
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
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [linkFor, setLinkFor] = useState<LinkFor>("slides")
	const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null)
	const [publishError, setPublishError] = useState<string | null>(null)
	// Unpublishing kills public URLs, so the link asks twice (inline).
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

	// The iframe snippets' dimensions: the figure's, for the combined page;
	// the split chart / legend iframes measure the on-screen plot area and
	// legend subtree so each snippet matches its part (fixed fallbacks when a
	// piece can't be measured).
	const embedSizes = useMemo(
		() => ({
			full: { width: figure.width, height: figure.imageHeight },
			chart:
				measureElementSize("[data-editor-chart-plot]") ?? EMBED_FALLBACK_CHART,
			legend:
				measureElementSize("[data-legend-root]") ?? EMBED_FALLBACK_LEGEND,
		}),
		[figure.width, figure.imageHeight]
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
				// The pictures are captured from the preview: the figure the user
				// is looking at, at the size above.
				capture: {
					source: figure.iframeRef.current,
					width: figure.width,
					height: figure.imageHeight,
				},
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

	// Taking a snippet records the instance (the landing table lists where a
	// visual is embedded).
	const onCopied = () =>
		setEmbedInstances((prev) => upsertEmbedInstance(prev, visualId, versionId))

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
				: "Publish"

	// The state line: what is live for the pin this tab is on.
	const publishedAt =
		published?.publishedAt === undefined
			? null
			: new Date(published.publishedAt).toLocaleString(undefined, {
					month: "short",
					day: "numeric",
					hour: "numeric",
					minute: "2-digit",
				})
	const stateLine = published
		? `Published · ${mode === "pinned" ? `pinned to ${versionLabel}` : "latest data"} · ${publishedAt}`
		: "Not published yet"
	const republishOnSave = republishOnSaveFor(republishOnSaveVisuals, visualId)
	const hasPublishedPin = publishedInstancesOf(instances, visualId).length > 0

	if (!canPublish) {
		return (
			<div className="flex flex-col gap-4">
				<div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
					Publishing embeds requires the self-host server — this session is
					running browser-local, so there is nowhere public to publish to.
					Use the Download image tab for a file.
				</div>
				<FigureBlock figure={figure} />
			</div>
		)
	}

	// One editable iframe snippet with its copy chip.
	const renderSnippet = (s: { key: "main" | "legend"; label: string; value: string }) => {
		const value = drafts[s.key] ?? s.value
		return (
			<div key={s.key} className="flex flex-col gap-2">
				<label
					htmlFor={`${snippetIdBase}-${s.key}`}
					className="vc-heading text-sm font-medium"
				>
					{s.label}
				</label>
				{/* Copy is a purple chip in the field's corner, shown on hover. */}
				<div className="relative group/copy">
					{/* DM Mono Regular, like the picture links (see LinkedPictureRow). */}
					<Textarea
						id={`${snippetIdBase}-${s.key}`}
						value={value}
						onChange={(e) =>
							setDrafts((prev) => ({ ...prev, [s.key]: e.target.value }))
						}
						rows={3}
						className="w-full font-mono font-[400] pr-9"
						onFocus={(e) => e.currentTarget.select()}
					/>
					<CopyButton value={value} label="Copy snippet" onCopied={onCopied} ghost />
				</div>
			</div>
		)
	}

	// Whether this pin is live, and since when, with the actions beside it.
	// It sits UNDER the preview (where Download image has its button), so
	// the controls and the preview stay put when switching tabs. Unpublish
	// is a quiet link — it kills the public URL, so it asks twice.
	const stateRows = (
		<>
			<div className="flex items-center justify-between gap-3">
				<span
					role="status"
					className={`text-sm font-medium ${published ? "vc-heading" : "vc-muted"}`}
				>
					{stateLine}
				</span>
				<div className="flex items-center gap-3">
					<Button compact disabled={busy !== null} onClick={() => void onPublish()}>
						{publishLabel}
					</Button>
					{published && (
						<button
							type="button"
							disabled={busy !== null}
							onClick={() => void onUnpublish()}
							className="text-sm vc-muted underline hover:text-stone-900 disabled:opacity-60 dark:hover:text-white"
						>
							{busy === "unpublish"
								? "Unpublishing…"
								: confirmUnpublish
									? "Really unpublish? The public URL will stop working"
									: "Unpublish"}
						</button>
					)}
				</div>
			</div>
			{!published && (
				<p className="text-sm vc-muted">
					Publishing puts a copy of this chart online, at this size, and
					gives you links to paste into slides, documents and web pages.
					Republish any time to update them in place.
				</p>
			)}
		</>
	)

	return (
		<div className="flex flex-col gap-4">
			<FigureBlock figure={figure} note="Same size as Download image" />
			{stateRows}

			{/* The data version settings fold away; most publishes never need
			    them. A purple option panel like the sidebar's, with the
			    sidebar's purple group header and chevron. */}
			<div className="vc-option-panel">
				<button
					type="button"
					onClick={() => setSettingsOpen((o) => !o)}
					aria-expanded={settingsOpen}
					className="text-vc-section-header flex w-full items-center gap-2 text-left"
				>
					<SectionChevron open={settingsOpen} />
					<span className="vc-group-header">Data version settings</span>
				</button>
				{settingsOpen && (
<div className="vc-subsection-card grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-md p-2 text-sm">
						<span className="vc-muted pt-0.5">Data</span>
						<fieldset className="flex flex-col gap-2">
							<legend className="sr-only">Data</legend>
							{/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- native label wraps the radio; its text sits below the rule's depth-2 scan */}
							<label className="flex items-center gap-2">
								<input
									type="radio"
									checked={mode === "live"}
									onChange={() => setMode("live")}
								/>
								<span>
									<span className="vc-heading font-medium">Latest at publish</span>
									<span className="vc-muted"> — each republish takes the newest data</span>
								</span>
							</label>
							{/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- native label wraps the radio; its text sits below the rule's depth-2 scan */}
							<label className="flex items-center gap-2">
								<input
									type="radio"
									checked={mode === "pinned"}
									onChange={() => setMode("pinned")}
									disabled={!view}
								/>
								<span>
									<span className="vc-heading font-medium">
										Pin to current version{view ? ` (${versionLabel})` : ""}
									</span>
									<span className="vc-muted"> — republishing keeps this data</span>
								</span>
							</label>
						</fieldset>
						{/* Per VISUAL (every published pin, whichever pin this tab
						    shows) and per user on this browser: each of this user's
						    autosaves republishes (`useAutoSave`). Only meaningful once
						    something is published. */}
						{hasPublishedPin && (
							<>
								<span className="vc-muted pt-0.5">Updates</span>
								<Checkbox
									label="Republish automatically whenever I save (this browser only)"
									checked={republishOnSave}
									onChange={(on) =>
										setRepublishOnSaveVisuals((prev) =>
											withRepublishOnSave(prev, visualId, on)
										)
									}
								/>
							</>
						)}
					</div>
				)}
			</div>

			{publishError !== null && (
				<div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
					{publishError}
				</div>
			)}

			{/* The two ways to use the published copy, one at a time, pictures
			    first (most users want a slide or a document, not an iframe).
			    Links exist only once a publish has succeeded (0016 rule 4). */}
			{published && (
				<>
					<div className="flex items-center gap-3">
						<span className="vc-heading text-sm font-medium">Get a link for</span>
						<Segmented
							ariaLabel="Link destination"
							value={linkFor}
							segments={LINK_FOR_SEGMENTS}
							onChange={setLinkFor}
						/>
					</div>

					{linkFor === "slides" ? (
						<LinkedPictureRow
							imageUrl={published.publishedUrls?.image}
							vectorUrl={published.publishedUrls?.vector}
							failures={pictureFailures[visualId]}
						/>
					) : (
						<div className="flex flex-col gap-3">
							{snippets
								.filter((s) => s.key === "main")
								.map(renderSnippet)}
							{/* Iframe-only, so it lives here; it shapes what the NEXT
							    publish writes (one page, or chart + legend pages). */}
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={splitLegend}
									onChange={(e) => setSplitLegend(e.target.checked)}
								/>
								<span>
									Legend as a separate iframe{" "}
									<span className="vc-muted">(takes effect on republish)</span>
								</span>
							</label>
							{snippets
								.filter((s) => s.key === "legend")
								.map(renderSnippet)}
							{embedUrl !== null && (
								<a
									href={embedUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="w-fit text-sm text-blue-700 underline hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
								>
									Open published page in new tab
								</a>
							)}
						</div>
					)}
				</>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Download image tab
// ---------------------------------------------------------------------------

const DownloadTab = ({
	visualId,
	onClose,
	figure,
}: {
	visualId: string
	onClose: () => void
	figure: FigureProps
}) => {
	const setExportSizes = useSetAtom(exportSizesAtom)
	const visuals = useAtomValue(visualsAtom)
	// The file is named after the SAVED visual, like the bundle download.
	const visualName =
		visuals.find((v) => v.id === visualId)?.name ?? "visualization"
	const [format, setFormat] = useState<ImageFormat>("png")
	const [pixelRatio, setPixelRatio] = useState(DEFAULT_PIXEL_RATIO)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { width, height, imageHeight, unit, aspectLocked, iframeRef } = figure

	// SVG is vector — resolution doesn't apply.
	const rasterized = format !== "svg"
	const effectiveRatio = clampPixelRatio(width, imageHeight, pixelRatio)

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

	// The export size line under the Preview caption — always present, so
	// the caption is two lines on both tabs and the preview never moves.
	const note = rasterized
		? `Exports at ${Math.round(width * effectiveRatio)} × ${Math.round(imageHeight * effectiveRatio)} px${
				unit !== "px" ? ` (${Math.round(96 * effectiveRatio)} dpi)` : ""
			}`
		: "Vector — sharp at any size"

	// Format and Resolution follow the shared size controls — one line.
	const trailing = (
		<>
			<label className="flex flex-col gap-1 text-sm">
				<span className="vc-heading font-medium">Format</span>
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
					<span className="vc-heading font-medium">Resolution</span>
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
		</>
	)

	return (
		<div className="flex flex-col gap-4">
			{/* The file is DPI-stamped, so physical-size consumers (PowerPoint,
			    Word) insert it at the chosen in/cm. */}
			<FigureBlock figure={figure} trailing={trailing} note={note} />

			{error && (
				<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
					{error}
				</div>
			)}

			{/* Actions ride the popup's bottom-right corner, below the preview —
			    they move as the popup resizes with the image, by design. */}
			<div className="flex justify-end gap-2">
				<Button compact onClick={onDownload} disabled={busy}>
					{busy ? "Exporting…" : `Download ${format.toUpperCase()}`}
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
