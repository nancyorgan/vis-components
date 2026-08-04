import { useState } from "react"

import { SectionChevron } from "./Chevron"

/** A collapsible subsection inside an option panel ("purple box"). Renders
 *  the existing uppercase subheader text with a leading chevron; clicking the
 *  header toggles the body. Purely navigational — it never changes the
 *  options it wraps. Collapsed by default so a freshly-opened panel shows a
 *  compact list of section headers; collapse state is local (resets when the
 *  panel unmounts, e.g. switching channels), which keeps it simple and avoids
 *  cross-panel title collisions.
 *
 *  Spacing is owned entirely by the parent panel's flex `gap` so every
 *  subsection — in every panel — sits the same distance apart whether open or
 *  closed. (It deliberately adds no top border / padding of its own; that's
 *  what used to make AxisOptionsPanel's collapsed sections sit farther apart
 *  than FacetOptionsPanel's.)
 *
 *  Replaces the bare subheader components that used to sit above their
 *  content as siblings — callers now wrap the content as `children`. */
export const CollapsibleSubsection = ({
	title,
	children,
	defaultOpen = false,
	/** Optional control rendered at the right edge of the header row (does not
	 *  toggle collapse). */
	right,
	/** Wrap the body in a rounded white card so each subsection's content reads
	 *  as one visual group. On by default (every panel's subheaders match);
	 *  pass `false` for a subsection nested inside an already-boxed one to avoid
	 *  a box-in-box. */
	boxed = true,
	/** Show the "changed" dot in the header when any control in this subsection
	 *  deviates from its default — mirrors the encoding-row chevron dot so the
	 *  user can follow the dots down to the exact subsection. */
	changed = false,
}: {
	title: React.ReactNode
	children: React.ReactNode
	defaultOpen?: boolean
	right?: React.ReactNode
	boxed?: boolean
	changed?: boolean
}) => {
	const [open, setOpen] = useState(defaultOpen)
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					className="font-heading text-vc-section-header flex flex-1 items-center gap-1 text-left text-xs font-semibold tracking-wider uppercase hover:opacity-80"
				>
					<SectionChevron open={open} />
					{title}
					{changed && (
						<span
							className="ml-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-stone-900 dark:bg-white"
							aria-hidden="true"
						/>
					)}
				</button>
				{right}
			</div>
			{open &&
				(boxed ? (
					<div className="rounded-md bg-white p-2 dark:bg-stone-900">
						{children}
					</div>
				) : (
					children
				))}
		</div>
	)
}
