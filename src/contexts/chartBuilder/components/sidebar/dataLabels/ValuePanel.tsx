import type { DataLabelsConfig } from "../../../lib/channelConfig"
import {
	composedLabelTitle,
	newComposedLabelId,
} from "../../../lib/dataLabelsSelection"

import { TickFormatControl } from "../channelOptions/AxisOptionsPanel"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { Input } from "../../../../../components/ui/Input"

// ---------------------------------------------------------------------------
// Value panel — multi-field mode only ("Multiple variables…"): pick which
// fields the labels may use, give each a d3 number format (so e.g. a
// category can sit next to "32%"), and compose the labels themselves — one
// text box per label, each arranging `{Field}` tokens with literal text.
// The boxes ARE the labels: every one gets its own sections under Color,
// Size, Text, Box, Label selection and Adjust
// position, titled by its variables. Per-label COLOR lives under the Color
// dropdown, not here.
// ---------------------------------------------------------------------------
export const ValuePanel = ({
	cfg,
	onChange,
	fields,
	allFields,
	onFieldsChange,
	countryNames = false,
}: {
	/** Normalized config (`normalizeComposedLabels`): `composedLabels` is
	 *  always present here. */
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
	const labels = cfg.composedLabels ?? []
	const writeLabels = (next: typeof labels) => onChange({ composedLabels: next })

	return (
		<div className="flex flex-col gap-3">
			{/* Which fields the labels may name — checking one adds its own
			 *  `{Field}` label below; unchecking removes the labels that
			 *  compose just it. */}
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
						<Checkbox
							key={name}
							className="min-w-0 [&>label]:min-w-0 [&>label]:truncate"
							label={name}
							checked={fields.includes(name)}
							onChange={(on) => toggleField(name, on)}
						/>
					))
				)}
			</div>

			{/* Per-field format — the same preset dropdown (+ custom spec) the
			 *  x / y axes use, one per selected field. */}
			{fields.length > 0 && (
				<div className="vc-divider-group">
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

			{/* The labels. Each box starts as one variable (`{A}`); type any
			 *  arrangement of the checked variables in braces with literal
			 *  text. The × removes a label; the link adds an empty one. */}
			{fields.length > 0 && (
				<div className="vc-divider-group">
					<span className="vc-group-header">Compose labels</span>
					{labels.map((l, i) => (
						<div key={l.id} className="flex items-center gap-1">
							<Input
								type="text"
								value={l.template}
								placeholder={fields.map((f) => `{${f}}`).join(", ")}
								aria-label={`Label ${i + 1} text`}
								onChange={(e) =>
									writeLabels(
										labels.map((x) =>
											x.id === l.id ? { ...x, template: e.target.value } : x
										)
									)
								}
								className="flex-1"
							/>
							<button
								type="button"
								onClick={() => writeLabels(labels.filter((x) => x.id !== l.id))}
								className="rounded px-1 hover:bg-stone-200 hover:text-stone-800 dark:hover:bg-stone-700 dark:hover:text-white vc-muted"
								aria-label={`Remove label ${composedLabelTitle(l, fields, i)}`}
							>
								×
							</button>
						</div>
					))}
					<button
						type="button"
						onClick={() =>
							writeLabels([...labels, { id: newComposedLabelId(), template: "" }])
						}
						className="self-end text-xs text-blue-600 hover:underline dark:text-blue-400"
					>
						+ Add another label
					</button>
					<p className="vc-help">
						Each box is one label. Put variables in braces. For example,{" "}
						<code>{"{A}"}</code> or a combination like{" "}
						<code>{"{A} ({B})"}</code>.
					</p>
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
	<div className="vc-divider-group">
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
