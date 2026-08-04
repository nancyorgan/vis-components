import type { ReactNode } from "react"
import { combine as c } from "../../lib/cls"

/** Canonical sidebar label column, passed as `labelClassName`: a fixed w-24
 *  column so every row's control starts on the same vertical edge, in the
 *  muted label color. One shared constant (rather than per-file copies) so
 *  the column width and shade can't drift between panels. */
export const LABEL_COL = "w-24 text-stone-600 dark:text-stone-400"

/** Label column for rows nested inside an `ml-6` sub-block (controls
 *  subordinate to a toggle/group header): 1.5rem narrower than LABEL_COL so
 *  indent + label + gap still lands the control on the shared column. */
export const LABEL_COL_NESTED = "w-18 text-stone-600 dark:text-stone-400"

/** Empty stand-in for the label column: indents a secondary control (one
 *  with no label of its own) so it aligns under the value column of
 *  LABEL_COL rows. */
export const LabelSpacer = () => <span className="w-24 shrink-0" aria-hidden />

/** LabelSpacer's counterpart for rows inside an `ml-6` sub-block — matches
 *  LABEL_COL_NESTED's width so the spaced control lands on the shared column. */
export const LabelSpacerNested = () => (
	<span className="w-18 shrink-0" aria-hidden />
)

/** Wraps a form control with its visual label. Used internally by every
 *  labeled primitive (`NumberInput`, `ColorInput`, `SelectInput`,
 *  `Toggle`) so they all produce consistent markup with a proper
 *  `<label htmlFor>` association — which screen readers + keyboard
 *  users depend on.
 *
 *  `inline` (default) lays label + control on one row (label on the
 *  left); `stacked` puts the label above the control. */
export const LabeledField = ({
	id,
	label,
	className,
	labelClassName,
	inline = true,
	changed,
	children,
}: {
	/** Required — every control needs a stable id so `<label htmlFor>`
	 *  hits the right element. Callers pass `useId()` or a hand-picked
	 *  static id. */
	id: string
	label: ReactNode
	className?: string
	labelClassName?: string
	/** When `true` (the default), label and control sit on one row.
	 *  When `false`, they stack — useful when the control is wide or
	 *  the label is long. */
	inline?: boolean
	/** When `true`, the label is emphasized (bold + accent purple) to mark that
	 *  this control deviates from its default — the per-line leaf of the
	 *  encoding-row → subsection → control trail. The `!` overrides whatever
	 *  color the caller set via `labelClassName`. */
	changed?: boolean
	children: ReactNode
}) => (
	<div
		className={c(
			inline
				? "flex items-center gap-2 text-sm"
				: "flex flex-col gap-1 text-sm",
			className
		)}
	>
		<label
			htmlFor={id}
			className={c(
				inline
					? "shrink-0 text-stone-700 dark:text-stone-300"
					: "text-stone-700 dark:text-stone-300",
				labelClassName,
				changed && "font-semibold !text-vc-section-header"
			)}
		>
			{label}
		</label>
		{children}
	</div>
)
