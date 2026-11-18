import { useCallback, useEffect, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	blackAndWhiteModeAtom,
	currentChannelConfigsAtom,
	currentDataTableConfigAtom,
	currentVisualIdAtom,
	currentVisualPublishedAtom,
	editorSheetOpenAtom,
	editorSidebarHiddenAtom,
	fixedCanvasZoomAtom,
	sidebarWidthAtom,
} from "../store/atoms"
import { useAutoSave } from "../store/useAutoSave"
import { useEditorHistory } from "../store/editorHistory"
import { RailTab } from "../../../components/ui/RailTab"
import { useNarrowLayout } from "../../../lib/useMediaQuery"
import { resolveCanvasZoom } from "../lib/canvasZoom"
import { migrateDataTableConfig } from "../lib/dataTableConfig"

import { DataDrawer } from "./drawer/DataDrawer"
import { DerivedVariableModal } from "./drawer/DerivedVariableModal"
import { TemplateRebindBanner } from "./TemplateRebindBanner"
import { ErrorBoundary } from "./ErrorBoundary"
import { CanvasZoomControls } from "./CanvasZoomControls"
import { SaveBar } from "./SaveBar"
import { Sidebar } from "./sidebar/Sidebar"
import { ChartCanvas } from "./viz/ChartCanvas"
import { EditorCanvasContext } from "./viz/EditorCanvasContext"
import {
	ChartWithDataTable,
	DataTableBlock,
	DataTableTabs,
	dataTableOpenAtom,
} from "./viz/DataTableBlock"
import { AccessibilityCheckOverlay } from "./accessibility/AccessibilityCheckPanel"
import { useEnsureCurrentDatasetLoaded } from "../store/useCurrentDatasetView"
import { SIDEBAR_MIN_WIDTH } from "../lib/storage"
import { scrollbarGutter } from "../../../lib/scrollbarGutter"

// The column never goes narrower than the width that shows every control
// row in full (lib/storage.ts): below it the aside scrolls horizontally and
// the trailing control of each row slips out of view, which reads as the
// option not existing. Dragging the handle past the floor collapses the
// column away instead — once the pointer is COLLAPSE_PAST_MIN beyond it, so
// overshooting the floor by a few pixels doesn't snap the menu shut.
// Both bounds are on the STORED width, which leaves out the gutter the
// aside reserves for a classic vertical scrollbar (`scrollbar-gutter:
// stable`, Sidebar.tsx); the column adds that at layout time (0 where
// scrollbars overlay the content), so one stored number fits every machine.
const MIN_WIDTH = SIDEBAR_MIN_WIDTH
const MAX_WIDTH = 560
const COLLAPSE_PAST_MIN = 80

/** Purple frame around the chart viewport while the open visual is
 *  published: the reminder that edits here reach embedded content (there is
 *  deliberately no modal on entry — it fired before anything had changed).
 *  Drawn as an INSET SHADOW, not a border: the export/embed defaults measure this
 *  element's bounding rect (`measureEditorChartSize` in ExportModal), so a
 *  real border would silently inflate every default export by 8px. */
const PUBLISHED_FRAME_CLASS =
	"shadow-[inset_0_0_0_4px_var(--color-brand-500)]"

/** Padding around the fixed-canvas rectangle (`p-6` on each side). */
const FIXED_CANVAS_PAD = 48

/** NARROW layouts lay a fluid chart out at least this wide and shrink it to
 *  fit: fonts, margins and tick spacing are designed for a desktop
 *  viewport, so reflowing to a 390px phone crowds everything. Below this
 *  width the chart is composed as on a desktop and scaled down instead —
 *  the same display-only transform the fixed canvas uses. Tablets in
 *  portrait (≥ 720px available) still reflow at their true width. */
const MIN_FLUID_LAYOUT_WIDTH = 720
/** …and at least this tall relative to that width (a 5:3 figure), so
 *  opening the data tray on a phone scrolls the chart rather than
 *  squashing its rows into whatever height is left. */
const MIN_FLUID_LAYOUT_ASPECT = 0.6

/** Live content size of an element, via ResizeObserver (0×0 until
 *  measured), plus `maxHeight`: the tallest it has been at the CURRENT
 *  width. Opening the data tray shortens the chart host; a fluid narrow
 *  chart keeps composing at that taller height and scrolls behind the
 *  tray instead of squashing its rows. A width change (rotation) resets it.
 *  Takes the element from state (a callback ref), not a ref object: the
 *  chart host mounts only once the visual has loaded, after a ref effect
 *  keyed on mount would already have run against null. */
const useElementSize = (el: HTMLElement | null) => {
	const [size, setSize] = useState({ width: 0, height: 0, maxHeight: 0 })
	useEffect(() => {
		if (!el || typeof ResizeObserver === "undefined") return
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return
			const { width, height } = entry.contentRect
			setSize((prev) => ({
				width,
				height,
				maxHeight: width === prev.width ? Math.max(prev.maxHeight, height) : height,
			}))
		})
		ro.observe(el)
		return () => ro.disconnect()
	}, [el])
	return size
}

export const EditorLayout = () => {
	// Opening a visualization is what pulls its rows down — nothing loads row
	// data before this point.
	useEnsureCurrentDatasetLoaded()
	useAutoSave()
	// Undo / redo stack for the draft + ⌘Z / ⌘⇧Z. Lives here, beside
	// autosave, because both watch the same draft.
	useEditorHistory()
	const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom)
	const [gutter] = useState(scrollbarGutter)
	const columnWidth = Math.max(MIN_WIDTH, sidebarWidth) + gutter
	// Two layouts for the left menu. WIDE (≥1024px): a resizable column the
	// pull tab collapses away, persisted. NARROW (phones, tablets in
	// portrait): the chart takes the whole width and the menu is an overlay
	// sheet opened from the same tab — transient, closed on every visit so
	// opening a visual lands on the chart.
	const narrow = useNarrowLayout()
	const [sidebarHidden, setSidebarHidden] = useAtom(editorSidebarHiddenAtom)
	const [sheetOpen, setSheetOpen] = useAtom(editorSheetOpenAtom)
	const blackAndWhite = useAtomValue(blackAndWhiteModeAtom)
	const canvasSizeCfg = useAtomValue(currentChannelConfigsAtom).canvasSize
	// The data table (Sidebar → Data table) renders under the figure inside
	// the scroll region — outside the zoomed canvas frame and the solver. In
	// a tab it instead wraps the chart viewport (DataTableTabs) — or, with a
	// fixed canvas, the chart inside the canvas. A fixed canvas's box under
	// it shows the table below the chart, or the opened table behind the
	// button (whose View data link sits inside the canvas).
	const dataTableCfg = migrateDataTableConfig(useAtomValue(currentDataTableConfigAtom))
	const dataTableOpen = useAtomValue(dataTableOpenAtom)
	const dataTableUnderCanvas =
		dataTableCfg.enabled &&
		(dataTableCfg.placement === "below" ||
			(dataTableCfg.placement === "button" && dataTableOpen))
	const publishedFrame = useAtomValue(currentVisualPublishedAtom)
		? ` ${PUBLISHED_FRAME_CLASS}`
		: ""
	const fixedCanvas =
		canvasSizeCfg?.enabled && canvasSizeCfg.width > 0 && canvasSizeCfg.height > 0
			? canvasSizeCfg
			: null
	// Display zoom for a fixed canvas (the zoom pill, lib/canvasZoom.ts).
	// The canvas still LAYS OUT at its true size (the whole point of a fixed
	// canvas) and is shrunk with a CSS transform — display only. DOM
	// measurements that feed exports, embeds and thumbnails read layout size
	// (offsetWidth / offsetParent math), not transformed rects, so they're
	// unaffected. Automatic zoom: wide layouts show the true-size, scrolling
	// canvas; NARROW ones shrink it to the viewport width, since a canvas
	// wider than a phone would otherwise need panning. Zoom never goes past
	// 100%, and it resets to automatic when a different visual opens.
	const [canvasZoom, setCanvasZoom] = useAtom(fixedCanvasZoomAtom)
	const currentVisualId = useAtomValue(currentVisualIdAtom)
	useEffect(() => setCanvasZoom(null), [currentVisualId, setCanvasZoom])
	const [chartHost, setChartHost] = useState<HTMLDivElement | null>(null)
	const chartHostSize = useElementSize(chartHost)
	const fixedScale = fixedCanvas
		? resolveCanvasZoom(canvasZoom, {
				narrow,
				avail: {
					width: chartHostSize.width && chartHostSize.width - FIXED_CANVAS_PAD,
					height:
						chartHostSize.height && chartHostSize.height - FIXED_CANVAS_PAD,
				},
				canvas: fixedCanvas,
			})
		: 1
	// Fluid chart on a narrow screen: compose at the design width and scale
	// down so the viewport shows the whole figure. Height is the host's
	// height in layout units, so the scaled chart fills the host exactly.
	const fluid = (() => {
		const { width, maxHeight } = chartHostSize
		if (!narrow || width === 0 || width >= MIN_FLUID_LAYOUT_WIDTH) return null
		const scale = width / MIN_FLUID_LAYOUT_WIDTH
		const layoutHeight = Math.round(
			Math.max(
				maxHeight / scale,
				MIN_FLUID_LAYOUT_WIDTH * MIN_FLUID_LAYOUT_ASPECT
			)
		)
		return {
			scale,
			layoutWidth: MIN_FLUID_LAYOUT_WIDTH,
			layoutHeight,
			// The scaled footprint the host actually scrolls over.
			footprintHeight: Math.round(layoutHeight * scale),
		}
	})()
	const draggingRef = useRef(false)
	const startXRef = useRef(0)
	const startWidthRef = useRef(0)

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			draggingRef.current = true
			startXRef.current = e.clientX
			startWidthRef.current = sidebarWidth
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)

			const onUp = () => {
				draggingRef.current = false
				window.removeEventListener("pointermove", onMove)
				window.removeEventListener("pointerup", onUp)
			}
			const onMove = (ev: PointerEvent) => {
				if (!draggingRef.current) return
				const raw = startWidthRef.current + ev.clientX - startXRef.current
				if (raw < MIN_WIDTH - COLLAPSE_PAST_MIN) {
					// Dragged well past the floor: collapse the column. Its
					// handle unmounts with it, so the drag ends here. The stored
					// width stays at the floor, so the pull tab reopens the menu
					// with every row in full.
					onUp()
					setSidebarWidth(MIN_WIDTH)
					setSidebarHidden(true)
					return
				}
				setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw)))
			}
			window.addEventListener("pointermove", onMove)
			window.addEventListener("pointerup", onUp)
		},
		[sidebarWidth, setSidebarWidth, setSidebarHidden]
	)

	const sidebar = (
		// Sidebar gets its own boundary so a panel crash doesn't take down
		// the chart canvas (and vice versa).
		<ErrorBoundary>
			<Sidebar />
		</ErrorBoundary>
	)

	const showSidebarColumn = !narrow && !sidebarHidden

	return (
		<div className="flex vc-page-fill flex-col">
			<SaveBar />
			<div
				className="relative grid min-h-0 flex-1"
				style={{
					gridTemplateColumns: showSidebarColumn
						? `${columnWidth}px auto minmax(0,1fr)`
						: "minmax(0,1fr)",
				}}
			>
				{showSidebarColumn && (
					<>
						<div className="min-h-0">{sidebar}</div>
						{/* Resize handle; the pull tab hangs off its border line. */}
						{/* The handle holds the rail's pull-tab BUTTON, so the separator
						 *  role sits on a transparent overlay inside it rather than on the
						 *  handle itself (a separator may not contain a control). */}
						<div
							onPointerDown={onPointerDown}
							className="group relative flex w-1.5 cursor-ew-resize touch-none items-center justify-center border-r border-stone-200 bg-stone-50 hover:bg-stone-200 pointer-coarse:w-3 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-700"
						>
							<div
								role="separator"
								aria-orientation="vertical"
								aria-label="Resize sidebar"
								className="absolute inset-0"
							/>
							<div className="h-8 w-0.5 rounded-full bg-stone-300 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-stone-500" />
							<RailTab
								collapsed={false}
								onClick={() => setSidebarHidden(true)}
							/>
						</div>
					</>
				)}
				{!narrow && sidebarHidden && (
					// Zero-width stand-in at the page edge so the tab hangs
					// where the column's edge used to be.
					<div className="absolute top-0 left-0 z-10 w-0">
						<RailTab collapsed onClick={() => setSidebarHidden(false)} />
					</div>
				)}
				{narrow && !sheetOpen && (
					<div className="absolute top-0 left-0 z-10 w-0">
						<RailTab collapsed onClick={() => setSheetOpen(true)} />
					</div>
				)}
				{narrow && sheetOpen && (
					<>
						{/* Scrim: tapping the chart closes the sheet. */}
						<button
							type="button"
							aria-label="Close menu"
							onClick={() => setSheetOpen(false)}
							className="absolute inset-0 z-10 bg-stone-900/30"
						/>
						{/* The sheet leaves a 1.5rem strip of the chart showing on
						 *  phones so the tab has somewhere to sit; on tablets it's
						 *  a panel at the desktop column's floor width, so its rows
						 *  show in full there too. */}
						<div
							className="absolute inset-y-0 left-0 z-20 w-[calc(100%-1.5rem)] border-r border-stone-200 shadow-xl sm:w-(--vc-sheet-width) dark:border-stone-700"
							style={
								{ "--vc-sheet-width": `${columnWidth}px` } as React.CSSProperties
							}
						>
							{sidebar}
							<RailTab collapsed={false} onClick={() => setSheetOpen(false)} />
						</div>
					</>
				)}
				{/* relative: the accessibility check card docks over the chart. */}
				<div className="relative flex min-h-0 min-w-0 flex-col">
					{/* Above the scroll region (never inside it), so exports,
					 *  thumbnails and the solver don't see it. */}
					<TemplateRebindBanner />
					<EditorCanvasContext.Provider value>
						<ErrorBoundary>
							{/* data-editor-chart-viewport marks the element whose size the
							 *  Export modal defaults its output dimensions to — the export
							 *  embed then solves an identical layout, so absolute-pixel
							 *  title offsets land where the user sees them (rather than
							 *  shifting under a reflow at a different size). With a fixed
							 *  canvas size the marker moves to the white canvas rectangle
							 *  itself, so exports default to the prescribed dimensions. */}
							{fixedCanvas ? (
								// Fixed canvas size (Aesthetics → Canvas size): the chart
								// draws inside a white width × height rectangle centered in
								// the viewport; the rest of the viewport is shaded gray and
								// scrolls when the rectangle exceeds it. `w-max min-w-full`
								// keeps the gray backdrop covering the full scroll range,
								// and `m-auto` (not justify/align-center) keeps the
								// rectangle's top-left reachable when it overflows.
								// The relative wrapper pins the zoom pill to the viewport's
								// corner while the gray host beneath it scrolls.
								<div className="relative flex min-h-0 flex-1 flex-col">
									<div
										ref={setChartHost}
										// Focusable so a keyboard user can scroll a canvas larger
										// than the viewport (arrow keys / Page Up/Down).
										// eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be focusable (WCAG 2.1.1)
										tabIndex={0}
										role="region"
										aria-label="Chart canvas"
										className={`min-h-0 flex-1 overflow-auto bg-stone-200 dark:bg-stone-800${publishedFrame}`}
										style={blackAndWhite ? { filter: "grayscale(1)" } : undefined}
									>
										<div
											className={`flex min-h-full w-max min-w-full p-6${dataTableUnderCanvas ? " flex-col" : ""}`}
										>
											{/* Outer box takes the SCALED footprint so centering
											 *  and scrolling see the shrunken size; the inner
											 *  canvas keeps its true dimensions and is
											 *  transformed from its top-left corner. */}
											<div
												// overflow-hidden: the inner canvas's LAYOUT box is
												// still true-size (transforms don't change layout),
												// and without clipping it would widen the `w-max`
												// wrapper and make the host scroll into blank space.
												className={`${dataTableUnderCanvas ? "mx-auto" : "m-auto"} shrink-0 overflow-hidden`}
												style={{
													width: fixedCanvas.width * fixedScale,
													height: fixedCanvas.height * fixedScale,
												}}
											>
												<div
													data-editor-chart-viewport
													className="overflow-hidden bg-white shadow-md"
													style={{
														width: fixedCanvas.width,
														height: fixedCanvas.height,
														transform:
															fixedScale < 1 ? `scale(${fixedScale})` : undefined,
														transformOrigin: "top left",
													}}
												>
													<DataTableTabs className="h-full">
														<ChartWithDataTable inCanvas>
															<ChartCanvas />
														</ChartWithDataTable>
													</DataTableTabs>
												</div>
											</div>
											{/* Under the white canvas, at its displayed width —
											 *  not scaled with it (the zoom is display-only for
											 *  the figure; the table stays readable). */}
											{dataTableUnderCanvas && (
												<div
													className="mx-auto mt-4 shrink-0 bg-white shadow-md"
													style={{ width: fixedCanvas.width * fixedScale }}
												>
													<DataTableBlock underCanvas />
												</div>
											)}
										</div>
									</div>
									<CanvasZoomControls
										zoom={canvasZoom}
										scale={fixedScale}
										onChange={setCanvasZoom}
									/>
								</div>
							) : (
								<DataTableTabs className="min-h-0 flex-1">
									{fluid ? (
										<div
											ref={setChartHost}
											className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto${publishedFrame}`}
											style={blackAndWhite ? { filter: "grayscale(1)" } : undefined}
										>
											{/* Footprint box: the scaled size, clipping the true-size
											 *  layout box so only the host's vertical scroll sees it. */}
											<div
												className="overflow-hidden"
												style={{ height: fluid.footprintHeight }}
											>
												<div
													data-editor-chart-viewport
													style={{
														width: fluid.layoutWidth,
														height: fluid.layoutHeight,
														transform: `scale(${fluid.scale})`,
														transformOrigin: "top left",
													}}
												>
													<ChartCanvas />
												</div>
											</div>
											<DataTableBlock />
										</div>
									) : (
										<div
											ref={setChartHost}
											data-editor-chart-viewport
											className={`min-h-0 flex-1 overflow-auto${publishedFrame}`}
											style={blackAndWhite ? { filter: "grayscale(1)" } : undefined}
										>
											<ChartWithDataTable>
												<ChartCanvas />
											</ChartWithDataTable>
										</div>
									)}
								</DataTableTabs>
							)}
						</ErrorBoundary>
					</EditorCanvasContext.Provider>
					<ErrorBoundary>
						<DataDrawer />
					</ErrorBoundary>
					{/* Header → Accessibility check: a sibling of the scroll
					 *  region, never inside the chart (the solver, exports and
					 *  thumbnails must not see it). */}
					<ErrorBoundary>
						<AccessibilityCheckOverlay />
					</ErrorBoundary>
				</div>
			</div>
			{/* The derived-variable create/edit popup — mounted at the layout
			 *  level (it portals to <body>) so it survives drawer collapse and
			 *  sidebar re-layout while open. */}
			<ErrorBoundary>
				<DerivedVariableModal />
			</ErrorBoundary>
		</div>
	)
}
