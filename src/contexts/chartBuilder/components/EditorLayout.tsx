import { useCallback, useRef } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	blackAndWhiteModeAtom,
	currentChannelConfigsAtom,
	sidebarWidthAtom,
} from "../store/atoms"
import { useAutoSave } from "../store/useAutoSave"

import { DataDrawer } from "./drawer/DataDrawer"
import { ErrorBoundary } from "./ErrorBoundary"
import { SaveBar } from "./SaveBar"
import { Sidebar } from "./sidebar/Sidebar"
import { ChartCanvas } from "./viz/ChartCanvas"

// Narrowing past the sidebar's content floor (Sidebar's `min-w-80`) is safe:
// the aside scrolls horizontally rather than squeezing its control rows.
const MIN_WIDTH = 240
const MAX_WIDTH = 560

export const EditorLayout = () => {
	useAutoSave()
	const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom)
	const blackAndWhite = useAtomValue(blackAndWhiteModeAtom)
	const canvasSizeCfg = useAtomValue(currentChannelConfigsAtom).canvasSize
	const fixedCanvas =
		canvasSizeCfg?.enabled && canvasSizeCfg.width > 0 && canvasSizeCfg.height > 0
			? canvasSizeCfg
			: null
	const draggingRef = useRef(false)
	const startXRef = useRef(0)
	const startWidthRef = useRef(0)

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			draggingRef.current = true
			startXRef.current = e.clientX
			startWidthRef.current = sidebarWidth
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)

			const onMove = (ev: PointerEvent) => {
				if (!draggingRef.current) return
				const delta = ev.clientX - startXRef.current
				const next = Math.min(
					MAX_WIDTH,
					Math.max(MIN_WIDTH, startWidthRef.current + delta)
				)
				setSidebarWidth(next)
			}
			const onUp = () => {
				draggingRef.current = false
				window.removeEventListener("pointermove", onMove)
				window.removeEventListener("pointerup", onUp)
			}
			window.addEventListener("pointermove", onMove)
			window.addEventListener("pointerup", onUp)
		},
		[sidebarWidth, setSidebarWidth]
	)

	return (
		<div className="flex h-[calc(100vh-57px)] flex-col">
			<SaveBar />
			<div
				className="grid min-h-0 flex-1"
				style={{
					gridTemplateColumns: `${sidebarWidth}px auto minmax(0,1fr)`,
				}}
			>
				{/* Sidebar gets its own boundary so a panel crash doesn't
				 *  take down the chart canvas (and vice versa). */}
				<ErrorBoundary>
					<Sidebar />
				</ErrorBoundary>
				{/* Resize handle */}
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize sidebar"
					onPointerDown={onPointerDown}
					className="group flex w-1.5 cursor-ew-resize items-center justify-center border-r border-stone-200 bg-stone-50 hover:bg-stone-200 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-700"
				>
					<div className="h-8 w-0.5 rounded-full bg-stone-300 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-stone-500" />
				</div>
				<div className="flex min-h-0 min-w-0 flex-col">
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
							<div
								className="min-h-0 flex-1 overflow-auto bg-stone-200 dark:bg-stone-800"
								style={blackAndWhite ? { filter: "grayscale(1)" } : undefined}
							>
								<div className="flex min-h-full w-max min-w-full p-6">
									<div
										data-editor-chart-viewport
										className="m-auto shrink-0 overflow-hidden bg-white shadow-md"
										style={{
											width: fixedCanvas.width,
											height: fixedCanvas.height,
										}}
									>
										<ChartCanvas />
									</div>
								</div>
							</div>
						) : (
							<div
								data-editor-chart-viewport
								className="min-h-0 flex-1 overflow-auto"
								style={blackAndWhite ? { filter: "grayscale(1)" } : undefined}
							>
								<ChartCanvas />
							</div>
						)}
					</ErrorBoundary>
					<ErrorBoundary>
						<DataDrawer />
					</ErrorBoundary>
				</div>
			</div>
		</div>
	)
}
