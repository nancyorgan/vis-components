import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	STABLE_POLLS,
	chartLayoutReady,
	serializeEmbedCapture,
} from "../lib/captureThumbnail"
import { upsertEmbedInstance } from "../lib/embedInstances"
import { withJpegDpi, withPngDpi } from "../lib/imageDpi"
import type { ExportUnit } from "../lib/storage"
import { embedInstancesAtom, exportSizesAtom, exportUnitAtom } from "../store/atoms"
import { useCurrentDatasetView } from "../store/useCurrentDatasetView"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"
import { NumberInput } from "../../../components/ui/NumberInput"

type Props = {
	open: boolean
	onClose: () => void
	visualId: string | null
}

type PinMode = "live" | "pinned"
type Tab = "embed" | "export"
type ImageFormat = "png" | "jpeg" | "svg" | "pdf"

const FORMAT_OPTIONS: Array<{ value: ImageFormat; label: string }> = [
	{ value: "png", label: "PNG" },
	{ value: "jpeg", label: "JPEG" },
	{ value: "svg", label: "SVG" },
	{ value: "pdf", label: "PDF" },
]

const RESOLUTION_OPTIONS = [1, 2, 3, 4]
const DEFAULT_PIXEL_RATIO = 2

// Display units for the size inputs. Sizes are stored, dragged, and exported
// in px — the unit only converts what the inputs show, at the CSS-standard
// 96 px/inch (so a chart exported at "6.5 in" embeds at true size in
// 96 dpi-convention tools like Office and Figma).
const UNIT_OPTIONS: ExportUnit[] = ["px", "in", "cm"]
const PX_PER_UNIT: Record<ExportUnit, number> = {
	px: 1,
	in: 96,
	cm: 96 / 2.54,
}
// Per-unit input step, each ≈10px so stepping feels the same in every unit.
const UNIT_STEP: Record<ExportUnit, number> = { px: 10, in: 0.1, cm: 0.25 }

/** Convert stored px to the display unit. px shows whole numbers; physical
 *  units show 2 decimals (≈0.4px precision — below layout significance). */
const pxToUnit = (px: number, unit: ExportUnit): number =>
	unit === "px" ? px : Number((px / PX_PER_UNIT[unit]).toFixed(2))

const unitToPx = (v: number, unit: ExportUnit): number =>
	Math.round(v * PX_PER_UNIT[unit])

// Fallback iframe dimensions for the embed snippets, used only when the
// on-screen chart / legend can't be measured (e.g. modal opened before the
// chart mounted).
const EMBED_FALLBACK_FULL = { width: 800, height: 500 }
const EMBED_FALLBACK_CHART = { width: 650, height: 400 }
const EMBED_FALLBACK_LEGEND = { width: 220, height: 400 }

const DEFAULT_WIDTH = 650
const DEFAULT_HEIGHT = 400
// Shared bounds for the size inputs AND the drag-resize handles.
const MIN_EXPORT_DIM = 50
const MAX_EXPORT_DIM = 4096

// Horizontal chrome inside the panel around the preview image: modal content
// padding (p-4 → 16px each side) plus the preview box padding (p-3 → 12px each
// side) plus its border. Used to grow the popup to the scaled image width.
const PREVIEW_CHROME_X = 58
// Space reserved for everything above/below the preview (title, tabs, size
// controls, buttons, gaps) when fitting the preview to the viewport height.
const PREVIEW_CHROME_Y = 300
// Breathing room kept between the popup and the viewport edges.
const VIEWPORT_MARGIN = 48
// Don't let the popup collapse narrower than the size controls need.
const MIN_PANEL_WIDTH = 420

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
	const rect = el.getBoundingClientRect()
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
	const [tab, setTab] = useState<Tab>("embed")
	const [width, setWidth] = useState(DEFAULT_WIDTH)
	const [height, setHeight] = useState(DEFAULT_HEIGHT)
	const [aspectLocked, setAspectLocked] = useState(false)
	// Frozen aspect ratio used while the lock is engaged. Re-captured on lock.
	const ratioRef = useRef<number>(DEFAULT_WIDTH / DEFAULT_HEIGHT)
	const viewport = useViewportSize()
	const exportSizes = useAtomValue(exportSizesAtom)

	useEffect(() => {
		if (aspectLocked) ratioRef.current = width / height
	}, [aspectLocked, width, height])

	// On open, restore the size this visual was last exported at. With no
	// saved size, default to the editor's CURRENT on-screen chart size (not a
	// fixed 650×400): the export embed then solves the same layout, so
	// absolute-pixel title offsets export exactly where the user placed them.
	// Falls back to the fixed default only when the editor chart isn't
	// measurable (e.g. modal opened before the chart mounted).
	//
	// Also fires when exportSizes updates post-export, but by then the saved
	// entry equals the live state, so those sets are no-ops.
	useEffect(() => {
		if (!open || !visualId) return
		const saved = exportSizes[visualId]
		const editorSize = saved ? null : measureEditorChartSize()
		setWidth(saved?.width ?? editorSize?.width ?? DEFAULT_WIDTH)
		setHeight(saved?.height ?? editorSize?.height ?? DEFAULT_HEIGHT)
		setAspectLocked(saved?.aspectLocked ?? false)
	}, [open, visualId, exportSizes])

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

	// Scale the preview down to fit the available space, so the whole figure
	// stays visible (and in proportion) at any chosen dimensions.
	const availW = Math.max(240, viewport.w - VIEWPORT_MARGIN - PREVIEW_CHROME_X)
	const availH = Math.max(160, viewport.h - PREVIEW_CHROME_Y)
	const previewScale = Math.min(1, availW / width, availH / height)

	// Grow the popup to the scaled image width so the preview isn't clipped,
	// clamped between a usable minimum and the viewport.
	const maxWidthPx =
		tab === "export"
			? Math.min(
					viewport.w - VIEWPORT_MARGIN,
					Math.max(MIN_PANEL_WIDTH, width * previewScale + PREVIEW_CHROME_X)
			  )
			: undefined

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Export this visualization"
			widthClass="max-w-2xl"
			maxWidthPx={maxWidthPx}
		>
			<div className="flex flex-col gap-4">
				<div className="flex border-b border-stone-200 dark:border-stone-700">
					<TabButton active={tab === "embed"} onClick={() => setTab("embed")}>
						Embed
					</TabButton>
					<TabButton active={tab === "export"} onClick={() => setTab("export")}>
						Export image
					</TabButton>
				</div>
				{tab === "embed" ? (
					<EmbedTab visualId={visualId} onClose={onClose} />
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
					/>
				)}
			</div>
		</Modal>
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
				: "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-white"
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
	const setEmbedInstances = useSetAtom(embedInstancesAtom)
	// Base for the snippet textareas' ids so each visible label targets its
	// own textarea via htmlFor.
	const snippetIdBase = useId()
	const [mode, setMode] = useState<PinMode>("live")
	const [splitLegend, setSplitLegend] = useState(false)
	const [copied, setCopied] = useState<"main" | "legend" | null>(null)
	// User-edited snippet text, keyed by snippet. Seeded from the generated
	// value and reset whenever the generated snippet changes (pin mode / split
	// / measured size), so tweaking dimensions by hand survives until an
	// option that rebuilds the snippet is toggled.
	const [drafts, setDrafts] = useState<Record<string, string>>({})
	const [draftsSignature, setDraftsSignature] = useState<string | null>(null)

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

	const { snippets, embedUrl } = useMemo(() => {
		const origin = typeof window === "undefined" ? "" : window.location.origin
		const params = new URLSearchParams()
		if (mode === "pinned" && view) params.set("v", view.versionId)
		const baseQuery = params.toString()
		const baseUrl = `${origin}/embed/${visualId}`
		const fullUrl = baseQuery ? `${baseUrl}?${baseQuery}` : baseUrl
		if (!splitLegend) {
			const { width, height } = embedSizes.full
			const snippet = `<iframe src="${fullUrl}" width="${width}" height="${height}" frameborder="0"></iframe>`
			return {
				snippets: [{ key: "main" as const, label: "Iframe", value: snippet }],
				embedUrl: fullUrl,
			}
		}
		const chartParams = new URLSearchParams(params)
		chartParams.set("part", "chart")
		const chartUrl = `${baseUrl}?${chartParams.toString()}`
		const legendParams = new URLSearchParams(params)
		legendParams.set("part", "legend")
		const legendUrl = `${baseUrl}?${legendParams.toString()}`
		return {
			snippets: [
				{
					key: "main" as const,
					label: "Chart iframe",
					value: `<iframe src="${chartUrl}" width="${embedSizes.chart.width}" height="${embedSizes.chart.height}" frameborder="0"></iframe>`,
				},
				{
					key: "legend" as const,
					label: "Legend iframe",
					value: `<iframe src="${legendUrl}" width="${embedSizes.legend.width}" height="${embedSizes.legend.height}" frameborder="0"></iframe>`,
				},
			],
			embedUrl: chartUrl,
		}
	}, [visualId, mode, view, splitLegend, embedSizes])

	// Reset the editable drafts to the freshly generated snippets only when an
	// option that rebuilds them changes. Keyed on a stable signature rather
	// than the `snippets` reference: `view` from useCurrentDatasetView is a new
	// object every render, so watching `snippets` would reset (and clobber) the
	// user's edits on every keystroke. Done during render (React's "adjust
	// state on change" pattern) so the reset lands before paint, no effect.
	const snippetSignature = `${visualId}|${mode}|${splitLegend}|${
		view?.versionId ?? ""
	}`
	if (snippetSignature !== draftsSignature) {
		setDraftsSignature(snippetSignature)
		setDrafts(Object.fromEntries(snippets.map((s) => [s.key, s.value])))
	}

	const onCopy = async (key: "main" | "legend", value: string) => {
		try {
			await globalThis.navigator.clipboard.writeText(value)
			setCopied(key)
			window.setTimeout(() => setCopied(null), 1500)
		} catch {
			// Older browsers — let the user select+copy manually.
		}
		const versionId = mode === "pinned" && view ? view.versionId : null
		setEmbedInstances((prev) => upsertEmbedInstance(prev, visualId, versionId))
	}

	const formatVersionLabel = (): string => {
		if (!view) return ""
		if (view.totalVersions === 1) return "v1"
		return `v${view.versionIndex} of ${view.totalVersions}`
	}
	const versionLabel = formatVersionLabel()

	return (
		<div className="flex flex-col gap-4">
			<div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
				<strong>Same-origin only.</strong> Embeds currently work only when
				hosted on the same origin as your vis-components instance.
			</div>

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
							Live updating
						</div>
						<div className="text-sm text-stone-600 dark:text-stone-400">
							Embed always renders the latest version of the data set.
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
						<div className="text-sm text-stone-600 dark:text-stone-400">
							Embed stays frozen on this version forever.
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
						Render legend as a separate iframe
					</div>
					<div className="text-sm text-stone-600 dark:text-stone-400">
						Get two snippets — chart and legend in independently sized iframes,
						so you can place the legend wherever it fits your page layout.
					</div>
				</div>
			</label>

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
							<textarea
								id={`${snippetIdBase}-${s.key}`}
								value={value}
								onChange={(e) =>
									setDrafts((prev) => ({ ...prev, [s.key]: e.target.value }))
								}
								rows={3}
								className="rounded-sm border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
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

			<div className="flex items-center justify-between">
				<a
					href={embedUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="text-sm text-blue-700 underline hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
				>
					Open embed in new tab
				</a>
				<Button compact outline onClick={onClose}>
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
}: {
	visualId: string
	onClose: () => void
	width: number
	height: number
	aspectLocked: boolean
	onWidthChange: (v: number) => void
	onHeightChange: (v: number) => void
	onAspectLockedChange: (v: boolean) => void
	previewScale: number
}) => {
	const view = useCurrentDatasetView()
	const setExportSizes = useSetAtom(exportSizesAtom)
	// Persists on change, so the unit picked here is the default next export.
	const [unit, setUnit] = useAtom(exportUnitAtom)
	const [format, setFormat] = useState<ImageFormat>("png")
	const [pixelRatio, setPixelRatio] = useState(DEFAULT_PIXEL_RATIO)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const iframeRef = useRef<HTMLIFrameElement>(null)

	// SVG is vector — resolution doesn't apply.
	const rasterized = format !== "svg"
	const effectiveRatio = clampPixelRatio(width, height, pixelRatio)

	const previewUrl = useMemo(() => {
		const origin = typeof window === "undefined" ? "" : window.location.origin
		const params = new URLSearchParams()
		if (view) params.set("v", view.versionId)
		const q = params.toString()
		return q
			? `${origin}/embed/${visualId}?${q}`
			: `${origin}/embed/${visualId}`
	}, [visualId, view])

	const onDownload = async () => {
		setError(null)
		setBusy(true)
		try {
			const svgText = await waitForChartSvg(iframeRef.current)
			const filename = `${visualId}.${format}`
			if (format === "svg") {
				downloadBlob(new Blob([svgText], { type: "image/svg+xml" }), filename)
			} else if (format === "pdf") {
				const blob = await generatePdf(svgText, width, height, effectiveRatio)
				downloadBlob(blob, filename)
			} else {
				const blob = await rasterizeSvg(
					svgText,
					width,
					height,
					effectiveRatio,
					format
				)
				downloadBlob(blob, filename)
			}
			// Remember the size this visual was exported at so the modal
			// reopens with it next time (only on success — a failed capture
			// shouldn't overwrite a size that previously worked).
			setExportSizes((prev) => ({
				...prev,
				[visualId]: { width, height, aspectLocked },
			}))
		} catch (error_) {
			setError(error_ instanceof Error ? error_.message : "Export failed.")
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex gap-3">
				<NumberInput
					label={`Width (${unit})`}
					labelClassName="text-stone-600 dark:text-stone-400"
					inline={false}
					value={pxToUnit(width, unit)}
					min={pxToUnit(MIN_EXPORT_DIM, unit)}
					max={pxToUnit(MAX_EXPORT_DIM, unit)}
					step={UNIT_STEP[unit]}
					// Preserve the raw input's guard: an all-cleared / zero entry
					// falls back to the default rather than committing 0.
					onChange={(v) => onWidthChange(unitToPx(v, unit) || DEFAULT_WIDTH)}
					inputClassName="w-40"
				/>
				<NumberInput
					label={`Height (${unit})`}
					labelClassName="text-stone-600 dark:text-stone-400"
					inline={false}
					value={pxToUnit(height, unit)}
					min={pxToUnit(MIN_EXPORT_DIM, unit)}
					max={pxToUnit(MAX_EXPORT_DIM, unit)}
					step={UNIT_STEP[unit]}
					onChange={(v) => onHeightChange(unitToPx(v, unit) || DEFAULT_HEIGHT)}
					inputClassName="w-40"
				/>
				<label className="flex flex-col gap-1 text-sm">
					<span className="text-stone-600 dark:text-stone-400">Units</span>
					<select
						value={unit}
						onChange={(e) => setUnit(e.target.value as ExportUnit)}
						className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-white"
					>
						{UNIT_OPTIONS.map((u) => (
							<option key={u} value={u}>
								{u}
							</option>
						))}
					</select>
				</label>
			</div>
			<div className="flex items-center gap-3 text-sm">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={aspectLocked}
						onChange={(e) => onAspectLockedChange(e.target.checked)}
					/>
					<span className="text-stone-600 dark:text-stone-400">
						Lock aspect ratio
					</span>
				</label>
				<label className="ml-auto flex items-center gap-2">
					<span className="text-stone-600 dark:text-stone-400">Format</span>
					<select
						value={format}
						onChange={(e) => setFormat(e.target.value as ImageFormat)}
						className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-white"
					>
						{FORMAT_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				</label>
				{rasterized && (
					<label className="flex items-center gap-2">
						<span className="text-stone-600 dark:text-stone-400">
							Resolution
						</span>
						<select
							value={pixelRatio}
							onChange={(e) => setPixelRatio(Number(e.target.value))}
							className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-white"
						>
							{RESOLUTION_OPTIONS.map((r) => (
								<option key={r} value={r}>
									{r}×
								</option>
							))}
						</select>
					</label>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-sm text-stone-600 dark:text-stone-400">
					Preview ({pxToUnit(width, unit)} × {pxToUnit(height, unit)}
					{unit === "px" ? "" : ` ${unit}`})
					{(format === "png" || format === "jpeg") &&
						(effectiveRatio > 1 || unit !== "px") && (
							<span className="text-stone-400 dark:text-stone-500">
								{" "}
								— exports at {Math.round(width * effectiveRatio)} ×{" "}
								{Math.round(height * effectiveRatio)} px
								{/* The file is DPI-stamped, so physical-size consumers
								    (PowerPoint, Word) insert it at the chosen in/cm. */}
								{unit !== "px" && ` (${Math.round(96 * effectiveRatio)} dpi)`}
							</span>
						)}
					{previewScale < 1 && (
						<span className="text-stone-400 dark:text-stone-500">
							{" "}
							— shown at {Math.round(previewScale * 100)}%
						</span>
					)}
				</span>
				<div className="flex justify-center overflow-auto rounded border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
					{/* Fixed-size box holds the scaled-down iframe so the full figure
					    stays visible in proportion; the iframe still renders at the
					    true export resolution (the transform is display-only and
					    doesn't affect capture). */}
					<div
						className="relative"
						style={{
							width: width * previewScale,
							height: height * previewScale,
						}}
					>
						<iframe
							ref={iframeRef}
							src={previewUrl}
							width={width}
							height={height}
							title="Export preview"
							className="block bg-white shadow-sm dark:bg-stone-900"
							style={{
								transform: `scale(${previewScale})`,
								transformOrigin: "top left",
							}}
						/>
						<ResizeHandles
							width={width}
							height={height}
							previewScale={previewScale}
							aspectLocked={aspectLocked}
							onWidthChange={onWidthChange}
							onHeightChange={onHeightChange}
						/>
					</div>
				</div>
			</div>

			{error && (
				<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<Button compact outline onClick={onClose}>
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
					className="text-stone-400 dark:text-stone-500"
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

// ---------------------------------------------------------------------------
// Image rasterization helpers
// ---------------------------------------------------------------------------

/** Poll the preview iframe for a serialised chart SVG, allowing the embed
 * page time to finish hydrating Jotai + mounting the chart. The iframe is a
 * cold-booting embed app — it spins up its own React root, hydrates Jotai,
 * loads the dataset from IndexedDB, then mounts the chart. PlotCanvas uses
 * `useMeasure`, so the SVG mounts at width=0 until ResizeObserver fires. On
 * first open this whole boot can take several seconds.
 *
 * A non-zero bounding rect is NOT enough to capture: a cold embed does
 * several layout passes (measure → solve → re-render, ResizeObserver rounds,
 * webfont swaps), and tick-label margins / title positions are measured from
 * live font metrics. Grabbing the first sized frame serializes a fallback-font
 * layout whose spacing differs slightly from the fully-settled editor — the
 * "export is off a little from the viewport" bug. So we require, mirroring the
 * thumbnail backfill's proven gating: fonts settled, EVERY panel sized, and
 * the serialized markup byte-identical for `STABLE_POLLS` consecutive polls. */
const CAPTURE_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 100

const waitForChartSvg = async (
	iframe: HTMLIFrameElement | null
): Promise<string> => {
	if (!iframe) {
		throw new Error("Preview not ready yet — try again in a moment.")
	}
	const deadline = Date.now() + CAPTURE_TIMEOUT_MS
	let lastSvgText: string | null = null
	let matchingPolls = 0
	while (Date.now() < deadline) {
		const doc = iframe.contentDocument
		// Hold off while webfonts are still streaming in — tick-label margins
		// and title offsets are measured from live font metrics, so a
		// fallback-font layout serializes cleanly but at the wrong spacing.
		const fontsSettled = !doc?.fonts || doc.fonts.status !== "loading"
		const svgText =
			doc && fontsSettled && chartLayoutReady(doc)
				? serializeEmbedCapture(doc)
				: null
		if (svgText !== null && svgText === lastSvgText) {
			matchingPolls++
			// Stable across STABLE_POLLS polls → the layout has stopped
			// reflowing and matches the settled editor render.
			if (matchingPolls >= STABLE_POLLS) return svgText
		} else {
			matchingPolls = 0
		}
		lastSvgText = svgText
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, POLL_INTERVAL_MS)
		})
	}
	// Deadline hit without stability — a last-known sized frame still beats a
	// hard failure for the user.
	if (lastSvgText) return lastSvgText
	throw new Error(
		"Couldn't capture the chart — the preview took too long to render. Try changing the dimensions slightly to refresh it."
	)
}

const downloadBlob = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	document.body.append(a)
	a.click()
	a.remove()
	// Defer revocation so the browser has a chance to start the download —
	// some browsers race the click() / revoke pair otherwise.
	window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Ceilings for the rendered bitmap. iOS Safari refuses canvases past
// ~16.7M px² total area; most browsers cap a single edge well above 8192.
const MAX_CANVAS_EDGE = 8192
const MAX_CANVAS_AREA = 16_777_216

/** Largest usable multiplier ≤ the requested one, so width × ratio never
 * blows past canvas limits (a silently-failed canvas exports as blank). */
const clampPixelRatio = (
	width: number,
	height: number,
	ratio: number
): number =>
	Math.max(
		1,
		Math.min(
			ratio,
			MAX_CANVAS_EDGE / width,
			MAX_CANVAS_EDGE / height,
			Math.sqrt(MAX_CANVAS_AREA / (width * height))
		)
	)

/** Draw the chart SVG onto a canvas at `width × height` logical px scaled by
 * `pixelRatio`. Browsers rasterize an <img> SVG at its *intrinsic* size and
 * only then bitmap-scale it in drawImage, so the SVG's width/height must be
 * rewritten to the full output resolution first — otherwise a 2× canvas just
 * holds a blurry upscale of the 1× render. */
const renderChartToCanvas = (
	svgText: string,
	width: number,
	height: number,
	pixelRatio: number,
	opaqueBackground: boolean
): Promise<HTMLCanvasElement> =>
	new Promise((resolve, reject) => {
		const pxW = Math.round(width * pixelRatio)
		const pxH = Math.round(height * pixelRatio)
		const doc = new DOMParser().parseFromString(svgText, "image/svg+xml")
		const root = doc.documentElement
		if (!root.getAttribute("viewBox")) {
			const w = root.getAttribute("width")
			const h = root.getAttribute("height")
			if (w && h) root.setAttribute("viewBox", `0 0 ${w} ${h}`)
		}
		root.setAttribute("width", String(pxW))
		root.setAttribute("height", String(pxH))
		// Fill the requested box (matching the old drawImage stretch) rather
		// than letterboxing when the capture's aspect drifts a pixel or two.
		root.setAttribute("preserveAspectRatio", "none")
		const sized = new XMLSerializer().serializeToString(root)

		const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" })
		const url = URL.createObjectURL(blob)
		const img = new Image()
		img.addEventListener("load", () => {
			try {
				const canvas = document.createElement("canvas")
				canvas.width = pxW
				canvas.height = pxH
				const ctx = canvas.getContext("2d")
				if (!ctx) {
					reject(new Error("Canvas 2D context unavailable."))
					return
				}
				if (opaqueBackground) {
					ctx.fillStyle = "#ffffff"
					ctx.fillRect(0, 0, pxW, pxH)
				}
				ctx.drawImage(img, 0, 0, pxW, pxH)
				resolve(canvas)
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)))
			} finally {
				URL.revokeObjectURL(url)
			}
		})
		img.addEventListener("error", () => {
			URL.revokeObjectURL(url)
			reject(new Error("Failed to load the chart SVG into an image."))
		})
		img.src = url
	})

const canvasToBlob = (
	canvas: HTMLCanvasElement,
	mime: string,
	quality?: number
): Promise<Blob> =>
	new Promise((resolve, reject) => {
		canvas.toBlob(
			(b) => {
				if (b) resolve(b)
				else reject(new Error("Rasterization produced no blob."))
			},
			mime,
			quality
		)
	})

const rasterizeSvg = async (
	svgText: string,
	width: number,
	height: number,
	pixelRatio: number,
	format: "png" | "jpeg"
): Promise<Blob> => {
	const canvas = await renderChartToCanvas(
		svgText,
		width,
		height,
		pixelRatio,
		format === "jpeg"
	)
	const mime = format === "png" ? "image/png" : "image/jpeg"
	const blob = await canvasToBlob(
		canvas,
		mime,
		format === "jpeg" ? 0.92 : undefined
	)
	// Stamp the true resolution (96 css-px/in × the export multiplier) so
	// physical-size consumers (PowerPoint, Word, print layouts) insert the
	// image at the inches/cm the user chose instead of guessing a DPI —
	// without it, a 2× export lands at double size and gets shrunk-to-fit.
	const dpi = 96 * pixelRatio
	const bytes = new Uint8Array(await blob.arrayBuffer())
	const stamped = format === "png" ? withPngDpi(bytes, dpi) : withJpegDpi(bytes, dpi)
	return new Blob([stamped], { type: mime })
}

// ---------------------------------------------------------------------------
// Direct PDF generation
// ---------------------------------------------------------------------------

type PdfImage = {
	filter: "FlateDecode" | "DCTDecode"
	data: Uint8Array<ArrayBuffer>
}

/** Encode the canvas pixels for embedding in a PDF. Prefers lossless
 * zlib-compressed RGB — exactly what FlateDecode expects and what
 * CompressionStream("deflate") emits — falling back to a high-quality JPEG
 * (DCTDecode) on browsers without CompressionStream. */
const encodePdfImage = async (
	canvas: HTMLCanvasElement
): Promise<PdfImage> => {
	const ctx = canvas.getContext("2d")
	if (typeof CompressionStream !== "undefined" && ctx) {
		const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
		const rgb = new Uint8Array(canvas.width * canvas.height * 3)
		for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
			rgb[j] = data[i]
			rgb[j + 1] = data[i + 1]
			rgb[j + 2] = data[i + 2]
		}
		const stream = new Blob([rgb])
			.stream()
			.pipeThrough(new CompressionStream("deflate"))
		const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
		return { filter: "FlateDecode", data: compressed }
	}
	const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.95)
	return { filter: "DCTDecode", data: new Uint8Array(await jpeg.arrayBuffer()) }
}

/** Assemble a single-page PDF whose sole content is one image stretched to
 * the page. Hand-rolled because this fixed shape needs only five objects and
 * a cross-reference table — not worth a PDF library dependency. */
const buildImagePdf = (
	pageW: number,
	pageH: number,
	imgW: number,
	imgH: number,
	image: PdfImage
): Blob => {
	const encoder = new TextEncoder()
	const parts: Uint8Array<ArrayBuffer>[] = []
	let offset = 0
	// Byte offset of each object; index 0 is PDF's reserved free object.
	const offsets: number[] = [0]
	const push = (part: string | Uint8Array<ArrayBuffer>) => {
		const bytes = typeof part === "string" ? encoder.encode(part) : part
		parts.push(bytes)
		offset += bytes.length
	}
	const pushObj = (body: string, stream?: Uint8Array<ArrayBuffer>) => {
		offsets.push(offset)
		push(`${offsets.length - 1} 0 obj\n${body}\n`)
		if (stream) {
			push("stream\n")
			push(stream)
			push("\nendstream\n")
		}
		push("endobj\n")
	}

	push("%PDF-1.4\n")
	pushObj("<< /Type /Catalog /Pages 2 0 R >>")
	pushObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	pushObj(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
			"/Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>"
	)
	pushObj(
		`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
			"/ColorSpace /DeviceRGB /BitsPerComponent 8 " +
			`/Filter /${image.filter} /Length ${image.data.length} >>`,
		image.data
	)
	const contents = encoder.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im1 Do Q`)
	pushObj(`<< /Length ${contents.length} >>`, contents)

	const xrefStart = offset
	// Each xref entry must be exactly 20 bytes: 10-digit offset, space,
	// 5-digit generation, space, type, space, newline.
	push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
	for (const o of offsets.slice(1)) {
		push(`${String(o).padStart(10, "0")} 00000 n \n`)
	}
	push(
		`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\n` +
			`startxref\n${xrefStart}\n%%EOF\n`
	)
	return new Blob(parts, { type: "application/pdf" })
}

/** Rasterize the chart at the chosen resolution and wrap it in a one-page
 * PDF sized to match the on-screen dimensions (px → pt at 96 dpi), so "Save
 * PDF" downloads directly instead of routing through the print dialog. */
const generatePdf = async (
	svgText: string,
	width: number,
	height: number,
	pixelRatio: number
): Promise<Blob> => {
	const canvas = await renderChartToCanvas(svgText, width, height, pixelRatio, true)
	const image = await encodePdfImage(canvas)
	const ptW = (width * 72) / 96
	const ptH = (height * 72) / 96
	return buildImagePdf(ptW, ptH, canvas.width, canvas.height, image)
}
