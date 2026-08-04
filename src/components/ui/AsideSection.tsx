import type { PropsWithChildren } from "react"
import { useAtom } from "jotai"
import { sidebarCollapsedAtom } from "../../contexts/chartBuilder/store/atoms"
import { combine as c } from "../../lib/cls"
import { SectionChevron } from "./Chevron"

// Local mirror of external-ui's ExplorerSuiteAsideSection. Wraps a sidebar
// section with a consistent h3 header and content area. Collapsible by default
// — collapsed state is keyed by `title` and persists across reloads.
type Props = PropsWithChildren<{
	title: string
	right?: React.ReactNode
	className?: string
	/** Set to false to disable the collapse toggle. Defaults to true. */
	collapsible?: boolean
	/** Starting state for the first visit (before the user has toggled).
	 * Ignored on subsequent visits — the user's last toggle wins. */
	defaultCollapsed?: boolean
}>

export const AsideSection = ({
	title,
	right,
	className,
	children,
	collapsible = true,
	defaultCollapsed = false,
}: Props) => {
	const [collapsedMap, setCollapsedMap] = useAtom(sidebarCollapsedAtom)
	const stored = collapsedMap[title]
	const collapsed = collapsible ? (stored ?? defaultCollapsed) : false
	const toggle = () =>
		setCollapsedMap((prev) => ({ ...prev, [title]: !collapsed }))

	const headerContent = (
		<h3 className="text-vc-section-header flex items-center gap-1.5 text-base font-semibold tracking-wider uppercase">
			{collapsible && <SectionChevron open={!collapsed} />}
			{title}
		</h3>
	)

	return (
		<div className={c("flex flex-col pb-3", className)}>
			<div className="mx-3 flex items-center justify-between pb-2">
				{collapsible ? (
					<button
						type="button"
						onClick={toggle}
						className="flex flex-1 items-center gap-1.5 text-left hover:opacity-80"
						aria-expanded={!collapsed}
						aria-controls={`aside-section-${title}`}
					>
						{headerContent}
					</button>
				) : (
					headerContent
				)}
				{right}
			</div>
			{!collapsed && (
				<div id={`aside-section-${title}`} className="relative px-3">
					{children}
				</div>
			)}
		</div>
	)
}
