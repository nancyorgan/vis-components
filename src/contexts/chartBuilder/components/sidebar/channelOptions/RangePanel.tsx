import { useAtom, useAtomValue } from "jotai"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import {
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	isHierarchyModeId,
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
	topLevelGroupNames,
	type PackedDerivedSource,
} from "../../../lib/packedMeasure"
import { explainChannelCustomization } from "../../../lib/themeConfig"
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
	MODULATION_ANCHOR,
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
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import type { ModulationSlotConfig } from "../../../lib/channelConfig"
import { channelAccepts } from "../../../lib/channels"
import { isAreaModeId } from "../../../lib/chartModes/families"
import { markPartTitles } from "../../../lib/markPartTitles"
import type { ChartMode } from "../../../lib/chartMode"
import {
	MODULATION_SLOTS_KEY,
	applicableModulationSlots,
	modulationSlotEdited,
	type ModulationChannel,
	type ModulationSlotDef,
} from "../../../lib/modulationSlots"
import { usePureDensityCurve } from "../../../store/usePureDensityCurve"
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
	const modeDef = useChartModeDef()
	const ordinalCategories = useAreaOrdinalCategories()
	if (!fieldMapped) return <AreaDefaultPanel />
	// What the area channel MEANS here is the mode's declared
	// `canvas.areaRole` — the panel never compares mode ids.
	//
	// Layout-computed radii (packed circles): the min/max pixel range is
	// inert — only the Scale-by choice applies.
	if (modeDef.canvas.areaRole === "layoutRadius")
		return (
			<div className="vc-option-panel">
				<ScaleByRow />
			</div>
		)
	// Proportional layouts (treemap / sunburst / chord / sankey): sizes are
	// fully layout-computed AND inherently proportional (rect area / angle
	// span / ribbon or link width ∝ value) — neither the px range nor
	// Scale-by applies, so there is nothing to show.
	if (modeDef.canvas.areaRole === "proportional") return null
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
	// The Fields reorder sets the RANK: the spread scale below re-ranks the
	// levels by the pinned order (first → min, last → max), so each row's auto
	// radius matches the drawn mark and the size legend after a reorder.
	const areaField = useAtomValue(currentEncodingsAtom).area?.field ?? null
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const levelOrder = areaField ? levelOrders[areaField] : undefined
	const cfg = configs.area
	const min = cfg?.minRadius ?? theme.areaMin
	const max = cfg?.maxRadius ?? theme.areaMax
	const overrides = cfg?.overrides ?? {}

	// Auto-spread defaults come from the REAL scale (with overrides stripped),
	// so the shown default is exactly what an unset category renders as.
	const spreadScale = makeAreaScale(
		categories,
		"ordinal",
		{ minRadius: min, maxRadius: max },
		undefined,
		true,
		levelOrder,
	)
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
						: "text-sm vc-muted"
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
					<span className="vc-muted">{label}</span>
				</label>
			))}
		</div>
	)
}

export const SaturationOptionsPanel = () => (
	<ModulationPartsPanel channel="saturation" fill={<SaturationFillControls />} />
)

export const BrightnessOptionsPanel = () => (
	<ModulationPartsPanel channel="brightness" fill={<BrightnessFillControls />} />
)

/** Saturation / Brightness menu, split by mark part like Color and Opacity:
 *  one purple option panel holding a white card per part. Fill leads with a
 *  "Vary by" selector bound to the channel's own encoding (the shelf row),
 *  then the pre-split editor; Outline / Line follow where the renderer reads
 *  them. Fill is always a subsection, even with no other part on offer, so
 *  the menu has one shape across chart types. */
const ModulationPartsPanel = ({
	channel,
	fill,
}: {
	channel: ModulationChannel
	fill: React.ReactNode
}) => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const modeDef = useChartModeDef()
	const mode = modeDef.id as ChartMode
	// Pure density curve: the points (and so their outlines) aren't drawn.
	const pureDensityCurve = usePureDensityCurve()
	const slots = applicableModulationSlots(mode, encodings, configs).filter(
		(d) => !(pureDensityCurve && d.key === "outline")
	)
	// Subheader titles — "Point fill" / "Point outline" / "Connection line"
	// where the marks are points beside another part (radar polygon, violin /
	// box, a line chart's line).
	const titles = markPartTitles(modeDef, configs, encodings)

	// Fill dot — the SAME change data the encoding-row dot uses (so the two
	// can't disagree), minus the part slots, which dot their own subsections.
	const fillChanged = explainChannelCustomization(
		channel,
		configs,
		theme,
		!!encodings[channel]?.field
	).some((label) => label !== `${channel} slots`)

	const slotSection = (def: (typeof slots)[number]) => (
		<ModulationSlotSubsection
			key={def.key}
			channel={channel}
			// The Outline slot is the marks' outline and the Line slot the
			// connection line — titled per mode, like the Fill.
			def={
				def.key === "outline"
					? { ...def, label: titles.outline }
					: def.key === "line"
						? { ...def, label: titles.line }
						: def
			}
		/>
	)
	// Area charts lead with the Line, then the Area fill, Point fill and
	// Point outline.
	const leadSlots = isAreaModeId(mode) ? slots.filter((d) => d.key === "line") : []
	const restSlots = slots.filter((d) => !leadSlots.includes(d))

	return (
		<div className="vc-option-panel">
			{leadSlots.map(slotSection)}
			<CollapsibleSubsection
				title={titles.fill}
				defaultOpen
				changed={fillChanged}
			>
				<FillVaryBy channel={channel} />
				{fill}
			</CollapsibleSubsection>
			{restSlots.map(slotSection)}
		</div>
	)
}

/** One part's saturation / brightness (Outline / Line): a "Vary by" selector,
 *  then the single-level control (— none —), a min/max range (quantitative
 *  field) or one level per category (categorical field). Mirrors the Opacity
 *  menu's `OpacitySlotSubsection`. */
const ModulationSlotSubsection = ({
	channel,
	def,
}: {
	channel: ModulationChannel
	def: ModulationSlotDef
}) => {
	const fieldOverrides = useAtomValue(currentFieldOverridesAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const dataset = useCurrentDatasetView()
	const slotsKey = MODULATION_SLOTS_KEY[channel]
	const label = channel === "saturation" ? "Saturation" : "Brightness"
	const baseMin = theme[`${channel}Min`]
	const baseMax = theme[`${channel}Max`]

	const slotCfg = configs[slotsKey]?.[def.key]
	const field = slotCfg?.field ?? null
	const range = slotCfg?.range ?? { min: baseMin, max: baseMax }

	// Merge a partial update, always carrying a concrete `field` and `level`
	// so the stored slot is well-formed once created.
	const updateSlot = (partial: Partial<ModulationSlotConfig>) =>
		setConfigs((prev) => {
			const existing = prev[slotsKey]?.[def.key]
			const base: ModulationSlotConfig = {
				field: existing?.field ?? null,
				level: existing?.level ?? null,
				...existing,
			}
			return {
				...prev,
				[slotsKey]: {
					...prev[slotsKey],
					[def.key]: { ...base, ...partial },
				},
			}
		})

	const fieldOptions = [
		{ value: "", label: "— none —" },
		...(dataset?.fields ?? [])
			.filter((f) =>
				channelAccepts(channel, fieldOverrides[f.name] ?? f.inferredType)
			)
			.map((f) => ({ value: f.name, label: f.name })),
	]
	const setField = (name: string) =>
		updateSlot(
			name === ""
				? { field: null }
				: { field: name, range: { min: baseMin, max: baseMax } }
		)

	const discrete = discreteValuesFor(dataset, field, fieldOverrides)
	const setOverride = (value: string, level: number | null) => {
		const { [value]: _removed, ...rest } = range.overrides ?? {}
		updateSlot({
			range: {
				...range,
				overrides: level === null ? rest : { ...rest, [value]: level },
			},
		})
	}
	const setRange = (next: { min?: number; max?: number }) =>
		updateSlot({ range: { ...range, ...next } })

	return (
		<CollapsibleSubsection
			title={def.label}
			changed={modulationSlotEdited(slotCfg)}
		>
			<div className="flex flex-col gap-2">
				<SelectInput
					label="Vary by"
					labelClassName={LABEL_COL}
					value={field ?? ""}
					options={fieldOptions}
					onChange={setField}
					disabled={!dataset}
					selectClassName="flex-1"
				/>
				{field === null ? (
					<ModulationLevelControl
						label={label}
						value={slotCfg?.level ?? null}
						onChange={(level) => updateSlot({ level })}
						partNoun={def.label.toLowerCase()}
					/>
				) : discrete ? (
					<ModulationCategoryList
						channel={channel}
						label={label}
						fieldName={field}
						discrete={discrete}
						min={range.min}
						max={range.max}
						overrides={range.overrides ?? {}}
						onSetOverride={setOverride}
					/>
				) : (
					<>
						<NumberInput
							label="Min"
							labelClassName={LABEL_COL}
							value={range.min}
							min={0}
							max={1}
							step={0.05}
							clamp
							onChange={(min) => setRange({ min })}
							inputClassName="w-20"
						/>
						<NumberInput
							label="Max"
							labelClassName={LABEL_COL}
							value={range.max}
							min={0}
							max={1}
							step={0.05}
							clamp
							onChange={(max) => setRange({ max })}
							inputClassName="w-20"
						/>
						{(range.min !== baseMin || range.max !== baseMax) && (
							<ResetLink
								onClick={() => setRange({ min: baseMin, max: baseMax })}
								underline
								className="self-start"
							/>
						)}
					</>
				)}
			</div>
		</CollapsibleSubsection>
	)
}

/** Fill's "Vary by" — two-way bound to the TOP-LEVEL saturation / brightness
 *  encoding (the field the shelf row shows), so changing it here changes the
 *  shelf and vice-versa. Mirrors Color's and Opacity's Fill. "— none —" leaves
 *  the single-level control; packed circles add the hierarchy-derived options
 *  (Top-level group / Nesting depth), same list as the shelf's dropdown. */
const FillVaryBy = ({ channel }: { channel: ModulationChannel }) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const dataset = useCurrentDatasetView()
	const fieldName = encodings[channel]?.field ?? null
	const packedSource = packedSourceOf(encodings[channel])
	const packedOptions = packedDerivedOptions(
		channel,
		isHierarchyModeId(useChartModeDef().id),
		!!encodings.connection?.field
	)
	const eligible = (dataset?.fields ?? []).filter((f) =>
		channelAccepts(channel, overrides[f.name] ?? f.inferredType)
	)
	const options = [
		{ value: "", label: "— none —" },
		...eligible.map((f) => ({ value: f.name, label: f.name })),
		...packedOptions.map(({ value, label }) => ({ value, label })),
	]
	const setField = (value: string) => {
		// A derived source picked → store the source, clear the field (mutually
		// exclusive); a field (or "— none —") clears any derived source.
		const packed = packedSourceForOptionValue(value)
		setEncodings((prev) => ({
			...prev,
			[channel]: packed
				? { ...prev[channel], field: null, measureSource: packed }
				: {
						...prev[channel],
						field: value === "" ? null : value,
						measureSource: undefined,
					},
		}))
	}
	return (
		<SelectInput
			label="Vary by"
			labelClassName={LABEL_COL}
			value={
				packedSource
					? PACKED_MEASURE_OPTION_VALUE[packedSource]
					: (fieldName ?? "")
			}
			options={options}
			onChange={setField}
			disabled={!dataset}
			selectClassName="flex-1"
		/>
	)
}

const SaturationFillControls = () => {
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
				label="Saturation"
				configKey="defaultSaturation"
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
			nested
		/>
	)
}

const BrightnessFillControls = () => {
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
				label="Brightness"
				configKey="defaultBrightness"
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
			nested
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
	return discreteValuesFor(
		dataset,
		encodings[channel]?.field ?? null,
		overrides
	)
}

/** Pure core of `useModulationDiscreteValues`, for any field (the Outline /
 *  Line slots carry their own field rather than the channel's encoding). */
const discreteValuesFor = (
	dataset: ReturnType<typeof useCurrentDatasetView>,
	fieldName: string | null,
	overrides: Record<string, FieldType>
): { values: string[]; type: FieldType } | null => {
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
	const fieldName = encodings[channel]?.field ?? null
	const cfg = configs[channel]

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
		<div className="flex flex-col gap-2">
			<ModulationCategoryList
				channel={channel}
				label={label}
				fieldName={fieldName}
				discrete={discrete}
				min={cfg?.min ?? baseMin}
				max={cfg?.max ?? baseMax}
				overrides={cfg?.overrides ?? {}}
				onSetOverride={setOverride}
			/>
			<StackModeRow channel={channel} />
		</div>
	)
}

/** One 0–1 input per category, each showing the level the REAL scale
 *  resolves (override, else the even min→max spread). Shared by the Fill's
 *  categorical editor and the Outline / Line slots. */
const ModulationCategoryList = ({
	channel,
	label,
	fieldName,
	discrete,
	min,
	max,
	overrides,
	onSetOverride,
}: {
	channel: "saturation" | "brightness"
	label: string
	fieldName: string | null
	discrete: { values: string[]; type: FieldType }
	min: number
	max: number
	overrides: Record<string, number>
	onSetOverride: (value: string, level: number | null) => void
}) => {
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const setOverride = onSetOverride

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

	return (
		<>
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
		</>
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
		<div className="flex flex-col gap-2">
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
		</div>
	)
}

const RangePanel = ({
	variant,
	header,
	footer,
	nested = false,
}: {
	variant: Variant
	/** Optional row rendered at the top of the panel (the packed-circles
	 * "Vary by nesting depth" toggle). */
	header?: React.ReactNode
	/** Optional block rendered at the BOTTOM of the panel (the area channel's
	 * per-category ordinal size editor). */
	footer?: React.ReactNode
	/** Rendered inside a subsection's white card (saturation / brightness
	 * Fill): a plain column, not the purple option panel — the panel is the
	 * card's parent, and a purple box inside a white box isn't a thing. */
	nested?: boolean
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
		<div className={nested ? "flex flex-col gap-2" : "vc-option-panel"}>
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
			{(currentMin !== variant.min || currentMax !== variant.max) && (
				<ResetLink
					onClick={() => update({ min: variant.min, max: variant.max })}
					underline
					className="self-start"
				/>
			)}
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
			{currentRadius !== theme.defaultRadius && (
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
			)}
		</div>
	)
}

const ModulationDefaultPanel = ({
	label,
	configKey,
	header,
}: {
	label: string
	configKey: "defaultSaturation" | "defaultBrightness"
	/** Optional row rendered at the top of the panel (the packed-circles
	 * "Vary by nesting depth" toggle). */
	header?: React.ReactNode
}) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	return (
		<div className="flex flex-col gap-2">
			{header}
			<ModulationLevelControl
				label={label}
				value={configs[configKey] ?? null}
				onChange={(next) =>
					setConfigs((prev) => ({ ...prev, [configKey]: next }))
				}
			/>
		</div>
	)
}

/** The single-level saturation / brightness control: a 0–1 slider that is
 *  OFF (`null`, no modulation) until enabled. Shared by the Fill's no-field
 *  default and every part slot (Outline / Line) with no field mapped. */
const ModulationLevelControl = ({
	label,
	value,
	onChange,
	partNoun = "mark",
}: {
	label: string
	value: number | null
	onChange: (next: number | null) => void
	/** What the help text says gets shifted ("mark", "outline", "line"). */
	partNoun?: string
}) => {
	const enabled = value != null
	// Enabling starts ON the anchor — a no-op the user then dials away from —
	// so switching the override on never jolts the chart's colors.
	const currentValue = value ?? MODULATION_ANCHOR
	const atAnchor = currentValue === MODULATION_ANCHOR
	// A mark's fill IS its palette color; an outline / line has its own color
	// (theme outline, Line color slot), so the copy doesn't call it "palette".
	const colorNoun = partNoun === "mark" ? "palette color" : "color"

	return (
		<>
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>{label}</span>
				<input
					type="range"
					min={0}
					max={1}
					step={0.05}
					value={currentValue}
					disabled={!enabled}
					onChange={(e) => onChange(Number(e.target.value))}
					className="flex-1 disabled:opacity-50"
				/>
				<span className="w-10 text-right font-mono text-sm vc-muted">
					{enabled ? currentValue.toFixed(2) : "—"}
				</span>
			</label>
			{(!enabled || atAnchor) && (
				<div className="vc-help">
					{!enabled
						? `Off — ${partNoun}s use their ${colorNoun}s as-is.`
						: `On, at ${MODULATION_ANCHOR} — every ${partNoun}'s ${colorNoun}, unchanged. Dial away from ${MODULATION_ANCHOR} to shift it.`}
				</div>
			)}
			{enabled && !atAnchor && (
				<ResetLink
					ariaLabel="Reset to the palette color"
					onClick={() => onChange(MODULATION_ANCHOR)}
					underline
					className="self-start"
				/>
			)}
			<button
				type="button"
				onClick={() => onChange(enabled ? null : MODULATION_ANCHOR)}
				className="self-start text-sm underline hover:text-stone-900 dark:hover:text-white vc-muted"
			>
				{enabled ? "Turn off override" : "Enable override"}
			</button>
		</>
	)
}
