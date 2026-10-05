import { RailChevron } from "./Chevron"

/** Pull tab on a side rail's outer edge: collapses the rail away, and when
 *  collapsed sits on the page's left edge to bring it back. Positioned
 *  `left-full` of a `relative` wrapper so its borderless left edge meets the
 *  divider line: the resize handle when open (the handle carries the
 *  rail's border), or a zero-width stand-in at the page edge when
 *  collapsed. Both states put the tab at the same height.
 *
 *  The +1px when open is the wrapper's right border: `left: 100%` resolves
 *  against the PADDING box, so without it the tab's white body paints over
 *  the divider line and breaks it. Collapsed wrappers are borderless, so
 *  they stay on a bare `left-full`. */
export const RailTab = ({
	collapsed,
	onClick,
	label = "menu",
}: {
	collapsed: boolean
	onClick: () => void
	/** What the tab hides/shows, for the tooltip: "folders", "menu"… */
	label?: string
}) => {
	const title = collapsed ? `Show ${label}` : `Collapse ${label}`
	return (
		<button
			type="button"
			onClick={onClick}
			// Inside the resize handle, a press on the tab must not start a
			// drag-resize.
			onPointerDown={(e) => e.stopPropagation()}
			title={title}
			aria-label={title}
			className={`absolute top-3 z-10 ${collapsed ? "left-full" : "left-[calc(100%+1px)]"} flex h-10 w-4 items-center justify-center rounded-r border border-l-0 border-stone-200 bg-white text-stone-400 shadow-sm hover:bg-stone-100 hover:text-stone-700 pointer-coarse:h-12 pointer-coarse:w-6 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800 dark:hover:text-white`}
		>
			<RailChevron direction={collapsed ? "right" : "left"} />
		</button>
	)
}
