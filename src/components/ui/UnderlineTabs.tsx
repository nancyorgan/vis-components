/** Page-level "which list am I looking at" switch: a row of text tabs, the
 *  chosen one underlined in the brand color. Sits on a hairline (the parent
 *  row draws the `border-b`; `-mb-px` here lays the underline over it).
 *  For the library's Visuals / Templates / Data switch — a setting inside
 *  a sidebar panel is still `Segmented`. Same radiogroup semantics as
 *  `Segmented`, so the two are interchangeable to assistive tech. */
export const UnderlineTabs = <K extends string>({
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
}) => (
	<div
		role="radiogroup"
		aria-label={ariaLabel}
		data-tip={tipAnchor}
		className={`-mb-px flex gap-5 ${className ?? ""}`}
	>
		{segments.map((s) => {
			const active = value === s.key
			return (
				<button
					key={s.key}
					type="button"
					role="radio"
					aria-checked={active}
					onClick={() => onChange(s.key)}
					className={`border-b-2 px-0.5 pt-1 pb-2 text-sm transition-colors vc-focus-ring ${
						active
							? "border-vc-brand-text font-semibold text-vc-brand-text dark:border-brand-300 dark:text-brand-200"
							: "border-transparent hover:border-stone-300 hover:text-stone-900 dark:hover:border-stone-600 dark:hover:text-white vc-text"
					}`}
				>
					{s.label}
				</button>
			)
		})}
	</div>
)
