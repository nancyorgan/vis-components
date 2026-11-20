import { useCallback, useRef, useState, type ReactNode } from "react"
import { useAtom } from "jotai"
import {
	libraryRailCollapsedAtom,
	librarySidebarWidthAtom,
} from "../../chartBuilder/store/atoms"
import { RailTab } from "../../../components/ui/RailTab"
import { useNarrowLayout } from "../../../lib/useMediaQuery"

const MIN_SIDEBAR_WIDTH = 208
const MAX_SIDEBAR_WIDTH = 480

/** The library page's two columns: a folder rail on the left — resizable,
 *  collapsible, and an overlay sheet on narrow screens — and the listing
 *  beside it. Shared by the Visuals / Templates listing and the Data tab,
 *  so the rail keeps its width and collapsed state across the toggle.
 *
 *  `rail` is handed `onPicked`: call it when a pick should put the listing
 *  back in view (it closes the narrow sheet; a no-op otherwise). */
export const LibraryRailLayout = ({
	rail,
	children,
}: {
	rail: (onPicked: () => void) => ReactNode
	children: ReactNode
}) => {
	// Resizable folder sidebar — same pointer-capture pattern as the
	// editor's sidebar (EditorLayout), persisted independently of it.
	const [sidebarWidth, setSidebarWidth] = useAtom(librarySidebarWidthAtom)
	// Fully collapsed rail: neither the tree nor its resize handle render,
	// and the listing takes the whole width. The dragged width is kept so
	// re-opening restores it.
	const [railCollapsed, setRailCollapsed] = useAtom(libraryRailCollapsedAtom)
	// NARROW (phones, tablets in portrait): the rail is an overlay sheet over
	// the listing instead of a column beside it — a 200px rail would leave
	// the grid ~180px. Transient and closed on every visit, like the editor's
	// sheet; picking a folder closes it, since the listing it filters is
	// underneath.
	const narrow = useNarrowLayout()
	const [railSheetOpen, setRailSheetOpen] = useState(false)
	const resizingRef = useRef(false)
	const resizeStartXRef = useRef(0)
	const resizeStartWidthRef = useRef(0)

	const onSidebarResizeStart = useCallback(
		(e: React.PointerEvent) => {
			resizingRef.current = true
			resizeStartXRef.current = e.clientX
			resizeStartWidthRef.current = sidebarWidth
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)

			const onMove = (ev: PointerEvent) => {
				if (!resizingRef.current) return
				const delta = ev.clientX - resizeStartXRef.current
				const next = Math.min(
					MAX_SIDEBAR_WIDTH,
					Math.max(MIN_SIDEBAR_WIDTH, resizeStartWidthRef.current + delta)
				)
				setSidebarWidth(next)
			}
			const onUp = () => {
				resizingRef.current = false
				window.removeEventListener("pointermove", onMove)
				window.removeEventListener("pointerup", onUp)
			}
			window.addEventListener("pointermove", onMove)
			window.addEventListener("pointerup", onUp)
		},
		[sidebarWidth, setSidebarWidth]
	)

	const noop = () => {}

	return (
		<div className="flex">
			{/* Folder rail stays put beneath the sticky header while the page
			 *  (listing + footer) scrolls as one document. */}
			{narrow ? (
				<>
					{/* Zero-width sticky stand-in so the tab hangs off the page's
					 *  left edge at the same height it has on the open rail. */}
					<div className="vc-sticky-rail relative w-0 flex-shrink-0">
						{!railSheetOpen && (
							<RailTab
								collapsed
								label="folders"
								onClick={() => setRailSheetOpen(true)}
							/>
						)}
					</div>
					{railSheetOpen && (
						<>
							{/* Scrim below the header: tapping the listing closes. */}
							<button
								type="button"
								aria-label="Close folders"
								onClick={() => setRailSheetOpen(false)}
								className="fixed inset-x-0 top-(--vc-header-h) bottom-0 z-20 bg-stone-900/30"
							/>
							<div className="fixed top-(--vc-header-h) bottom-0 left-0 z-30 w-[calc(100%-1.5rem)] border-r border-stone-200 shadow-xl sm:w-[360px] dark:border-stone-700">
								{rail(() => setRailSheetOpen(false))}
								<RailTab
									collapsed={false}
									label="folders"
									onClick={() => setRailSheetOpen(false)}
								/>
							</div>
						</>
					)}
				</>
			) : railCollapsed ? (
				// Zero-width sticky stand-in so the tab hangs off the page's
				// left edge at the same height it had on the open rail.
				<div className="vc-sticky-rail relative w-0 flex-shrink-0">
					<RailTab
						collapsed
						label="folders"
						onClick={() => setRailCollapsed(false)}
					/>
				</div>
			) : (
				<>
					<div
						className="vc-sticky-rail flex-shrink-0"
						style={{ width: sidebarWidth }}
					>
						{rail(noop)}
					</div>
					{/* Resize handle; the pull tab hangs off its border line. */}
					{/* The handle holds the rail's pull-tab BUTTON, so the separator
					 *  role sits on a transparent overlay inside it rather than on the
					 *  handle itself (a separator may not contain a control). */}
					<div
						onPointerDown={onSidebarResizeStart}
						className="group relative flex w-1.5 flex-shrink-0 cursor-ew-resize touch-none items-center justify-center border-r border-stone-200 bg-stone-50 hover:bg-stone-200 pointer-coarse:w-3 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-700"
					>
						<div
							role="separator"
							aria-orientation="vertical"
							aria-label="Resize folders panel"
							className="absolute inset-0"
						/>
						<div className="h-8 w-0.5 rounded-full bg-stone-300 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-stone-500" />
						<RailTab
							collapsed={false}
							label="folders"
							onClick={() => setRailCollapsed(true)}
						/>
					</div>
				</>
			)}
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	)
}
