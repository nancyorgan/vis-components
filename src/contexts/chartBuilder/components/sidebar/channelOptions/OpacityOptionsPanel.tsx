import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_OPACITY_CATEGORICAL,
	DEFAULT_OPACITY_QUANTITATIVE,
	type OpacityConfig,
	type OpacitySlotConfig,
} from "../../../lib/channelConfig"
import { channelAccepts } from "../../../lib/channels"
import type { ChartMode } from "../../../lib/chartMode"
import { effectiveType } from "../../../lib/fieldType"
import {
	MEASURE_OPTION_VALUE,
	resolveHistogramMeasure,
} from "../../../lib/histogramMeasure"
import { applicableOpacitySlots, type OpacitySlotDef } from "../../../lib/opacitySlots"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import {
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	isFlowModeId,
	isHierarchyModeId,
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
	topLevelGroupNames,
} from "../../../lib/packedMeasure"
import { valueChanged } from "../../../lib/themeConfig"
import { makeOpacityScale, parseValue } from "../../../lib/scales"
import { preserveStackMode } from "../../../lib/stackMode"
import { orderedLevels } from "../../../lib/smartSort"
import type { FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	themeAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { StackModeRow } from "./StackModeRow"

/** The unified Opacity menu. Mirrors the Color panel: one subheader per mark
 * part, each in a white card. Fill is the overall mark opacity (it reuses the
 * `opacity` encoding + `defaultOpacity`, exactly as Color's Fill reuses `hue`);
 * Border + the generic slots (Rug / Line / Stem / Violin Fill+Outline / Radar
 * Spine) each carry their own opacity, varied by a field or set to a level. */
export const OpacityOptionsPanel = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const mode = useChartModeDef().id as ChartMode
	const slots = applicableOpacitySlots(mode, encodings, configs)
	// Area / filled-radar link the fill and outline to the series (one layer =
	// one value), mirroring the Color menu: the in-panel "Vary by" duplicates
	// the shelf's Opacity row, and the outline (Border) opacity is per-layer
	// aggregated so a per-row field mapping is a no-op — drop both selectors.
	const isAreaMode = mode === "areas-x" || mode === "areas-y"
	const isRadarFilled = mode === "radar" && configs.connection?.fillPolygon === true
	const linkedOutline = isAreaMode || isRadarFilled

	const theme = useAtomValue(themeAtom)
	// Fill subsection changed = no-field default opacity moved, or the mapped
	// opacity scale edited (same signals as the top-level Opacity dot).
	const o = configs.opacity
	const scaleChanged = o
		? o.kind === "quantitative"
			? o.min !== DEFAULT_OPACITY_QUANTITATIVE.min ||
				o.max !== DEFAULT_OPACITY_QUANTITATIVE.max
			: Object.keys(o.overrides ?? {}).length > 0
		: false
	const fillChanged =
		valueChanged(configs.defaultOpacity, theme.defaultOpacity) || scaleChanged

	// Flow diagrams (chord / sankey) draw NOTHING from the overall opacity —
	// node arcs/rects and ribbons/links each read their own slot (Nodes /
	// Ribbons below), so a Fill section here would show a level no mark uses.
	const hideFill = isFlowModeId(mode)

	return (
		<div className="vc-option-panel">
			{!hideFill && (
				<CollapsibleSubsection title="Fill" defaultOpen changed={fillChanged}>
					<div className="flex flex-col gap-2">
						<FillOpacityControls hideVaryBy={linkedOutline} />
						{/* Opacity can drive bar layout (group/stack/overlay) when 2+ stack
						    channels are mapped to different vars. StackModeRow self-gates. */}
						<StackModeRow channel="opacity" />
					</div>
				</CollapsibleSubsection>
			)}
			{slots.map((def) => (
				<OpacitySlotSubsection
					key={def.key}
					def={def}
					hideVaryBy={linkedOutline}
				/>
			))}
		</div>
	)
}

/** Overall (fill) opacity — the existing opacity encoding. Leads with a "Vary
 * by" selector two-way bound to the TOP-LEVEL opacity encoding (the same field
 * the shelf shows), mirroring Color's Fill. "Single level" shows a static
 * opacity level (with reset); a mapped field shows per-value / min–max controls. */
const FillOpacityControls = ({
	/** Hide the in-panel "Vary by" selector — area / filled-radar set the
	 * opacity field via the shelf's Opacity row, so it's redundant here. */
	hideVaryBy = false,
}: {
	hideVaryBy?: boolean
} = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useAtomValue(themeAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const fieldName = encodings.opacity.field
	// Derived sources: Fill opacity can vary by the histogram bins' Count /
	// Density, or by packed circles' nesting Depth, instead of a field.
	// Mutually exclusive with `field`.
	const measureSource = encodings.opacity?.measureSource ?? null
	const histSource =
		measureSource === "count" || measureSource === "density"
			? measureSource
			: null
	const packedSource = packedSourceOf(encodings.opacity)
	const histMeasure = dataset
		? resolveHistogramMeasure(
				encodings,
				(n) => effectiveType(dataset, n, overrides),
				configs
			)
		: null
	const packedOptions = packedDerivedOptions(
		"opacity",
		isHierarchyModeId(useChartModeDef().id),
		!!encodings.connection?.field
	)

	// "Vary by" selector — changing it here changes the shelf encoding and
	// vice-versa (both read `currentEncodingsAtom`). The aesthetic-scale build
	// applies sensible defaults for an un-configured `configs.opacity`, so just
	// writing the field is enough.
	const eligible = (dataset?.fields ?? []).filter((f) =>
		channelAccepts("opacity", overrides[f.name] ?? f.inferredType)
	)
	const varyByOptions = [
		{ value: "", label: "Single level" },
		...eligible.map((f) => ({ value: f.name, label: f.name })),
		// Histograms add ONE measure option matching the current measure mode.
		...(histMeasure
			? [
					{
						value: MEASURE_OPTION_VALUE[histMeasure.mode],
						label: histMeasure.mode === "density" ? "Density" : "Count",
					},
				]
			: []),
		// Packed circles add the hierarchy-derived options (Top-level group /
		// Nesting depth) — same list the encoding shelf's dropdown shows.
		...packedOptions.map(({ value, label }) => ({ value, label })),
	]
	const setField = (value: string) => {
		if (
			value === MEASURE_OPTION_VALUE.count ||
			value === MEASURE_OPTION_VALUE.density
		) {
			const next = value === MEASURE_OPTION_VALUE.density ? "density" : "count"
			setEncodings((prev) => ({
				...prev,
				opacity: { ...prev.opacity, field: null, measureSource: next },
			}))
			return
		}
		const packed = packedSourceForOptionValue(value)
		if (packed) {
			setEncodings((prev) => ({
				...prev,
				opacity: { ...prev.opacity, field: null, measureSource: packed },
			}))
			return
		}
		setEncodings((prev) => ({
			...prev,
			opacity: {
				...prev.opacity,
				field: value === "" ? null : value,
				measureSource: undefined,
			},
		}))
	}
	const varyBy = (
		<SelectInput
			label="Vary by"
			labelClassName={LABEL_COL}
			value={
				histSource
					? MEASURE_OPTION_VALUE[histSource]
					: packedSource
						? PACKED_MEASURE_OPTION_VALUE[packedSource]
						: (fieldName ?? "")
			}
			options={varyByOptions}
			onChange={setField}
			disabled={!dataset}
			selectClassName="flex-1"
		/>
	)

	// Packed derived variables — per-value opacity overrides: one row per
	// top-level group, or per nesting level (both are discrete; unset
	// values spread evenly, so the depth fade stays the default).
	if (packedSource && dataset) {
		const cfg =
			configs.opacity?.kind === "categorical"
				? configs.opacity
				: DEFAULT_OPACITY_CATEGORICAL
		const connectionField = encodings.connection?.field ?? ""
		const values = (
			packedSource === "rootGroup" ? topLevelGroupNames : hierarchyDepthLevels
		)(
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
		const displayValues =
			packedSource === "depth" ? values.map((v) => `Level ${v}`) : values
		const scale = makeOpacityScale(values, "categorical", cfg)
		const update = (opacity: OpacityConfig) =>
			setConfigs((prev) => ({
				...prev,
				opacity: preserveStackMode(prev.opacity, opacity),
			}))
		return (
			<div className="flex flex-col gap-2">
				{!hideVaryBy && varyBy}
				<CategoricalOpacityList
					values={values}
					labels={displayValues}
					overrides={cfg.overrides}
					resolve={(v) => Math.round((scale(v) ?? 1) * 100) / 100}
					onSet={(value, opacity) =>
						update({
							kind: "categorical",
							overrides: { ...cfg.overrides, [value]: opacity },
						})
					}
					onReset={(value) => {
						const { [value]: _removed, ...rest } = cfg.overrides
						update({ kind: "categorical", overrides: rest })
					}}
				/>
				<p className="vc-help">
					{packedSource === "rootGroup"
						? "Each circle takes its outermost group's opacity — derived from the hierarchy, no extra column needed."
						: "One opacity per nesting level (1 = outermost). Unset levels spread evenly."}
				</p>
			</div>
		)
	}

	// Histogram measure sources vary opacity by a quantitative range.
	if (measureSource) {
		const cfg =
			configs.opacity?.kind === "quantitative"
				? configs.opacity
				: DEFAULT_OPACITY_QUANTITATIVE
		return (
			<div className="flex flex-col gap-2">
				{!hideVaryBy && varyBy}
				<QuantOpacityRange
					cfg={cfg}
					onChange={(opacity) =>
						setConfigs((prev) => ({
							...prev,
							opacity: preserveStackMode(prev.opacity, opacity),
						}))
					}
				/>
				<p className="vc-help">
					Each bin&apos;s opacity scales with its{" "}
					{measureSource === "density" ? "density" : "count"}.
				</p>
			</div>
		)
	}

	// No field mapped — single overall-opacity level.
	if (!dataset || !fieldName) {
		const currentOpacity = configs.defaultOpacity ?? theme.defaultOpacity
		return (
			<div className="flex flex-col gap-2">
				{!hideVaryBy && varyBy}
				<OpacityLevelInput
					value={currentOpacity}
					defaultLevel={theme.defaultOpacity}
					onChange={(defaultOpacity) =>
						setConfigs((prev) => ({ ...prev, defaultOpacity }))
					}
				/>
				<div className="text-sm text-stone-600">
					Your default: {theme.defaultOpacity}
				</div>
			</div>
		)
	}

	const type = effectiveType(dataset, fieldName, overrides)
	const isQuantitative = type === "quantitative" || type === "temporal"
	const update = (opacity: OpacityConfig) =>
		setConfigs((prev) => ({
			...prev,
			opacity: preserveStackMode(prev.opacity, opacity),
		}))

	if (isQuantitative) {
		const cfg =
			configs.opacity?.kind === "quantitative"
				? configs.opacity
				: DEFAULT_OPACITY_QUANTITATIVE
		return (
			<div className="flex flex-col gap-2">
				{!hideVaryBy && varyBy}
				<QuantOpacityRange cfg={cfg} onChange={update} />
			</div>
		)
	}

	const cfg =
		configs.opacity?.kind === "categorical"
			? configs.opacity
			: DEFAULT_OPACITY_CATEGORICAL
	const uniqueValues = uniqueFieldValues(dataset, fieldName, type)
	return (
		<div className="flex flex-col gap-2">
			{!hideVaryBy && varyBy}
			<CategoricalOpacityList
				values={uniqueValues}
				overrides={cfg.overrides}
				resolve={makeOpacityResolver(dataset, fieldName, type, cfg)}
				order={fieldName ? levelOrders[fieldName] : undefined}
				orderType={type}
				onSet={(value, opacity) =>
					update({
						kind: "categorical",
						overrides: { ...cfg.overrides, [value]: opacity },
					})
				}
				onReset={(value) => {
					const { [value]: _removed, ...rest } = cfg.overrides
					update({ kind: "categorical", overrides: rest })
				}}
			/>
		</div>
	)
}

/** One opacity-slot subheader (Border / Rug / Line / …): a "Vary by" selector
 * (when the slot accepts a field) plus the opacity level, or per-value / min–max
 * controls when a field is mapped. Mirrors `ColorSlotSubsection`. */
const OpacitySlotSubsection = ({
	def,
	/** Linked mode (area / filled-radar): hide the "Vary by" selector and show a
	 * single opacity level. The outline (Border) is per-layer aggregated, so a
	 * per-row field mapping wouldn't apply anyway — matches the Color menu's
	 * linked outline. */
	hideVaryBy = false,
}: {
	def: OpacitySlotDef
	hideVaryBy?: boolean
}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const dataset = useCurrentDatasetView()

	const slotCfg = configs.opacitySlots?.[def.key]
	const field = slotCfg?.field ?? null
	const level = slotCfg?.level ?? def.defaultLevel

	// Merge a partial slot update, always carrying a concrete `level` and
	// `field` so the stored slot is well-formed once created.
	const updateSlot = (partial: Partial<OpacitySlotConfig>) =>
		setConfigs((prev) => {
			const existing = prev.opacitySlots?.[def.key]
			const base: OpacitySlotConfig = {
				field: existing?.field ?? null,
				level: existing?.level ?? level,
				...existing,
			}
			return {
				...prev,
				opacitySlots: {
					...prev.opacitySlots,
					[def.key]: { ...base, ...partial },
				},
			}
		})

	const fieldOptions = [
		{ value: "", label: "Single level" },
		...(dataset?.fields ?? []).map((f) => ({ value: f.name, label: f.name })),
	]

	const setField = (fieldName: string) => {
		if (fieldName === "" || !dataset) {
			updateSlot({ field: null })
			return
		}
		const t = effectiveType(dataset, fieldName, overrides)
		const isQuant = t === "quantitative" || t === "temporal"
		updateSlot({
			field: fieldName,
			opacity: isQuant ? DEFAULT_OPACITY_QUANTITATIVE : DEFAULT_OPACITY_CATEGORICAL,
		})
	}

	const fieldType = dataset && field ? effectiveType(dataset, field, overrides) : null
	const isQuant = fieldType === "quantitative" || fieldType === "temporal"

	// This slot deviates when it has a field mapped or its level moved off the
	// part's default.
	const slotChanged =
		slotCfg != null && (field != null || level !== def.defaultLevel)

	return (
		<CollapsibleSubsection title={def.label} changed={slotChanged}>
			<div className="flex flex-col gap-2">
				{def.acceptsFieldMapping && !hideVaryBy ? (
						<SelectInput
							label="Vary by"
							labelClassName={LABEL_COL}
							value={field ?? ""}
							options={fieldOptions}
							onChange={setField}
							disabled={!dataset}
							selectClassName="flex-1"
						/>
					) : null}
					{hideVaryBy || field === null || !def.acceptsFieldMapping ? (
						<OpacityLevelInput
							value={level}
							defaultLevel={def.defaultLevel}
							onChange={(next) => updateSlot({ level: next })}
						/>
					) : isQuant ? (
						<QuantOpacityRange
							cfg={
								slotCfg?.opacity?.kind === "quantitative"
									? slotCfg.opacity
									: DEFAULT_OPACITY_QUANTITATIVE
							}
							onChange={(opacity) => updateSlot({ opacity })}
						/>
					) : (
						<SlotCategoricalOpacity
							def={def}
							slotCfg={slotCfg}
							fieldName={field}
							fieldType={fieldType ?? "categorical"}
							dataset={dataset}
							updateSlot={updateSlot}
						/>
					)}
			</div>
		</CollapsibleSubsection>
	)
}

/** Per-value opacity sliders for a categorically-mapped slot. */
const SlotCategoricalOpacity = ({
	slotCfg,
	fieldName,
	fieldType,
	dataset,
	updateSlot,
}: {
	def: OpacitySlotDef
	slotCfg: OpacitySlotConfig | undefined
	fieldName: string
	fieldType: string
	dataset: ReturnType<typeof useCurrentDatasetView>
	updateSlot: (partial: Partial<OpacitySlotConfig>) => void
}) => {
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const cfg =
		slotCfg?.opacity?.kind === "categorical"
			? slotCfg.opacity
			: DEFAULT_OPACITY_CATEGORICAL
	const uniqueValues = dataset
		? uniqueFieldValues(dataset, fieldName, fieldType)
		: []
	return (
		<CategoricalOpacityList
			values={uniqueValues}
			overrides={cfg.overrides}
			order={levelOrders[fieldName]}
			orderType={fieldType as FieldType}
			resolve={
				dataset
					? makeOpacityResolver(dataset, fieldName, fieldType, cfg)
					: () => 1
			}
			onSet={(value, opacity) =>
				updateSlot({
					opacity: {
						kind: "categorical",
						overrides: { ...cfg.overrides, [value]: opacity },
					},
				})
			}
			onReset={(value) => {
				const { [value]: _removed, ...rest } = cfg.overrides
				updateSlot({ opacity: { kind: "categorical", overrides: rest } })
			}}
		/>
	)
}

/** Min/Max opacity range for a quantitatively-mapped opacity channel/slot. */
const QuantOpacityRange = ({
	cfg,
	onChange,
}: {
	cfg: Extract<OpacityConfig, { kind: "quantitative" }>
	onChange: (next: OpacityConfig) => void
}) => (
	<div className="flex flex-col gap-2">
		<NumberInput
			label="Min"
			labelClassName={LABEL_COL}
			value={cfg.min}
			min={0}
			max={1}
			step={0.05}
			clamp
			onChange={(min) => onChange({ ...cfg, min })}
		/>
		<NumberInput
			label="Max"
			labelClassName={LABEL_COL}
			value={cfg.max}
			min={0}
			max={1}
			step={0.05}
			clamp
			onChange={(max) => onChange({ ...cfg, max })}
		/>
	</div>
)

/** A single opacity-level number input with a `reset` link that appears once
 * the value differs from its default (the theme's `defaultOpacity` for Fill, or
 * the slot's `defaultLevel`). Used by every "Single level" opacity control —
 * Fill (no field), Border, Line, Stem, … — so a user who nudges a level can
 * always get back to the default. */
const OpacityLevelInput = ({
	value,
	defaultLevel,
	onChange,
}: {
	value: number
	defaultLevel: number
	onChange: (next: number) => void
}) => (
	<div className="flex items-center gap-2">
		<NumberInput
			label="Opacity"
			labelClassName={LABEL_COL}
			value={value}
			min={0}
			max={1}
			step={0.05}
			clamp
			onChange={onChange}
		/>
		{value !== defaultLevel && (
			<button
				type="button"
				onClick={() => onChange(defaultLevel)}
				className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
			>
				reset
			</button>
		)}
	</div>
)

/** Per-value opacity rows: a truncated value label + a number input + a reset
 * link for overridden values. Shared by Fill and the categorical slots.
 *
 * The number shown is the opacity actually applied to that category — i.e. the
 * scale's resolved value (`resolve`), not a hardcoded 1. A categorical opacity
 * encoding auto-distributes opacity across categories, so an un-overridden
 * category renders below 1; showing the resolved value keeps the box in sync
 * with the marks and the legend. Editing a box sets an explicit override. */
const CategoricalOpacityList = ({
	values,
	labels,
	overrides,
	resolve,
	onSet,
	onReset,
	order,
	orderType = "categorical",
}: {
	values: string[]
	/** Optional display labels, parallel to `values` — e.g. "Level 1" for
	 * the depth key "1". Storage / override keys always use `values`. */
	labels?: string[]
	overrides: Record<string, number>
	/** Opacity actually applied to a category (override, else distributed). */
	resolve: (value: string) => number
	onSet: (value: string, opacity: number) => void
	onReset: (value: string) => void
	/** User-pinned field level order (Fields reorder UI). Reorders the ROWS
	 *  only; `labels` stays keyed to each value's discovery index. Omit for
	 *  derived sources with no backing field. */
	order?: readonly string[]
	orderType?: FieldType
}) => (
	<div className="flex flex-col gap-1.5">
		{orderedLevels(values, orderType, order).map(({ value: v, index: i }) => {
			const current = resolve(v)
			const isOverridden = overrides[v] !== undefined
			return (
				<div key={v} className="flex items-center gap-2 text-sm">
					<span
						className="w-24 flex-shrink-0 truncate text-stone-700 dark:text-stone-300"
						title={labels?.[i] ?? v}
					>
						{labels?.[i] ?? v}
					</span>
					<NumberInput
						label={`Opacity for ${v}`}
						labelClassName="sr-only"
						value={current}
						min={0}
						max={1}
						step={0.05}
						clamp
						onChange={(next) => onSet(v, next)}
					/>
					{isOverridden && (
						<button
							type="button"
							onClick={() => onReset(v)}
							className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
						>
							reset
						</button>
					)}
				</div>
			)
		})}
	</div>
)

/** Build a `(category) => resolved opacity` lookup matching what the renderer
 * draws: the scale returns the per-value override when set, else the
 * auto-distributed opacity for that category. Rounded to 2 decimals for a tidy
 * box value (the tiny rounding vs. the drawn value is imperceptible). */
const makeOpacityResolver = (
	dataset: NonNullable<ReturnType<typeof useCurrentDatasetView>>,
	fieldName: string,
	type: string,
	cfg: Extract<OpacityConfig, { kind: "categorical" }>
): ((value: string) => number) => {
	const scale = makeOpacityScale(
		dataset.rows.map((r) => r[fieldName]),
		type as never,
		cfg
	)
	return (value) => Math.round((scale(value) ?? 1) * 100) / 100
}

/** Distinct stringified non-null values of a field, in first-seen order. */
const uniqueFieldValues = (
	dataset: NonNullable<ReturnType<typeof useCurrentDatasetView>>,
	fieldName: string,
	type: string
): string[] => [
	...new Set(
		dataset.rows
			.map((r) => parseValue(r[fieldName], type as never))
			.filter((v) => v !== null)
			.map(String)
	),
]
