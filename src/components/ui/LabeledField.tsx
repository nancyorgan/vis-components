import type { ReactNode } from "react"
import { combine as c } from "../../lib/cls"

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
