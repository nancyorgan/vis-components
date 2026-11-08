/** THE "choose one of a few" control for the sidebar: a single row of
 *  segmented buttons (Stack / Group / Overlay, Linear / Polynomial, Round /
 *  Square …). Use it whenever there are four or fewer short options; longer
 *  lists use `RadioGroup`. An on/off setting is not a choice between options —
 *  that is `Checkbox`. Styling comes from the `.vc-toggle-on` / `.vc-toggle-off`
 *  classes in vis-components.css. */
export const Segmented = <K extends string>({
	ariaLabel,
	value,
	segments,
	onChange,
	className,
	tipAnchor,
}: {
	ariaLabel: string
	/** `data-tip` anchor for a helper tip (src/tips/tips.ts). */
	tipAnchor?: string
	value: K
	segments: ReadonlyArray<{ key: K; label: string }>
	onChange: (key: K) => void
	className?: string
}) => {
	const segBase =
		"px-2 py-1 text-sm border-l first:border-l-0 border-vc-brand-text"
	const segClass = (active: boolean) =>
		active ? `${segBase} vc-toggle-on` : `${segBase} vc-toggle-off`
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			data-tip={tipAnchor}
			className={`inline-flex self-start overflow-hidden rounded border border-vc-brand-text ${className ?? ""}`}
		>
			{segments.map((s) => (
				<button
					key={s.key}
					type="button"
					role="radio"
					aria-checked={value === s.key}
					onClick={() => onChange(s.key)}
					className={segClass(value === s.key)}
				>
					{s.label}
				</button>
			))}
		</div>
	)
}
