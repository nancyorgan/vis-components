import { combine as c } from "../../../../lib/cls"

/** Facet targeting for a setting that can apply to some panels only.
 *  The all-facets toggle checked ⇒ `facetKeys` is null = every panel (the
 *  default). Unchecking reveals a checkbox per facet so the user picks
 *  exactly which panels the setting applies to. Callers render it only
 *  when the chart is actually faceted. `facetOptions` come from
 *  `facetPanelOptions(resolveFacetPanels(…))` so the stored keys match the
 *  panels PlotCanvas renders against. */
export const FacetScopeControl = ({
	label,
	facetKeys,
	facetOptions,
	onChange,
	className,
}: {
	/** The all-facets toggle text, e.g. "Apply to all facets". */
	label: string
	facetKeys: string[] | null | undefined
	facetOptions: ReadonlyArray<{ key: string; label: string }>
	onChange: (next: string[] | null) => void
	className?: string
}) => {
	const applyAll = facetKeys == null
	const keys = facetOptions.map((o) => o.key)
	return (
		<div className={c("flex flex-col gap-1.5", className)}>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={applyAll}
					onChange={(e) => onChange(e.target.checked ? null : [...keys])}
					className="h-3 w-3"
				/>
				<span className="vc-muted">{label}</span>
			</label>
			{!applyAll && (
				<div className="flex flex-col gap-1 pl-5">
					{facetOptions.map((o) => (
						<label key={o.key} className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={facetKeys?.includes(o.key) ?? false}
								onChange={(e) => {
									const set = new Set(facetKeys ?? [])
									if (e.target.checked) set.add(o.key)
									else set.delete(o.key)
									// Keep stored keys in panel order for stable display.
									onChange(keys.filter((k) => set.has(k)))
								}}
								className="h-3 w-3"
							/>
							<span
								className="min-w-0 truncate vc-text"
								title={o.label}
							>
								{o.label}
							</span>
						</label>
					))}
				</div>
			)}
		</div>
	)
}
