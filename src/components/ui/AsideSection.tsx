import type { PropsWithChildren } from "react"
import { useAtom } from "jotai"
import { sidebarCollapsedAtom } from "../../contexts/chartBuilder/store/atoms"
import { combine as c } from "../../lib/cls"
import { SectionChevron } from "./Chevron"

// Local mirror of external-ui's ExplorerSuiteAsideSection. Wraps a sidebar
// section with a consistent h2 header (directly under the editor's h1) and
// content area. Collapsible by default — collapsed state is keyed by `title`
// and persists across reloads.
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

/** DOM id of an AsideSection's body: `aside-section-<slug of title>`. */
export const asideSectionId = (title: string): string =>
	`aside-section-${title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")}`

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

	// Slugged: raw titles carry spaces and "&" ("Aesthetics & Theme"), which
	// make an invalid IDREF for aria-controls. Stable so e2e can find a body.
	const bodyId = asideSectionId(title)
	// Helper-tip anchor (src/tips/tips.ts): `section-<slug>`.
	const tipAnchor = bodyId.replace(/^aside-section-/, "section-")
	const headingClass =
		"text-vc-section-header flex items-center gap-1.5 text-base font-semibold tracking-wider uppercase"

	return (
		// Tighter rhythm below `lg` (phones, tablets in portrait): a column of
		// collapsed sections otherwise spends most of a small screen on gaps.
		//
		// Both bottom paddings exist for an OPEN section: the header row's
		// separates the heading from its body, the wrapper's separates the body
		// from the divider below. A collapsed section has no body, so it drops
		// both and the heading sits the same distance (the stack's gap) from
		// the divider below as from the one above.
		<div
			className={c(
				"flex flex-col",
				!collapsed && "pb-1.5 lg:pb-3",
				className
			)}
		>
			<div
				className={c(
					"mx-3 flex items-center justify-between",
					!collapsed && "pb-1 lg:pb-2"
				)}
			>
				{collapsible ? (
					// The heading wraps the toggle (not the other way round) so
					// assistive tech still exposes the section title as a heading.
					<h2 className="flex flex-1" data-tip={tipAnchor}>
						<button
							type="button"
							onClick={toggle}
							className={c(
								headingClass,
								"flex-1 text-left hover:opacity-80 pointer-coarse:py-1.5"
							)}
							aria-expanded={!collapsed}
							aria-controls={bodyId}
						>
							<SectionChevron open={!collapsed} />
							{title}
						</button>
					</h2>
				) : (
					<h2 className={headingClass} data-tip={tipAnchor}>
						{title}
					</h2>
				)}
				{right}
			</div>
			{!collapsed && (
				<div id={bodyId} className="vc-jump-target relative px-3">
					{children}
				</div>
			)}
		</div>
	)
}
