import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_OPACITY_CATEGORICAL,
	DEFAULT_OPACITY_QUANTITATIVE,
	type OpacityConfig,
	type OpacitySlotConfig,
} from "../../../lib/channelConfig"
import { channelAccepts } from "../../../lib/channels"
import { effectiveType } from "../../../lib/fieldType"
import {
	MEASURE_OPTION_VALUE,
	resolveHistogramMeasure,
} from "../../../lib/histogramMeasure"
import { opacitySlotEdited, type OpacitySlotDef } from "../../../lib/opacitySlots"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import {
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
	topLevelGroupNames,
} from "../../../lib/packedMeasure"
import { isHierarchyModeId } from "../../../lib/chartModes/families"
import { opacitySections } from "../../../lib/markParts"
import { valueChanged } from "../../../lib/themeConfig"
import { makeOpacityScale } from "../../../lib/scales"
import { preserveStackMode } from "../../../lib/stackMode"
import { orderedLevels } from "../../../lib/smartSort"
import type { FieldType } from "../../../lib/types"
import { uniqueFieldValues } from "../../../lib/uniqueFieldValues"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { usePureDensityCurve } from "../../../store/usePureDensityCurve"
import { useVaryByFieldFilter } from "../../../store/useVaryByFieldFilter"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { Slider } from "../../../../../components/ui/Slider"
import { ResetLink } from "../../../../../components/ui/ResetLink"
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
	const modeDef = useChartModeDef()
	// PURE density curve (standalone "Density" display): the renderer suppresses
	// the scatter marks, so the overall Fill opacity and the mark Outline
	// (border) slot have nothing to act on — hidden, mirroring the Color menu.
	// Histogram + curve keeps them (the bars still render).
	const pureDensityCurve = usePureDensityCurve()
	// Which subsections this chart shows, their titles and their order are
	// decided in one place for every menu (lib/markParts) — including where
	// the in-panel "Vary by" is dropped (the area modes link fill and outline
	// to the series) and where the Fill is (flow diagrams draw nothing from
	// the overall opacity).
	const sections = opacitySections({ modeDef, encodings, configs, pureDensityCurve })

	const theme = useCurrentTheme()
	// Fill subsection changed = no-field default opacity moved, or the mapped
	// opacity scale edited (same signals as the top-level Opacity dot). Scale
	// edits are retained when the Vary-by field is cleared (so remapping
	// restores them), but with no field the panel shows no scale controls, so a
	// stale edit must not light a dot the user can't clear — gate on the field,
	// exactly as the top-level dot does.
	const o = configs.opacity
	const scaleChanged = o
		? o.kind === "quantitative"
			? o.min !== DEFAULT_OPACITY_QUANTITATIVE.min ||
				o.max !== DEFAULT_OPACITY_QUANTITATIVE.max
			: Object.keys(o.overrides ?? {}).length > 0
		: false
	const fillChanged =
		valueChanged(configs.defaultOpacity, theme.defaultOpacity) ||
		(!!encodings.opacity?.field && scaleChanged)

	return (
		<div className="vc-option-panel">
			{sections.map((section) =>
				section.kind === "fill" ? (
					<CollapsibleSubsection
						key="fill"
						title={section.title}
						defaultOpen
						changed={fillChanged}
					>
						<div className="flex flex-col gap-2">
							<FillOpacityControls hideVaryBy={section.hideVaryBy} />
							{/* Opacity can drive bar layout (group/stack/overlay) when 2+ stack
							    channels are mapped to different vars. StackModeRow self-gates. */}
							<StackModeRow channel="opacity" />
						</div>
					</CollapsibleSubsection>
				) : (
					<OpacitySlotSubsection
						key={section.def.key}
						def={section.def}
						hideVaryBy={section.hideVaryBy}
					/>
				)
			)}
		</div>
	)
}

/** Overall (fill) opacity — the existing opacity encoding. Leads with a "Vary
 * by" selector two-way bound to the TOP-LEVEL opacity encoding (the same field
 * the shelf shows), mirroring Color's Fill. "— none —" shows a static
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
	const theme = useCurrentTheme()
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
	const canVary = useVaryByFieldFilter()
	const eligible = (dataset?.fields ?? []).filter(
		(f) =>
			channelAccepts("opacity", overrides[f.name] ?? f.inferredType) &&
			canVary(f.name, encodings.opacity?.field ?? null)
	)
	const varyByOptions = [
		{ value: "", label: "— none —" },
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
				<div className="text-sm vc-muted">
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
	const uniqueValues = uniqueFieldValues(dataset.rows, fieldName, { type })
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

	const canVary = useVaryByFieldFilter()
	const fieldOptions = [
		{ value: "", label: "— none —" },
		...(dataset?.fields ?? [])
			.filter((f) => canVary(f.name, slotCfg?.field ?? null))
			.map((f) => ({ value: f.name, label: f.name })),
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
	// part's default — shared with the top-level Opacity dot so they can't drift.
	const slotChanged = opacitySlotEdited(def.key, slotCfg)

	return (
		<CollapsibleSubsection
			title={def.label}
			changed={slotChanged}
			jumpId={`opacity:${def.key}`}
		>
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
		? uniqueFieldValues(dataset.rows, fieldName, { type: fieldType as FieldType })
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
		<Slider
			label="Min"
			value={cfg.min}
			min={0}
			max={1}
			step={0.05}
			changed={cfg.min !== DEFAULT_OPACITY_QUANTITATIVE.min}
			onChange={(min) => onChange({ ...cfg, min })}
			onReset={() => onChange({ ...cfg, min: DEFAULT_OPACITY_QUANTITATIVE.min })}
			resetLabel="Reset min opacity"
		/>
		<Slider
			label="Max"
			value={cfg.max}
			min={0}
			max={1}
			step={0.05}
			changed={cfg.max !== DEFAULT_OPACITY_QUANTITATIVE.max}
			onChange={(max) => onChange({ ...cfg, max })}
			onReset={() => onChange({ ...cfg, max: DEFAULT_OPACITY_QUANTITATIVE.max })}
			resetLabel="Reset max opacity"
		/>
	</div>
)

/** A single opacity-level slider with a `reset` link that appears once
 * the value differs from its default (the theme's `defaultOpacity` for Fill, or
 * the slot's `defaultLevel`). Used by every "— none —" opacity control —
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
	<Slider
		label="Opacity"
		value={value}
		min={0}
		max={1}
		step={0.05}
		changed={value !== defaultLevel}
		onChange={onChange}
		onReset={() => onChange(defaultLevel)}
		resetLabel="Reset opacity"
	/>
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
					<Slider
						label={labels?.[i] ?? v}
						labelTitle={labels?.[i] ?? v}
						labelClassName="w-24 truncate vc-text"
						className="min-w-0 flex-1"
						value={current}
						min={0}
						max={1}
						step={0.05}
						changed={isOverridden}
						onChange={(next) => onSet(v, next)}
					/>
					{isOverridden && (
						<ResetLink
							ariaLabel={`Reset opacity for ${v}`}
							onClick={() => onReset(v)}
						/>
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
