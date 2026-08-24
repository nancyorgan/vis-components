import { useAtom, useAtomValue } from "jotai"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import {
	PACKED_DERIVED_LABELS,
	hierarchyDepthLevels,
	isFlowModeId,
	isHierarchyModeId,
	packedSourceOf,
	topLevelGroupNames,
	type PackedDerivedSource,
} from "../../../lib/packedMeasure"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { effectiveType } from "../../../lib/fieldType"
import {
	applyAreaScale,
	makeAreaScale,
	makeBrightnessScale,
	makeSaturationScale,
	parseValue,
} from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import { orderedLevels } from "../../../lib/smartSort"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { StackModeRow } from "./StackModeRow"

// Generic min/max numeric-range panel, used for Area (pixel radius) plus
// Saturation and Brightness (HSL component range in [0, 1]).
type Variant =
	| {
			channel: "area"
			label: string
			min: number
			max: number
			step: number
			hardMin: number
			hardMax: number
			suffix: string
	  }
	| {
			channel: "saturation" | "brightness"
			label: string
			min: number
			max: number
			step: number
			hardMin: number
			hardMax: number
			suffix: string
	  }

// min/max (the reset targets) come from the live theme in each wrapper below,
// NOT from the DEFAULT_*_CONFIG constants — the theme is what the "changed"
// dot compares against, so resetting to anything else would strand the dot.
const AREA_BASE = {
	channel: "area",
	label: "Radius",
	step: 1,
	hardMin: 1,
	hardMax: 200,
	suffix: "px",
} as const

const SATURATION_BASE = {
	channel: "saturation",
	label: "Saturation",
	step: 0.05,
	hardMin: 0,
	hardMax: 1,
	suffix: "",
} as const

const BRIGHTNESS_BASE = {
	channel: "brightness",
	label: "Brightness",
	step: 0.05,
	hardMin: 0,
	hardMax: 1,
	suffix: "",
} as const

/** Distinct categories of a NON-numeric ordinal field mapped to area, in
 *  first-seen order (matching `makeAreaScale`'s ordinal spread). Returns null
 *  when the field is absent, numeric-ordinal, or not ordinal at all — those
 *  size continuously and want the plain min/max range editor. */
const useAreaOrdinalCategories = (): string[] | null => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const fieldName = encodings.area?.field ?? null
	if (!fieldName || !dataset) return null
	if (effectiveType(dataset, fieldName, overrides) !== "ordinal") return null
	const parsed = dataset.rows
		.map((r) => parseValue(r[fieldName], "ordinal"))
		.filter((v) => v !== null) as Array<number | string>
	const numericOrdinal =
		parsed.length > 0 && parsed.every((v) => typeof v === "number")
	if (numericOrdinal) return null
	return [...new Set(parsed.map(String))]
}

export const AreaOptionsPanel = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useCurrentTheme()
	const fieldMapped = !!encodings.area?.field
	const modeId = useChartModeDef().id
	const ordinalCategories = useAreaOrdinalCategories()
	if (!fieldMapped) return <AreaDefaultPanel />
	// Packed circles compute radii from the layout, so the min/max pixel
	// range is inert there — only the Scale-by choice applies.
	if (modeId === "packed-circles")
		return (
			<div className="vc-option-panel">
				<ScaleByRow />
			</div>
		)
	// Treemap / sunburst / chord / sankey: sizes are fully layout-computed
	// AND inherently proportional (rect area / angle span / ribbon or link
	// width ∝ value) — neither the px range nor Scale-by applies, so the
	// panel just says so.
	if (isHierarchyModeId(modeId) || isFlowModeId(modeId))
		return (
			<div className="vc-option-panel">
				<p className="vc-help">
					{modeId === "treemap"
						? "Rectangle areas are computed by the treemap layout, proportional to each row's value."
						: modeId === "chord"
							? "Ribbon widths are computed by the chord layout, proportional to each flow's value."
							: modeId === "sankey"
								? "Link widths are computed by the sankey layout, proportional to each flow's value."
								: "Arc spans are computed by the sunburst layout, proportional to each row's value."}
				</p>
			</div>
		)
	// A NON-numeric ordinal sizes by category RANK, not magnitude — so there's
	// no continuous min/max range to set and no area-vs-diameter distinction
	// (both would be no-ops). Show only the per-category size editor.
	if (ordinalCategories)
		return (
			<div className="vc-option-panel">
				<AreaOrdinalLevels categories={ordinalCategories} />
			</div>
		)
	return (
		<RangePanel
			variant={{ ...AREA_BASE, min: theme.areaMin, max: theme.areaMax }}
			header={<ScaleByRow />}
		/>
	)
}

/** Per-category radius editor for a non-numeric ordinal field on area. Each
 * category shows its even-spread radius (spaced across the theme's area
 * min→max by category order) and can be pinned to an explicit px value. Unset
 * categories keep the spread, so the auto behavior is the zero-config
 * default. Mirrors the saturation/brightness `DerivedLevelsPanel`. */
const AreaOrdinalLevels = ({ categories }: { categories: string[] }) => {
	const theme = useCurrentTheme()
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// Follow the Fields reorder for row ORDER only — the spread scale below stays
	// built from discovery-order `categories`, so each level's auto radius (and
	// the drawn mark) is unchanged; only the display sequence tracks the pin.
	const areaField = useAtomValue(currentEncodingsAtom).area?.field ?? null
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const levelOrder = areaField ? levelOrders[areaField] : undefined
	const cfg = configs.area
	const min = cfg?.minRadius ?? theme.areaMin
	const max = cfg?.maxRadius ?? theme.areaMax
	const overrides = cfg?.overrides ?? {}

	// Auto-spread defaults come from the REAL scale (with overrides stripped),
	// so the shown default is exactly what an unset category renders as.
	const spreadScale = makeAreaScale(categories, "ordinal", {
		minRadius: min,
		maxRadius: max,
	})
	const spreadFor = (cat: string) =>
		Math.round((applyAreaScale(spreadScale, cat, "ordinal") ?? min) * 10) / 10

	const setOverride = (value: string, radius: number | null) =>
		setConfigs((prev) => {
			const prevCfg = prev.area ?? {
				minRadius: theme.areaMin,
				maxRadius: theme.areaMax,
			}
			const { [value]: _removed, ...rest } = prevCfg.overrides ?? {}
			return {
				...prev,
				area: {
					...prevCfg,
					overrides: radius === null ? rest : { ...rest, [value]: radius },
				},
			}
		})

	return (
		<div className="flex flex-col gap-2">
			<span className="vc-group-header">
				Size per category
			</span>
			{orderedLevels(categories, "ordinal", levelOrder).map(({ value }) => {
				const overridden = overrides[value] !== undefined
				const current = overrides[value] ?? spreadFor(value)
				return (
					<div key={value} className="flex items-center gap-2 text-sm">
						<NumberInput
							label={value}
							labelClassName={`${LABEL_COL} truncate`}
							changed={overridden}
							value={current}
							min={1}
							max={200}
							step={1}
							onChange={(n) => {
								if (n >= 1 && n <= 200) setOverride(value, n)
							}}
							inputClassName="w-20"
							suffix="px"
						/>
						{overridden && (
							<ResetLink onClick={() => setOverride(value, null)} />
						)}
					</div>
				)
			})}
			<p className="vc-help">
				Each category gets an evenly-spaced size ({min}–{max}px) in the order
				it appears in the data. Edit any value to set an exact size.
			</p>
		</div>
	)
}

/** The Area channel's "Scale by" choice — how the mapped value translates
 * to circle size, everywhere the channel sizes marks (scatter bubbles,
 * geo bubble maps, packed circles). Stored on `configs.area.sizeBy`;
 * "area" (the honest default) is stored as an ABSENT key so untouched
 * charts don't light the "changed" dot. */
const ScaleByRow = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const sizeBy = configs.area?.sizeBy ?? "area"
	const setSizeBy = (next: "area" | "diameter") =>
		setConfigs((prev) => {
			const { sizeBy: _removed, ...rest } =
				prev.area ?? { minRadius: theme.areaMin, maxRadius: theme.areaMax }
			return {
				...prev,
				area: next === "area" ? rest : { ...rest, sizeBy: next },
			}
		})
	return (
		<div className="flex flex-col gap-1.5">
			<span
				className={
					sizeBy === "diameter"
						? "text-sm font-semibold !text-vc-section-header"
						: "text-sm text-stone-600 dark:text-stone-400"
				}
			>
				Scale by
			</span>
			{(
				[
					["area", "Area — true proportions"],
					["diameter", "Diameter — exaggerates differences"],
				] as const
			).map(([value, label]) => (
				<label key={value} className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="area-size-by"
						value={value}
						checked={sizeBy === value}
						onChange={() => setSizeBy(value)}
						className="h-3 w-3"
					/>
					<span className="text-stone-600 dark:text-stone-400">{label}</span>
				</label>
			))}
			<p className="vc-help">
				Area keeps circle areas proportional to values (a doubled value
				doubles the ink); Diameter grows the radius linearly instead, which
				reads more dramatically when values span a narrow range. In packed
				circles, only Area makes a group circle read as the sum of its
				children.
			</p>
		</div>
	)
}

export const SaturationOptionsPanel = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useCurrentTheme()
	const fieldMapped = !!encodings.saturation?.field
	const derived = packedSourceOf(encodings.saturation)
	const discrete = useModulationDiscreteValues("saturation")
	if (derived)
		return (
			<DerivedLevelsPanel
				channel="saturation"
				source={derived}
				baseMin={theme.saturationMin}
				baseMax={theme.saturationMax}
			/>
		)
	if (!fieldMapped)
		return (
			<ModulationDefaultPanel
				channel="saturation"
				label="Saturation"
				configKey="defaultSaturation"
				startValue={0.6}
			/>
		)
	// Categorical / ordinal fields modulate by category, not magnitude — a
	// continuous min/max range hides the per-category levels the user actually
	// wants to set, so show one input per category instead (mirrors Opacity).
	if (discrete)
		return (
			<ModulationLevelsPanel
				channel="saturation"
				label="Saturation"
				discrete={discrete}
				baseMin={theme.saturationMin}
				baseMax={theme.saturationMax}
			/>
		)
	return (
		<RangePanel
			variant={{
				...SATURATION_BASE,
				min: theme.saturationMin,
				max: theme.saturationMax,
			}}
		/>
	)
}

export const BrightnessOptionsPanel = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const theme = useCurrentTheme()
	const fieldMapped = !!encodings.brightness?.field
	const derived = packedSourceOf(encodings.brightness)
	const discrete = useModulationDiscreteValues("brightness")
	if (derived)
		return (
			<DerivedLevelsPanel
				channel="brightness"
				source={derived}
				baseMin={theme.brightnessMin}
				baseMax={theme.brightnessMax}
			/>
		)
	if (!fieldMapped)
		return (
			<ModulationDefaultPanel
				channel="brightness"
				label="Brightness"
				configKey="defaultBrightness"
				startValue={0.5}
			/>
		)
	if (discrete)
		return (
			<ModulationLevelsPanel
				channel="brightness"
				label="Brightness"
				discrete={discrete}
				baseMin={theme.brightnessMin}
				baseMax={theme.brightnessMax}
			/>
		)
	return (
		<RangePanel
			variant={{
				...BRIGHTNESS_BASE,
				min: theme.brightnessMin,
				max: theme.brightnessMax,
			}}
		/>
	)
}

/** Distinct categories of a categorical (or non-numeric ordinal) field mapped
 *  to saturation / brightness, in first-seen order (matching the unit scale's
 *  spread order). Returns null when no field is mapped, or the field is
 *  quantitative / temporal / numeric-ordinal — those modulate continuously by
 *  value and keep the min/max range editor (same rule as the area channel). */
const useModulationDiscreteValues = (
	channel: "saturation" | "brightness"
): { values: string[]; type: FieldType } | null => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const fieldName = encodings[channel]?.field ?? null
	if (!fieldName || !dataset) return null
	const type = effectiveType(dataset, fieldName, overrides)
	if (type === "quantitative" || type === "temporal") return null
	const parsed = dataset.rows
		.map((r) => parseValue(r[fieldName], type))
		.filter((v) => v !== null) as Array<number | string>
	const numericOrdinal =
		type === "ordinal" &&
		parsed.length > 0 &&
		parsed.every((v) => typeof v === "number")
	if (numericOrdinal) return null
	return { values: [...new Set(parsed.map(String))], type }
}

/** Per-category editor for a categorical / ordinal field on saturation /
 *  brightness: one 0–1 input per category, stored in
 *  `configs[channel].overrides`. Each row shows the level actually applied —
 *  the value the REAL scale resolves (override, else the even min→max spread) —
 *  so the boxes always match the marks and the legend. Mirrors the Opacity
 *  channel's categorical editor and the packed `DerivedLevelsPanel`. */
const ModulationLevelsPanel = ({
	channel,
	label,
	discrete,
	baseMin,
	baseMax,
}: {
	channel: "saturation" | "brightness"
	label: string
	discrete: { values: string[]; type: FieldType }
	baseMin: number
	baseMax: number
}) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const fieldName = encodings[channel]?.field ?? null
	const cfg = configs[channel]
	const min = cfg?.min ?? baseMin
	const max = cfg?.max ?? baseMax
	const overrides = cfg?.overrides ?? {}

	// Resolve each row through the SAME scale the renderer builds, so an unset
	// row shows exactly what that category draws with (numeric ordinals scale
	// by value, everything else spreads evenly — the scale knows which).
	const makeScale =
		channel === "saturation" ? makeSaturationScale : makeBrightnessScale
	const scale = makeScale(
		dataset && fieldName ? dataset.rows.map((r) => r[fieldName]) : [],
		discrete.type,
		{ min, max, overrides }
	)
	const resolve = (value: string) =>
		Math.round((scale(value) ?? min) * 100) / 100

	const setOverride = (value: string, level: number | null) =>
		setConfigs((prev) => {
			const prevCfg = prev[channel] ?? { min: baseMin, max: baseMax }
			const { [value]: _removed, ...rest } = prevCfg.overrides ?? {}
			return {
				...prev,
				[channel]: {
					...prevCfg,
					overrides: level === null ? rest : { ...rest, [value]: level },
				},
			}
		})

	return (
		<div className="vc-option-panel">
			<span className="vc-group-header">{label} per category</span>
			{orderedLevels(
				discrete.values,
				discrete.type,
				fieldName ? levelOrders[fieldName] : undefined
			).map(({ value }) => {
				const overridden = overrides[value] !== undefined
				return (
					<div key={value} className="flex items-center gap-2 text-sm">
						<NumberInput
							label={value}
							labelClassName={`${LABEL_COL} truncate`}
							changed={overridden}
							value={overrides[value] ?? resolve(value)}
							min={0}
							max={1}
							step={0.05}
							clamp
							onChange={(n) => setOverride(value, n)}
							inputClassName="w-20"
						/>
						{overridden && (
							<ResetLink onClick={() => setOverride(value, null)} />
						)}
					</div>
				)
			})}
			<p className="vc-help">
				Each category gets an evenly-spaced {label.toLowerCase()} ({min}–{max})
				in the order it appears in the data. Edit any value to set an exact
				level.
			</p>
			<StackModeRow channel={channel} />
		</div>
	)
}

/** Per-value editor for a packed-circles derived variable on saturation /
 * brightness: one 0–1 input per depth level (or top-level group), stored
 * in `configs[channel].overrides` keyed by the value's string form. An
 * unset value shows (and uses) the even min→max spread, so the range fade
 * stays the zero-config default and each row is individually pinnable. */
const DerivedLevelsPanel = ({
	channel,
	source,
	baseMin,
	baseMax,
}: {
	channel: "saturation" | "brightness"
	source: PackedDerivedSource
	baseMin: number
	baseMax: number
}) => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const dataset = useCurrentDatasetView()
	const cfg = configs[channel]
	const min = cfg?.min ?? baseMin
	const max = cfg?.max ?? baseMax
	const overrides = cfg?.overrides ?? {}

	const connectionField = encodings.connection?.field ?? ""
	const values =
		dataset && connectionField
			? (source === "rootGroup" ? topLevelGroupNames : hierarchyDepthLevels)(
					dataset.rows,
					connectionField,
					resolveHierarchyIdField(
						configs.connection?.hierarchyIdField,
						dataset.rows,
						dataset.fields.map((f) => f.name),
						connectionField,
						encodings.area?.field ?? null
					),
					encodings.area?.field ?? null
				)
			: []

	// The even spread an unset value resolves to — matches the renderer's
	// ordinal / categorical unit scale over these values.
	const spreadFor = (idx: number): number => {
		const n = Math.max(1, values.length - 1)
		return Math.round((min + (idx / n) * (max - min)) * 100) / 100
	}
	const setOverride = (value: string, level: number | null) =>
		setConfigs((prev) => {
			const prevCfg = prev[channel] ?? { min: baseMin, max: baseMax }
			const { [value]: _removed, ...rest } = prevCfg.overrides ?? {}
			return {
				...prev,
				[channel]: {
					...prevCfg,
					overrides: level === null ? rest : { ...rest, [value]: level },
				},
			}
		})

	return (
		<div className="vc-option-panel">
			{values.map((value, idx) => {
				const overridden = overrides[value] !== undefined
				const current = overrides[value] ?? spreadFor(idx)
				return (
					<div key={value} className="flex items-center gap-2 text-sm">
						<NumberInput
							label={source === "depth" ? `Level ${value}` : value}
							labelClassName={LABEL_COL}
							changed={overridden}
							value={current}
							min={0}
							max={1}
							step={0.05}
							onChange={(n) => {
								// Deliberately NOT `clamp`: out-of-range typed input is
								// ignored rather than snapped to a bound, matching the
								// previous raw input (typing "5" committed nothing).
								// Spinner / arrow-key steps still clamp to [0, 1].
								if (n >= 0 && n <= 1) setOverride(value, n)
							}}
							inputClassName="w-20"
						/>
						{overridden && (
							<ResetLink onClick={() => setOverride(value, null)} />
						)}
					</div>
				)
			})}
			<p className="vc-help">
				Varying by {PACKED_DERIVED_LABELS[source].toLowerCase()}. Unset
				values spread evenly from {min} to {max}
				{source === "depth" ? " (outermost → deepest)" : ""}.
			</p>
		</div>
	)
}

const RangePanel = ({
	variant,
	header,
	footer,
}: {
	variant: Variant
	/** Optional row rendered at the top of the panel (the packed-circles
	 * "Vary by nesting depth" toggle). */
	header?: React.ReactNode
	/** Optional block rendered at the BOTTOM of the panel (the area channel's
	 * per-category ordinal size editor). */
	footer?: React.ReactNode
}) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const cfg = configs[variant.channel]

	const minKey = variant.channel === "area" ? "minRadius" : "min"
	const maxKey = variant.channel === "area" ? "maxRadius" : "max"

	// The configs carry non-number fields too (area `sizeBy`, sat/bri
	// `overrides`), so the numeric min/max lookup goes through `unknown`.
	const asNums = (c: unknown) => c as Record<string, number>
	const currentMin = cfg ? asNums(cfg)[minKey] : variant.min
	const currentMax = cfg ? asNums(cfg)[maxKey] : variant.max

	const update = (next: { min?: number; max?: number }) => {
		setConfigs((prev) => {
			const prevCfg = (prev[variant.channel] as unknown as Record<
				string,
				number
			>) ?? {
				[minKey]: variant.min,
				[maxKey]: variant.max,
			}
			return {
				...prev,
				[variant.channel]: {
					...prevCfg,
					...(next.min !== undefined && { [minKey]: next.min }),
					...(next.max !== undefined && { [maxKey]: next.max }),
				},
			}
		})
	}

	return (
		<div className="vc-option-panel">
			{header}
			<NumberInput
				label="Min"
				labelClassName={LABEL_COL}
				value={currentMin}
				min={variant.hardMin}
				max={variant.hardMax}
				step={variant.step}
				onChange={(min) => update({ min })}
				inputClassName="w-20"
				suffix={variant.suffix || undefined}
			/>
			<NumberInput
				label="Max"
				labelClassName={LABEL_COL}
				value={currentMax}
				min={variant.hardMin}
				max={variant.hardMax}
				step={variant.step}
				onChange={(max) => update({ max })}
				inputClassName="w-20"
				suffix={variant.suffix || undefined}
			/>
			<div className="vc-help">
				Defaults: {variant.min}
				{variant.suffix} – {variant.max}
				{variant.suffix}
			</div>
			<ResetLink
				onClick={() => update({ min: variant.min, max: variant.max })}
				underline
				className="self-start"
			/>
			{/* Saturation/Brightness can drive bar layout when 2+ stack channels
			    are mapped to different vars. Area doesn't stack (and "area" isn't
			    a StackChannel), so it's excluded. StackModeRow self-gates. */}
			{(variant.channel === "saturation" ||
				variant.channel === "brightness") && (
				<StackModeRow channel={variant.channel} />
			)}
			{footer}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Default panels shown when no field is mapped
// ---------------------------------------------------------------------------

const AreaDefaultPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const currentRadius = configs.defaultRadius ?? theme.defaultRadius

	return (
		<div className="vc-option-panel">
			<NumberInput
				label="Point size"
				labelClassName={LABEL_COL}
				value={currentRadius}
				min={1}
				max={200}
				step={1}
				onChange={(defaultRadius) =>
					setConfigs((prev) => ({ ...prev, defaultRadius }))
				}
				inputClassName="w-20"
				suffix="px"
			/>
			<ResetLink
				onClick={() =>
					setConfigs((prev) => ({
						...prev,
						defaultRadius: theme.defaultRadius,
					}))
				}
				underline
				className="self-start"
			/>
		</div>
	)
}

const ModulationDefaultPanel = ({
	label,
	configKey,
	startValue,
	header,
}: {
	channel: "saturation" | "brightness"
	label: string
	configKey: "defaultSaturation" | "defaultBrightness"
	/** Slider position to show when the user first enables the override. */
	startValue: number
	/** Optional row rendered at the top of the panel (the packed-circles
	 * "Vary by nesting depth" toggle). */
	header?: React.ReactNode
}) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const stored = configs[configKey]
	const enabled = stored != null
	const currentValue = stored ?? startValue

	return (
		<div className="vc-option-panel">
			{header}
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>{label}</span>
				<input
					type="range"
					min={0}
					max={1}
					step={0.05}
					value={currentValue}
					disabled={!enabled}
					onChange={(e) =>
						setConfigs((prev) => ({
							...prev,
							[configKey]: Number(e.target.value),
						}))
					}
					className="flex-1 disabled:opacity-50"
				/>
				<span className="w-10 text-right font-mono text-sm text-stone-600">
					{enabled ? currentValue.toFixed(2) : "—"}
				</span>
			</label>
			<div className="vc-help">
				{enabled
					? `Forces every mark's ${label.toLowerCase()} to this HSL value, overriding the palette.`
					: `Off — marks use their palette colors as-is.`}
			</div>
			<button
				type="button"
				onClick={() =>
					setConfigs((prev) => ({
						...prev,
						[configKey]: enabled ? null : startValue,
					}))
				}
				className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				{enabled ? "Turn off override" : "Enable override"}
			</button>
		</div>
	)
}
