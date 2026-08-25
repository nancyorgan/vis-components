import {
	effectiveLabelPoints,
	type DataLabelsConfig,
} from "../../../lib/channelConfig"

import { TickFormatControl } from "../channelOptions/AxisOptionsPanel"
import { defaultLabelTemplate } from "./shared"

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
	countryNames = false,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	fields: string[]
	allFields: string[]
	onFieldsChange: (fields: string[]) => void
	/** Offer the Geography "Full country name" preset in the per-field
	 *  format dropdowns — countries-level geo charts only. */
	countryNames?: boolean
}) => {
	const toggleField = (name: string, on: boolean) =>
		onFieldsChange(on ? [...fields, name] : fields.filter((f) => f !== name))
	const textInputClass =
		"w-full rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"

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
			 *  that row's value; edit the surrounding text freely. With "first
			 *  and last per series" selected, the single input splits into a
			 *  first/last pair: each writes its endpoint's template override and
			 *  an empty box inherits the shared arrangement (the placeholder). */}
			{effectiveLabelPoints(cfg) === "first-last" ? (
				(["firstLabel", "lastLabel"] as const).map((key) => (
					<label key={key} className="flex flex-col gap-1 text-sm">
						<span className="text-stone-600 dark:text-stone-400">
							{key === "firstLabel" ? "First label text" : "Last label text"}
						</span>
						<input
							type="text"
							value={cfg[key]?.labelTemplate ?? ""}
							placeholder={
								cfg.labelTemplate ||
								(fields.length > 0
									? defaultLabelTemplate(fields)
									: "Check some fields above")
							}
							onChange={(e) => {
								const next = { ...(cfg[key] ?? {}) }
								if (e.target.value === "") delete next.labelTemplate
								else next.labelTemplate = e.target.value
								onChange({ [key]: next })
							}}
							className={textInputClass}
						/>
					</label>
				))
			) : (
				<label className="flex flex-col gap-1 text-sm">
					<span className="text-stone-600 dark:text-stone-400">Label text</span>
					<input
						type="text"
						value={cfg.labelTemplate ?? ""}
						placeholder={
							fields.length > 0
								? defaultLabelTemplate(fields)
								: "Check some fields above"
						}
						onChange={(e) => onChange({ labelTemplate: e.target.value })}
						className={textInputClass}
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
