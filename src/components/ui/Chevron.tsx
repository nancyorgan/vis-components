import { combine as c } from "../../lib/cls"

/** Single source for the sidebar's chevron glyphs so every expander shares
 *  one shape, size (10px), and stroke weight. Two variants for the two
 *  affordances in the UI:
 *  - SectionChevron: points right, rotates to point down when open. Used by
 *    section / subsection headers (AsideSection, CollapsibleSubsection).
 *  - DisclosureChevron: points down, flips up when open. Used by inline row
 *    expanders (encoding rows, field rows, per-level detail rows).
 */
const ChevronSvg = ({ d, className }: { d: string; className: string }) => (
	<svg
		viewBox="0 0 12 12"
		width={10}
		height={10}
		aria-hidden="true"
		className={className}
	>
		<path
			d={d}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

export const SectionChevron = ({ open }: { open: boolean }) => (
	<ChevronSvg
		d="M3.5 2l4 4-4 4"
		className={c("flex-shrink-0 transition-transform", open ? "rotate-90" : "")}
	/>
)

export const DisclosureChevron = ({ open }: { open: boolean }) => (
	<ChevronSvg
		d="M3 4.5l3 3 3-3"
		className={c(
			"flex-shrink-0 transition-transform",
			open ? "rotate-180" : ""
		)}
	/>
)
