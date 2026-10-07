import type { DataLabelsConfig } from "../../../lib/channelConfig"
import {
	POPULATION_TEMPLATE_LABEL,
	defaultSharedTemplate,
	populationTemplateFallback,
	presentPopulations,
	type LabelSelection,
} from "../../../lib/dataLabelsSelection"

import { TickFormatControl } from "../channelOptions/AxisOptionsPanel"
import { Input } from "../../../../../components/ui/Input"

// ---------------------------------------------------------------------------
// Value panel — multi-field mode only ("Multiple variables…"): pick which
// fields to combine, arrange them in the editable label text, and give each a
// d3 number format (so e.g. a category can sit next to "32%"). Per-variable
// COLOR lives under the Color dropdown (one slot per variable), not here.
// ---------------------------------------------------------------------------
export const ValuePanel = ({
	cfg,
	onChange,
	fields,
	allFields,
	onFieldsChange,
	selection,
	countryNames = false,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	fields: string[]
	allFields: string[]
	onFieldsChange: (fields: string[]) => void
	/** The resolved label populations (from the per-field "Which labels"
	 *  selects). Decides whether the single "Label text" box splits into one
	 *  box per population. */
	selection: LabelSelection
	/** Offer the Geography "Full country name" preset in the per-field
	 *  format dropdowns — countries-level geo charts only. */
	countryNames?: boolean
}) => {
	const toggleField = (name: string, on: boolean) =>
		onFieldsChange(on ? [...fields, name] : fields.filter((f) => f !== name))
	const emptyHint = fields.length > 0 ? null : "Check some fields above"

	return (
		<div className="flex flex-col gap-3">
			{/* Which fields to include — check order sets the pre-filled order. */}
			<div className="flex flex-col gap-1">
				<span className="vc-group-header">
					Fields to include
				</span>
				{allFields.length === 0 ? (
					<p className="vc-help">
						No dataset fields.
					</p>
				) : (
					allFields.map((name) => (
						<label key={name} className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={fields.includes(name)}
								onChange={(e) => toggleField(name, e.target.checked)}
							/>
							<span className="truncate">{name}</span>
						</label>
					))
				)}
			</div>

			{/* Editable label text — pre-filled with the checked fields (kept in
			 *  sync until hand-edited). Each field name in braces is replaced by
			 *  that row's value; edit the surrounding text freely. When the
			 *  per-field "Which labels" selects name more than one population
			 *  (e.g. a value on every label, the series name on the last), the
			 *  single box splits into one per population: "Label text" for the
			 *  all-labels text, "First label text" / "Last label text" for the
			 *  series ends. The end boxes write their endpoint's template
			 *  override; an empty one uses the placeholder's arrangement. */}
			{selection.split ? (
				presentPopulations(selection).map((pop) =>
					pop === "all" ? (
						<label key={pop} className="flex flex-col gap-1 text-sm">
							<span className="vc-muted">
								{POPULATION_TEMPLATE_LABEL.all}
							</span>
							<Input
								type="text"
								value={cfg.labelTemplate ?? ""}
								placeholder={
									emptyHint ?? defaultSharedTemplate(selection, fields)
								}
								onChange={(e) => onChange({ labelTemplate: e.target.value })}
								className="w-full"
							/>
						</label>
					) : (
						<label key={pop} className="flex flex-col gap-1 text-sm">
							<span className="vc-muted">
								{POPULATION_TEMPLATE_LABEL[pop]}
							</span>
							<Input
								type="text"
								value={cfg[`${pop}Label`]?.labelTemplate ?? ""}
								placeholder={
									emptyHint ??
									populationTemplateFallback(cfg, selection, pop)
								}
								onChange={(e) => {
									const key = `${pop}Label` as const
									const next = { ...(cfg[key] ?? {}) }
									if (e.target.value === "") delete next.labelTemplate
									else next.labelTemplate = e.target.value
									onChange({ [key]: next })
								}}
								className="w-full"
							/>
						</label>
					)
				)
			) : (
				<label className="flex flex-col gap-1 text-sm">
					<span className="vc-muted">
						{POPULATION_TEMPLATE_LABEL.all}
					</span>
					<Input
						type="text"
						value={cfg.labelTemplate ?? ""}
						placeholder={emptyHint ?? defaultSharedTemplate(selection, fields)}
						onChange={(e) => onChange({ labelTemplate: e.target.value })}
						className="w-full"
					/>
				</label>
			)}

			{/* Per-field format — the same preset dropdown (+ custom spec) the
			 *  x / y axes use, one per selected field. */}
			{fields.length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="vc-group-header">
						Label format
					</span>
					{fields.map((name) => (
						<TickFormatControl
							key={name}
							label={name}
							value={cfg.fieldFormats?.[name] ?? ""}
							changed={(cfg.fieldFormats?.[name] ?? "") !== ""}
							countryNames={countryNames}
							onChange={(spec) => {
								const next = { ...(cfg.fieldFormats ?? {}) }
								if (spec === "") delete next[name]
								else next[name] = spec
								onChange({ fieldFormats: next })
							}}
						/>
					))}
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Value panel — single-field mode: just the mapped field's label format,
// stored under the field's name in the same `fieldFormats` map multi mode
// uses (so a format set here carries over to "Multiple variables…" and back).
// ---------------------------------------------------------------------------
export const SingleValuePanel = ({
	field,
	cfg,
	onChange,
	countryNames = false,
}: {
	field: string
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	/** Offer the Geography "Full country name" preset in the format
	 *  dropdown — countries-level geo charts only. */
	countryNames?: boolean
}) => (
	<div className="flex flex-col gap-1">
		<span className="vc-group-header">Label format</span>
		<TickFormatControl
			label={field}
			value={cfg.fieldFormats?.[field] ?? ""}
			changed={(cfg.fieldFormats?.[field] ?? "") !== ""}
			countryNames={countryNames}
			onChange={(spec) => {
				const next = { ...(cfg.fieldFormats ?? {}) }
				if (spec === "") delete next[field]
				else next[field] = spec
				onChange({ fieldFormats: next })
			}}
		/>
	</div>
)
