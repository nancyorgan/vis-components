import { useMemo, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	DEFAULT_GRIDLINE_CONFIG,
	DEFAULT_HISTOGRAM_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	DEFAULT_SPINE_CONFIG,
	DEFAULT_TICKMARK_CONFIG,
	type AxisConfig,
	type DistributionOverlayConfig,
	type GridlineConfig,
	type HistogramConfig,
	type MirrorAxisConfig,
	type RegressionConfig,
	type SpineConfig,
	type TickmarkConfig,
	axisFlipped,
	type AxisSide,
} from "../../../lib/channelConfig"
import { distributionTypeOf, distributionTypePatch, type DistributionType } from "../../../lib/distributionType"
import { naturalWrapAlignFor } from "../../../lib/tickLabelWrap"
import {
	angleConfigFromTheme,
	axisConfigFromTheme,
	spineThemeFor,
	valueChanged,
} from "../../../lib/themeConfig"
import type { FontConfig, LabelAlignment } from "../../../lib/labelsConfig"
import { maxMeaningfulTicks } from "../../../lib/scales"
import { effectiveType as fieldTypeOf } from "../../../lib/fieldType"
import { twoLevelFieldNames, twoLevelsOf } from "../../../lib/mirrorAxis"
import type { FieldType, Theme } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentResolvedXTickLabelAngleAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import {
	formatPresetSelection,
	formatPresetValueFor,
} from "../../../lib/formatPresets"
import { FormatPresetOptions } from "../FormatPresetOptions"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { Select } from "../../../../../components/ui/Select"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { Segmented } from "../../../../../components/ui/Segmented"
import { AlignmentControl, FontEditor } from "../LabelsPanel"
import { Input } from "../../../../../components/ui/Input"
import { DateInput } from "../../../../../components/ui/DateInput"
import { SidebarJumpText, channelJump } from "../../../../../components/ui/SidebarJumpLink"
import { BreaksField } from "./BreaksField"
import { ColorRulesEditor } from "../ColorRulesEditor"

type Props = {
	channel: "x" | "y" | "r"
}

/** Small helper for the categorical-tick-stride hint text: "1st", "2nd",
 * "3rd", "4th", etc. Only the integers we'd actually see — no need for
 * a full Intl.PluralRules implementation. Shared with the chord ring
 * axis's "Label every" hint. */
export const ordinalSuffix = (n: number): string => {
	const lastTwo = n % 100
	if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`
	switch (n % 10) {
		case 1: {
			return `${n}st`
		}
		case 2: {
			return `${n}nd`
		}
		case 3: {
			return `${n}rd`
		}
		default: {
			return `${n}th`
		}
	}
}

export const AxisOptionsPanel = ({ channel }: Props) => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const labels = useAtomValue(currentLabelsAtom)
	const config: AxisConfig = configs[channel] ?? axisConfigFromTheme(theme, channel)
	// What the renderer resolved for a blank (auto) Angle: the x-axis
	// publishes -45 when its categorical labels auto-rotated, else 0. Only
	// x auto-rotates, so y / r read 0 outright.
	const publishedXAngle = useAtomValue(currentResolvedXTickLabelAngleAtom)
	const resolvedAutoAngle = channel === "x" ? publishedXAngle ?? 0 : 0
	// The theme's axis defaults — the reference for the subsection / per-line
	// "changed" dots, compared with `valueChanged` exactly as the top-level dot
	// does (so the dots down the tree always agree).
	const themeAxis = axisConfigFromTheme(theme, channel)
	const ch = {
		tickCount: valueChanged(configs[channel]?.tickCount, themeAxis.tickCount),
		format: valueChanged(configs[channel]?.customFormat, themeAxis.customFormat),
		stride: valueChanged(
			configs[channel]?.categoricalTickStride,
			themeAxis.categoricalTickStride
		),
		min: valueChanged(configs[channel]?.min, undefined),
		max: valueChanged(configs[channel]?.max, undefined),
		breaks: valueChanged(configs[channel]?.breaks, undefined),
		mirror: valueChanged(configs[channel]?.mirror, undefined),
		tickmarks: valueChanged(configs[channel]?.tickmarks, themeAxis.tickmarks),
		tickLabelAngle: valueChanged(
			configs[channel]?.tickLabelAngle,
			themeAxis.tickLabelAngle
		),
		tickLabelFont: valueChanged(configs[channel]?.tickLabelFont, undefined),
		tickLabelColor: valueChanged(configs[channel]?.tickLabelColor, undefined),
		tickLabelColorRules:
			(configs[channel]?.tickLabelColorRules?.length ?? 0) > 0,
		wrapTickLabels: valueChanged(configs[channel]?.wrapTickLabels, undefined),
		wrapTickLabelAlign: valueChanged(
			configs[channel]?.wrapTickLabelAlign,
			undefined
		),
		wrapTickLabelChars: valueChanged(
			configs[channel]?.wrapTickLabelChars ?? undefined,
			undefined
		),
		spine: valueChanged(configs[channel]?.spine, themeAxis.spine),
		spineAtZero: valueChanged(configs[channel]?.spineAtZero, undefined),
		side: valueChanged(configs[channel]?.side, undefined),
		gridlines: valueChanged(configs[channel]?.gridlines, themeAxis.gridlines),
		histogram: valueChanged(configs[channel]?.histogram, undefined),
		distributionOverlay: valueChanged(
			configs[channel]?.distributionOverlay,
			themeAxis.distributionOverlay
		),
		regression: valueChanged(configs[channel]?.regression, themeAxis.regression),
		jitter: valueChanged(configs[channel]?.jitterAmount, themeAxis.jitterAmount),
		jitterOverlappingOnly: valueChanged(
			configs[channel]?.jitterOverlappingOnly,
			undefined
		),
		offset:
			valueChanged(configs[channel]?.offset, undefined) ||
			valueChanged(configs[channel]?.offsetX, undefined) ||
			valueChanged(configs[channel]?.offsetY, undefined),
	}
	const sectionChanged = {
		Distribution:
			ch.histogram ||
			ch.distributionOverlay ||
			ch.jitter ||
			ch.jitterOverlappingOnly,
		Regression: ch.regression,
		// Ticks = tick density + tick marks. The r axis's Ticks section holds
		// the density control only (the radar draws no r tick marks).
		Ticks:
			channel === "r"
				? ch.tickCount || ch.stride
				: ch.tickmarks || ch.tickCount || ch.stride,
		// Scale = the domain controls: Min / Max, Custom breaks and the
		// mirrored-axis group. x / y only (the radar has no r ranges/breaks).
		Scale:
			channel !== "r" && (ch.min || ch.max || ch.breaks || ch.mirror),
		"Tick labels":
			ch.format ||
			ch.tickLabelAngle ||
			ch.tickLabelFont ||
			ch.tickLabelColor ||
			ch.tickLabelColorRules ||
			ch.wrapTickLabels ||
			ch.wrapTickLabelAlign ||
			ch.wrapTickLabelChars ||
			ch.offset,
		Spine: ch.spine || ch.spineAtZero || ch.side,
		Gridlines: ch.gridlines,
	}
	// The theme's tick count for this axis — the "reset" target for the
	// continuous tick-count control.
	const themeTickCount = axisConfigFromTheme(theme, channel).tickCount
	// Default r-tick label color when no per-axis override is set — matches
	// what x/y tick labels use (the "Text encoding" color in theme settings).
	const inheritedTickLabelColor = labels.baseFont.text.color

	// Compute the data-granularity cap so the user can't request more ticks
	// than the data can meaningfully support.
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const dataset = useCurrentDatasetView()
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const modeDef = useChartModeDef()
	const directFieldName = encodings[channel]?.field ?? null
	// Bars/areas don't map a field directly to the measure axis — the
	// `length` channel feeds whichever position axis the orientation puts
	// the measure on. When the user opens that empty axis's panel, we
	// want the controls (tick count, format, range) to reflect the
	// MEASURE field's type instead of the categorical default, so this
	// branch substitutes the length encoding when applicable.
	const lengthFieldName = encodings.length?.field ?? null
	const otherDirectField = encodings[channel === "x" ? "y" : "x"]?.field ?? null
	const isImpliedMeasureAxis =
		!directFieldName && !!lengthFieldName && !!otherDirectField
	// Histogram measure axis: the opposite position axis is an active histogram,
	// so THIS field-less axis is the derived count / density axis — treat it as
	// quantitative so the panel offers the measure-axis controls (tick format
	// for "%", count, scale range) rather than categorical ones.
	const measurePartner = channel === "x" ? "y" : channel === "y" ? "x" : null
	const isHistogramMeasureAxis =
		channel !== "r" &&
		!directFieldName &&
		measurePartner !== null &&
		!!encodings[measurePartner]?.field &&
		configs[measurePartner]?.histogram?.enabled === true
	const fieldName =
		directFieldName ?? (isImpliedMeasureAxis ? lengthFieldName : null)
	const field = fieldName
		? dataset?.fields.find((f) => f.name === fieldName)
		: undefined
	const effectiveType: FieldType = isHistogramMeasureAxis
		? "quantitative"
		: fieldName
			? (overrides[fieldName] ?? field?.inferredType ?? "categorical")
			: "categorical"
	const rawValues =
		dataset && fieldName ? dataset.rows.map((r) => r[fieldName]) : []
	const maxTicks =
		dataset && fieldName ? maxMeaningfulTicks(rawValues, effectiveType) : 12

	// Strip-plot detection: a categorical-vs-quantitative pairing across the two
	// position axes. Drives whether jitter / violin / box-plot controls appear.
	// Skipped on the implied measure axis — bars/areas already have a measure
	// driving the layout; the strip-plot overlays would just clutter the panel.
	// The radial `r` axis has no opposite to pair with, so strip-plot mode
	// stays off for it.
	const otherChannel: "x" | "y" | null =
		channel === "x" ? "y" : channel === "y" ? "x" : null
	const otherFieldName = otherChannel
		? (encodings[otherChannel]?.field ?? null)
		: null
	const otherField = otherFieldName
		? dataset?.fields.find((f) => f.name === otherFieldName)
		: undefined
	const otherEffectiveType: FieldType = otherFieldName
		? (overrides[otherFieldName] ?? otherField?.inferredType ?? "categorical")
		: "categorical"
	const isCategoricalSide =
		!isImpliedMeasureAxis &&
		otherChannel !== null &&
		(effectiveType === "categorical" || effectiveType === "ordinal") &&
		otherEffectiveType === "quantitative"
	// Violin / box plots: offered on a QUANTITATIVE position axis whenever the
	// other position axis is NOT also quantitative — i.e. a single variable
	// (other axis empty) OR a strip plot (other axis categorical). Two
	// quantitative axes = a scatter plot, where neither is offered.
	const otherIsQuantitative =
		!!otherFieldName && otherEffectiveType === "quantitative"

	// "Set spine at 0" gate: this checkbox moves THIS panel's own spine (the
	// same line the Color/Thickness rows above it style) to the PERPENDICULAR
	// scale's zero — so it's offered when the perpendicular position variable
	// is quantitative with data dipping below zero (otherwise 0 sits at or
	// beyond the plot edge and the checkbox would be a no-op). The
	// perpendicular values come from that axis's direct field, or from the
	// length measure when it's the implied measure axis (bars/areas with the
	// value on `length`). Raw cells may be strings; coerce the way the scale
	// will. An already-set flag keeps the checkbox visible even after the
	// data stops qualifying, so it can always be unchecked.
	const perpValueFieldName =
		otherFieldName ??
		(otherChannel !== null && directFieldName && lengthFieldName
			? lengthFieldName
			: null)
	const perpValueType: FieldType | null = perpValueFieldName
		? (overrides[perpValueFieldName] ??
			dataset?.fields.find((f) => f.name === perpValueFieldName)
				?.inferredType ??
			"categorical")
		: null
	const perpHasNegatives =
		perpValueFieldName !== null &&
		perpValueType === "quantitative" &&
		// An ACTIVE histogram renders the perpendicular axis as bins (a band
		// scale) — the value 0 has no pixel there, so the checkbox would be
		// inert on this count axis.
		!isHistogramMeasureAxis &&
		(dataset?.rows ?? []).some((r) => {
			const v = r[perpValueFieldName]
			const n = typeof v === "number" ? v : Number(v)
			return Number.isFinite(n) && n < 0
		})
	// A mirrored measure axis on the perpendicular panel puts bars on both
	// sides of 0 even though the data is all-positive — the category spine
	// then has a zero crossing to sit at.
	const perpMirrored =
		otherChannel !== null &&
		!!directFieldName &&
		!!lengthFieldName &&
		configs[otherChannel]?.mirror?.enabled === true
	const showSpineAtZero =
		perpHasNegatives || perpMirrored || config.spineAtZero === true

	const isViolinCandidate =
		channel !== "r" &&
		!isImpliedMeasureAxis &&
		effectiveType === "quantitative" &&
		!otherIsQuantitative

	// Histogram: a single quantitative position with NO opposite position axis
	// and NO length measure — the opposite axis is then free to carry the
	// count / density. (Bars renderer bins + counts.) Grouped histograms use
	// the Facet encoding instead.
	const isHistogramCandidate =
		channel !== "r" &&
		effectiveType === "quantitative" &&
		!otherFieldName &&
		!lengthFieldName
	const histogram = { ...DEFAULT_HISTOGRAM_CONFIG, ...config.histogram }
	const overlay = {
		...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
		...config.distributionOverlay,
	}

	// Regression line: the mirror of the violin gate — offered on the X axis
	// when BOTH position axes are quantitative (the plain scatter situation).
	// X only because the fit is always y-on-x; a mirrored section under Y
	// would just be a second write path to the same config.
	const isRegressionCandidate =
		channel === "x" &&
		!isImpliedMeasureAxis &&
		effectiveType === "quantitative" &&
		otherIsQuantitative
	const regression: RegressionConfig = {
		...(themeAxis.regression ?? DEFAULT_REGRESSION_CONFIG),
		...config.regression,
	}

	// The Distribution section groups the histogram option (1 position) with
	// the strip-plot options — jitter + violin/box (2 positions).
	const showDistribution =
		isHistogramCandidate || isViolinCandidate || isCategoricalSide

	// When this axis is an ACTIVE histogram, it renders as a band scale of bin
	// labels — so the continuous tick controls (tick count, scale range,
	// breaks) don't apply; the bin count drives the ticks instead. The tick
	// FORMAT still applies (bin-edge labels honor it).
	const isBinnedAxis = isHistogramCandidate && histogram.enabled

	// "Use a mirrored axis": offered on a bar chart's IMPLIED measure axis
	// (this field-less axis carries the `length` measure) — the only place
	// bars can split to either side of zero by a direction variable. Stays
	// visible while checked so it can always be turned off after the chart
	// changes shape. The render path gates on the same mode trait.
	const mirror: MirrorAxisConfig = config.mirror ?? {
		enabled: false,
		directionField: null,
	}
	const mirrorOn = mirror.enabled
	const isMirrorCandidate =
		channel !== "r" &&
		isImpliedMeasureAxis &&
		!isHistogramMeasureAxis &&
		modeDef.canvas.supportsNegativeMeasure === true &&
		modeDef.canvas.measureAxis === channel
	const showMirror = channel !== "r" && (isMirrorCandidate || mirrorOn)
	// The mirror only DRIVES the render on a candidate axis; a stale flag on
	// an axis that stopped qualifying (the chart changed shape) keeps its
	// checkbox visible but hands Scale range / Custom breaks back.
	const mirrorApplies = isMirrorCandidate && mirrorOn
	// Fields with exactly two distinct values — the only valid directions.
	const directionOptions = useMemo<string[]>(() => {
		if (!showMirror || !dataset) return []
		return twoLevelFieldNames(dataset.rows, dataset.fields, (name) =>
			fieldTypeOf(dataset, name, overrides)
		)
	}, [showMirror, dataset, overrides])
	const directionLevels =
		showMirror && dataset && mirror.directionField
			? twoLevelsOf(
					dataset.rows,
					mirror.directionField,
					fieldTypeOf(dataset, mirror.directionField, overrides),
					levelOrders[mirror.directionField]
				)
			: null

	const update = (next: Partial<AxisConfig>) => {
		// Seed untouched fields from the THEME's axis config, not the built-in
		// `DEFAULT_AXIS_CONFIG`. The encoding row's "changed" dot compares this
		// slice against the theme baseline, so seeding from built-in defaults
		// would diverge in every theme-driven field (gridline / tickmark /
		// spine / distribution colors) and light the dot permanently on the
		// first edit — even when the user changed nothing meaningful.
		setConfigs((prev) => ({
			...prev,
			[channel]: {
				...axisConfigFromTheme(theme, channel),
				...prev[channel],
				...next,
			},
		}))
	}

	const isContinuous =
		effectiveType === "quantitative" || effectiveType === "temporal"

	// On a faceted visual this Scale range is the GLOBAL default for every
	// panel; a range set in the Facet panels (overall / per-group /
	// per-panel) overrides it — see panelRenderInputs' precedence chain.
	const isFaceted =
		!!encodings.facet?.field ||
		!!encodings.facetRow?.field ||
		!!encodings.facetCol?.field

	// The Scale section (x / y only): Min / Max + Custom breaks on a
	// continuous, un-mirrored axis; the mirrored-axis group by its own gate.
	// Neither → no Scale section at all.
	const showScaleRange = channel !== "r" && isContinuous && !mirrorApplies
	const showScaleSection = showScaleRange || showMirror

	// Effective "Adjust position" nudge in screen px, applied to the tick
	// labels. The legacy single `offset` was perpendicular-only (x-axis:
	// positive = down/away, y-axis: positive = left/away); it's folded in
	// while the new 2D fields are unset — the control clears it on its first
	// write.
	const effOffsetX =
		config.offsetX ?? (channel === "y" ? -(config.offset ?? 0) : 0)
	const effOffsetY =
		config.offsetY ?? (channel === "x" ? (config.offset ?? 0) : 0)

	// Tick density controls — how many ticks get drawn. On a histogram axis the
	// bins are categorical bands — labeling every bin gets crowded, so expose
	// the same stride control the categorical axis uses (label every Nth bin).
	// Otherwise: categorical → stride; continuous → tick count. Lives in the
	// Ticks section (x, y and r).
	const tickDensityControls = isBinnedAxis ? (
		<div className="flex items-center gap-2 text-sm">
			<NumberInput
				label="Label every"
				labelClassName={LABEL_COL}
				value={config.categoricalTickStride ?? 1}
				min={1}
				max={Math.max(1, histogram.binCount)}
				step={1}
				clamp
				onChange={(categoricalTickStride) =>
					update({ categoricalTickStride })
				}
				inputClassName="w-20"
				changed={ch.stride}
			/>
			<span className="text-sm vc-muted">
				{config.categoricalTickStride && config.categoricalTickStride > 1
					? `${ordinalSuffix(config.categoricalTickStride)} bin`
					: "bin"}
			</span>
			{(config.categoricalTickStride ?? 1) !== 1 && (
				<ResetLink
					onClick={() => update({ categoricalTickStride: 1 })}
					underline
				/>
			)}
		</div>
	) : !isContinuous ? (
		<div className="flex items-center gap-2 text-sm">
			<NumberInput
				label="Tick every"
				labelClassName={LABEL_COL}
				value={config.categoricalTickStride ?? 1}
				min={1}
				max={Math.max(1, maxTicks)}
				step={1}
				clamp
				changed={ch.stride}
				onChange={(categoricalTickStride) =>
					update({ categoricalTickStride })
				}
				inputClassName="w-20"
			/>
			<span className="text-sm vc-muted">
				{config.categoricalTickStride &&
				config.categoricalTickStride > 1
					? `${ordinalSuffix(config.categoricalTickStride)} of ${maxTicks}`
					: `category (${maxTicks} total)`}
			</span>
			{(config.categoricalTickStride ?? 1) !== 1 && (
				<ResetLink
					onClick={() => update({ categoricalTickStride: 1 })}
					underline
				/>
			)}
		</div>
	) : (
		<div className="flex items-center gap-2 text-sm">
			<NumberInput
				label="Count"
				labelClassName={LABEL_COL}
				value={Math.min(config.tickCount, maxTicks)}
				min={0}
				max={maxTicks}
				step={1}
				clamp
				onChange={(tickCount) => update({ tickCount })}
				inputClassName="w-20"
				changed={ch.tickCount}
			/>
			<span className="text-sm vc-muted">max {maxTicks}</span>
			{config.tickCount !== themeTickCount && (
				<ResetLink
					onClick={() => update({ tickCount: themeTickCount })}
					underline
				/>
			)}
		</div>
	)

	return (
		<div className="vc-option-panel">
			{showDistribution && (
				<Section title="Distribution" changed={sectionChanged.Distribution}>
					<div className="flex flex-col gap-2">
						{(isHistogramCandidate || isViolinCandidate) && (
							<DistributionTypeControls
								histogramAvailable={isHistogramCandidate}
								violinBoxAvailable={isViolinCandidate}
									histogram={histogram}
								overlay={overlay}
								// The box's fat dimension is perpendicular to the value axis:
								// a value-on-y (vertical) box grows WIDER; a value-on-x
								// (horizontal) box grows TALLER. This panel lives on the value
								// axis, so the channel tells us which way it fattens.
								boxSizeLabel={channel === "x" ? "Box height" : "Box width"}
								onChange={update}
							/>
						)}
						{isCategoricalSide && (
							<JitterControl
								jitterAmount={config.jitterAmount ?? 0}
								overlappingOnly={config.jitterOverlappingOnly === true}
								overlappingOnlyChanged={ch.jitterOverlappingOnly}
								onChange={(next) => update(next)}
							/>
						)}
					</div>
				</Section>
			)}

			{isRegressionCandidate && (
				<Section title="Regression" changed={sectionChanged.Regression}>
					<RegressionControls
						regression={regression}
						hueField={encodings.hue?.field ?? null}
						fieldNames={(dataset?.fields ?? []).map((f) => f.name)}
						onChange={(next) => update({ regression: { ...regression, ...next } })}
					/>
				</Section>
			)}

			{/* The radar draws no r tick marks, so r's Ticks section is just
			 *  the density control (Count / Tick every / Label every). */}
			{channel === "r" && (
				<Section title="Ticks" changed={sectionChanged.Ticks}>
					{tickDensityControls}
				</Section>
			)}

			{channel !== "r" && (
				<Section title="Ticks" changed={sectionChanged.Ticks}>
					{tickDensityControls}
					<TickmarkControls
						tick={config.tickmarks ?? DEFAULT_TICKMARK_CONFIG}
						onChange={(t) => update({ tickmarks: t })}
						theme={theme}
					/>
				</Section>
			)}

			{showScaleSection && (
				<Section
					title="Scale"
					changed={sectionChanged.Scale}
					tipAnchor="axis-scale"
				>
					{/* Min / Max + plain custom breaks step aside while the axis
					 *  is mirrored — the mirror's side maxes and mirrored breaks
					 *  replace them. */}
					{showScaleRange && (
						<ScaleRangeControls
							isTemporal={effectiveType === "temporal"}
							min={config.min ?? null}
							max={config.max ?? null}
							onChange={(next) => update(next)}
							// On a histogram axis min/max limit the binned RANGE.
							rangeHint={
								isBinnedAxis
									? "Limits the value range that gets binned (rows outside are dropped)."
									: isFaceted
										? "Blank = auto-fit. Applies to every panel; a range set in the Facet panel below overrides it."
										: undefined
							}
							changed={{ min: ch.min, max: ch.max }}
						/>
					)}
					{/* Extra pinned tick positions, ADDED to the auto layout above
					 *  (Count 0 + breaks = fully custom ticks). Tick labels simply
					 *  follow the ticks. Continuous axes only — a binned histogram
					 *  axis is categorical bands. */}
					{isContinuous && !isBinnedAxis && !mirrorApplies && (
						<BreaksField
							isTemporal={effectiveType === "temporal"}
							breaks={config.breaks ?? []}
							onCommit={(breaks) =>
								update({ breaks: breaks.length > 0 ? breaks : undefined })
							}
							changed={ch.breaks}
							hint="Extra tick positions in addition to the automatic ones above. Set Count to 0 for fully custom ticks. Breaks outside the axis range aren't shown."
						/>
					)}
					{showMirror && (
						<MirroredAxisControls
							mirror={mirror}
							orientation={channel === "x" ? "x" : "y"}
							directionOptions={directionOptions}
							directionLevels={directionLevels}
							changed={ch.mirror}
							onChange={(next) => update({ mirror: next })}
							divider={showScaleRange}
						/>
					)}
				</Section>
			)}

			<Section title="Tick labels" changed={sectionChanged["Tick labels"]}>
				<TickFormatControl
					value={config.customFormat}
					changed={ch.format}
					onChange={(customFormat) => update({ customFormat })}
				/>
				{/* Blank = auto. A categorical x-axis auto-rotates to -45° when
				 *  neighboring labels would collide; the renderer publishes what it
				 *  resolved and the blank field shows it as the placeholder. Any
				 *  typed number — 0 included — is explicit and wins, so "set to 0"
				 *  (shown while auto rotated the labels) pins them level; "reset"
				 *  on an explicit value returns the field to auto. */}
				<div className="flex items-center gap-2">
					<NumberInput
						label="Angle"
						labelClassName={LABEL_COL}
						value={config.tickLabelAngle ?? null}
						placeholder={String(resolvedAutoAngle)}
						min={-90}
						max={90}
						step={1}
						clamp
						onChange={(tickLabelAngle) => update({ tickLabelAngle })}
						onClear={() => update({ tickLabelAngle: null })}
						inputClassName="w-20"
						suffix="°"
						changed={ch.tickLabelAngle}
					/>
					{config.tickLabelAngle != null ? (
						<ResetLink
							onClick={() => update({ tickLabelAngle: null })}
							underline
						/>
					) : (
						resolvedAutoAngle !== 0 && (
							<ResetLink
								label="set to 0"
								ariaLabel="Set tick label angle to 0"
								onClick={() => update({ tickLabelAngle: 0 })}
								underline
							/>
						)
					)}
				</div>
				{/* Always shown: single-line labels align within the axis's
				 *  shared label column (y / r) or at their tick (x); wrapped
				 *  labels align their lines within the block. */}
				<TickLabelAlignmentControl
					channel={channel}
					tickLabelAngle={config.tickLabelAngle ?? 0}
					flipped={channel !== "r" && axisFlipped(channel, config.side)}
					value={config.wrapTickLabelAlign}
					changed={ch.wrapTickLabelAlign}
					onChange={(wrapTickLabelAlign) => update({ wrapTickLabelAlign })}
				/>
				<div className="flex flex-col gap-1">
					<Checkbox
						label="Wrap text"
						checked={config.wrapTickLabels === true}
						onChange={(wrapTickLabels) => update({ wrapTickLabels })}
						changed={ch.wrapTickLabels}
					/>
					{config.wrapTickLabels === true && (
						<div className="flex items-center gap-2 text-sm">
							<NumberInput
								label="Characters"
								labelClassName={LABEL_COL}
								value={config.wrapTickLabelChars ?? null}
								placeholder="Auto"
								stepBase={14}
								min={1}
								step={1}
								clamp
								onChange={(wrapTickLabelChars) =>
									update({ wrapTickLabelChars })
								}
								onClear={() => update({ wrapTickLabelChars: null })}
								inputClassName="w-20"
								changed={ch.wrapTickLabelChars}
							/>
							{config.wrapTickLabelChars != null && (
								<ResetLink
									onClick={() => update({ wrapTickLabelChars: null })}
									underline
								/>
							)}
						</div>
					)}
				</div>
				<TickLabelFontControl
					value={config.tickLabelFont}
					legacyColor={config.tickLabelColor}
					inheritedColor={inheritedTickLabelColor}
					inheritedSize={labels.baseFont.text.size}
					inheritedFamily={labels.baseFont.text.family}
					inheritedWeight={labels.baseFont.text.weight ?? 400}
					onChange={(tickLabelFont) =>
						// Writing the fuller font override supersedes the legacy
						// `tickLabelColor`; clear it so the two color sources can't
						// drift out of sync.
						update({ tickLabelFont, tickLabelColor: undefined })
					}
					// Tick-label color rules sit right under the Color row: the
					// swatch is the primary control, the rules the exception
					// path for "this one label in red". x / y only — the radar
					// r ticks carry no value for a rule to test.
					afterColor={
						channel !== "r" ? (
							<ColorRulesEditor
								rules={config.tickLabelColorRules ?? []}
								onChange={(rules) =>
									update({
										tickLabelColorRules:
											rules.length > 0 ? rules : undefined,
									})
								}
								defaultColor={
									config.tickLabelFont?.color ??
									config.tickLabelColor ??
									inheritedTickLabelColor
								}
								paletteKind="text"
								ruleLabel="tick label"
								divider={false}
								variableRules={false}
								help={
									<>
										Compared against each tick label&apos;s own value — the
										category name or the number; the Color above applies
										when no rule matches. In a faceted chart a rule can
										also test the facet variable, to color a label in one
										panel only: <code>== Cardiology AND {"{Company}"} == Merck</code>.
									</>
								}
							/>
						) : undefined
					}
				/>
				<AxisAdjustPositionControl
					offsetX={effOffsetX}
					offsetY={effOffsetY}
					changed={ch.offset}
					onChange={(next) =>
						// Writing the new 2D fields supersedes the legacy
						// perpendicular `offset`; clear it so the two sources
						// can't drift out of sync.
						update({
							offsetX: next.offsetX ?? effOffsetX,
							offsetY: next.offsetY ?? effOffsetY,
							offset: undefined,
						})
					}
					// Each reset zeroes its own axis and keeps the other's effective
					// value; the legacy `offset` is folded out like any other write.
					onResetX={() =>
						update({
							offset: undefined,
							offsetX: undefined,
							offsetY: effOffsetY === 0 ? undefined : effOffsetY,
						})
					}
					onResetY={() =>
						update({
							offset: undefined,
							offsetX: effOffsetX === 0 ? undefined : effOffsetX,
							offsetY: undefined,
						})
					}
				/>
			</Section>

			{/* Radar: the spine is the spokes, one along each angle category —
			 *  each spoke is an R axis line, so they're styled here. Stored on
			 *  the ANGLE config's spine (the renderer's source). */}
			{channel === "r" && modeDef.canvas.polarAxes?.angle === true && (
				<RadarSpineSection />
			)}

			{channel !== "r" && (
				<Section title="Spine" changed={sectionChanged.Spine}>
					{/* Which plot edge the WHOLE axis sits on — spine, tick marks,
					 *  tick labels and title together (the layout solver moves the
					 *  axis chrome with it). Only offered where the mode draws this
					 *  cartesian axis. */}
					{modeDef.canvas.cartesianAxes[channel] && (
						<AxisSideControl
							channel={channel}
							value={config.side}
							changed={ch.side}
							onChange={(side) => update({ side })}
						/>
					)}
					<SpineControls
						spine={config.spine ?? DEFAULT_SPINE_CONFIG}
						onChange={(s) => update({ spine: s })}
						theme={theme}
						axis={channel}
					/>
					{showSpineAtZero && (
						<Checkbox
							label="Set spine at 0"
							checked={config.spineAtZero === true}
							onChange={(on) =>
								update({ spineAtZero: on ? true : undefined })
							}
							changed={ch.spineAtZero}
						/>
					)}
				</Section>
			)}

			<Section title="Gridlines" changed={sectionChanged.Gridlines}>
				<GridlineControls
					grid={config.gridlines ?? DEFAULT_GRIDLINE_CONFIG}
					onChange={(g) => update({ gridlines: g })}
					theme={theme}
					axis={channel}
					isTemporal={effectiveType === "temporal"}
					// Same gating as the tick "Custom breaks" box: continuous x/y
					// axes only (a binned histogram axis is categorical bands).
					showBreaks={channel !== "r" && isContinuous && !isBinnedAxis}
				/>
			</Section>

		</div>
	)
}

/** Hover help for the custom format box — the one place the "text around
 *  the value" grammar (`parseFormatSpec`) is spelled out to the user. */
export const FORMAT_BOX_HELP =
	"A format code such as ,.0f, or text to show around each value. Write literal where the value goes: literal% shows 3 as 3%, €literal shows 3 as €3, literal units shows 3 as 3 units. Text after a code works too: ,.0f kg shows 1234 as 1,234 kg."

/** The tick "Label format" control: the shared preset dropdown
 *  (`FormatPresetOptions`) over a free-typed custom format box. Shared with
 *  the chord ring axis's Tick Labels section, the radar Spoke Labels AND
 *  the per-field data-label formatting, so the format mental model matches
 *  x / y exactly. The box takes a spec OR a spec with text around it
 *  (`literal%`, `,.0f kg` — see `parseFormatSpec`), and the dropdown keeps
 *  showing the preset that spec came from (`formatPresetValueFor`), so the
 *  pair reads as "the preset I picked" over "my edit of it". `label` overrides the
 *  row label (defaults to "Label format") — data labels pass the field name.
 *  `countryNames` adds the Geography preset group; the data-label panels
 *  pass it on countries-level geo charts only, so the option never pollutes
 *  other chart types or the axis tick dropdowns. */
export const TickFormatControl = ({
	value,
	changed,
	onChange,
	label = "Label format",
	countryNames = false,
}: {
	value: string
	changed: boolean
	onChange: (customFormat: string) => void
	label?: string
	countryNames?: boolean
}) => (
	<div className="flex flex-col gap-1">
		<label className="flex items-center gap-2 text-sm">
			<span
				className={
					changed
						? "w-24 shrink-0 truncate font-semibold !text-vc-section-header"
						: "w-24 shrink-0 truncate vc-muted"
				}
			>
				{label}
			</span>
			<Select
				data-tip="number-format"
				value={formatPresetValueFor(value, countryNames)}
				onChange={(e) => {
					const spec = formatPresetSelection(e.target.value)
					if (spec !== null) onChange(spec)
				}}
				className="flex-1"
			>
				<FormatPresetOptions
					countryNames={countryNames}
					selected={formatPresetValueFor(value, countryNames)}
				/>
			</Select>
		</label>
		<div className="flex items-center gap-2">
			<LabelSpacer />
			<Input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Auto"
				aria-label="Custom text format"
				title={FORMAT_BOX_HELP}
				className="flex-1 font-mono"
			/>
		</div>
	</div>
)

/** A titled, collapsible panel section. (Formerly drew a separating rule above
 *  every section after the first visible one). */
const Section = ({
	title,
	children,
	changed,
	jumpId,
	tipAnchor,
}: {
	title: string
	children: React.ReactNode
	changed?: boolean
	/** Target for sidebar jump links (`channelJump(channel, jumpId)`). */
	jumpId?: string
	tipAnchor?: string
}) => (
	<CollapsibleSubsection
		title={title}
		changed={changed}
		jumpId={jumpId}
		tipAnchor={tipAnchor}
	>
		{children}
	</CollapsibleSubsection>
)

/** R position → Spine on a radar: the spokes' color, thickness and opacity.
 *  Writes `configs.angle.spine`, seeding untouched angle fields from the
 *  theme exactly as the Angle panel does, so the stored slice keeps matching
 *  the changed-dot baseline. Opacity is sparse — 1 strips the key. */
const RadarSpineSection = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
	const themeSpine = angleConfigFromTheme(theme).spine ?? DEFAULT_SPINE_CONFIG
	const spine: SpineConfig = { ...themeSpine, ...configs.angle?.spine }
	const setSpine = (next: SpineConfig) =>
		setConfigs((prev) => {
			const { opacity, ...rest } = next
			return {
				...prev,
				angle: {
					...angleConfigFromTheme(theme),
					...prev.angle,
					spine: opacity == null || opacity === 1 ? rest : { ...rest, opacity },
				},
			}
		})
	return (
		<Section
			title="Spine"
			changed={valueChanged(configs.angle?.spine, themeSpine)}
			jumpId="r:spine"
		>
			<SpineControls
				spine={spine}
				onChange={setSpine}
				theme={theme}
				axis="polar"
				showOpacity
			/>
		</Section>
	)
}

/** "Adjust position" X/Y nudge (data-labels style) that moves the TICK LABELS
 *  only — the spine, tick marks, title, and gridlines all stay where they
 *  were. On the radar `r` axis the same nudge moves the ring labels along
 *  the 12 o'clock spoke; the rings and spokes stay put. Values arrive/leave
 *  in screen coords; the Y input shows math convention (positive = up), so
 *  the sign flips at this boundary in both directions. Renders at the end
 *  of the Tick Labels section behind a divider. */
const AxisAdjustPositionControl = ({
	offsetX,
	offsetY,
	changed,
	onChange,
	onResetX,
	onResetY,
}: {
	/** Effective nudge in screen px (legacy `offset` already folded in). */
	offsetX: number
	offsetY: number
	changed: boolean
	onChange: (next: { offsetX?: number; offsetY?: number }) => void
	/** Per-input resets: each axis returns to 0 on its own. */
	onResetX: () => void
	onResetY: () => void
}) => (
	<div className="vc-divider-group">
		<span className="vc-group-header">Adjust position</span>
		<div className="flex items-center gap-2">
			<NumberInput
				label="X"
				labelClassName={LABEL_COL}
				value={offsetX}
				step={1}
				onChange={(n) => onChange({ offsetX: n })}
				inputClassName="w-20"
				suffix="px"
				changed={changed}
			/>
			{offsetX !== 0 && (
				<ResetLink onClick={onResetX} ariaLabel="Reset X position" underline />
			)}
		</div>
		<div className="flex items-center gap-2">
			<NumberInput
				label="Y"
				labelClassName={LABEL_COL}
				value={-offsetY}
				step={1}
				onChange={(n) => onChange({ offsetY: -n })}
				inputClassName="w-20"
				suffix="px"
				changed={changed}
			/>
			{offsetY !== 0 && (
				<ResetLink onClick={onResetY} ariaLabel="Reset Y position" underline />
			)}
		</div>
	</div>
)

/** Histogram sub-options (counts vs density, bin count, bin labels), shown when
 * "Histogram" is the selected distribution type. The on/off decision lives in
 * the parent segmented toggle, and "Show points (rug)" + its styling are
 * handled there too, so there's no checkbox here. */
const HistogramSubOptions = ({
	histogram,
	onChange,
}: {
	histogram: HistogramConfig
	onChange: (h: HistogramConfig) => void
}) => (
	<div className="flex flex-col gap-2">
		<label className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Show</span>
			<Select
				value={histogram.mode}
				onChange={(e) =>
					onChange({
						...histogram,
						mode: e.target.value as "count" | "density",
					})
				}
				className="flex-1"
			>
				<option value="count">Counts</option>
				<option value="density">Density (0–1)</option>
			</Select>
		</label>
		<NumberInput
			label="Bins"
			labelClassName={LABEL_COL}
			value={histogram.binCount}
			min={1}
			max={100}
			step={1}
			clamp
			onChange={(binCount) => onChange({ ...histogram, binCount })}
			inputClassName="w-20"
		/>
		<label className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Bin labels</span>
			<Select
				value={histogram.labelMode}
				onChange={(e) =>
					onChange({
						...histogram,
						labelMode: e.target.value as "range" | "low" | "high",
					})
				}
				className="flex-1"
			>
				<option value="range">Full range (10 – 20)</option>
				<option value="low">Lowest value (10)</option>
				<option value="high">Highest value (20)</option>
			</Select>
		</label>
	</div>
)

/** A nullable numeric field where blank = "clear the bound" (auto-fit). Uses a
 * text input with a local draft so the user can type a leading "-" or a
 * trailing "." mid-edit — a controlled `type="number"` snaps those back to the
 * committed value and makes negatives impossible to type. Commits on every
 * keystroke that parses to a finite number; blank commits `null`; partial
 * states ("-", ".") are held in the draft and not committed until resolved. */
const NumericBoundField = ({
	value,
	onCommit,
	className,
}: {
	value: number | null
	onCommit: (next: number | null) => void
	className: string
}) => {
	const [draft, setDraft] = useState<string | null>(null)
	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const text = e.target.value
		setDraft(text)
		const trimmed = text.trim()
		if (trimmed === "") {
			onCommit(null)
			return
		}
		if (trimmed === "-" || trimmed === "." || trimmed === "-.") return
		const n = Number(trimmed)
		if (Number.isFinite(n)) onCommit(n)
	}
	return (
		<Input
			type="text"
			inputMode="decimal"
			value={draft ?? (value ?? "")}
			onChange={handleChange}
			onBlur={() => setDraft(null)}
			className={className}
		/>
	)
}

/** Bound / max text inputs shared by Scale range and the mirror's side maxes. */
const BOUND_INPUT_CLASS =
	"w-24"
/** Native date pickers draw "mm/dd/yyyy" plus a calendar button, which
 *  clips the year at the numeric fields' width. */
const DATE_BOUND_INPUT_CLASS = "w-40"
/** Field label: bold purple when the value differs from the theme default. */
const boundLabelClass = (on: boolean | undefined) =>
	on
		? "font-semibold !text-vc-section-header"
		: "vc-muted"

/** Custom domain bounds for a continuous (quantitative or temporal) axis.
 * The min/max here pin the scale's domain (the base default applied to every
 * panel — facet-level range overrides still win where set). Bounds are stored
 * as plain numbers on the config; temporal values are epoch milliseconds,
 * surfaced/parsed as ISO dates in the inputs. Opens the Scale section, above
 * the custom-breaks box (the section title names it, so no heading here). */
const ScaleRangeControls = ({
	isTemporal,
	min,
	max,
	onChange,
	rangeHint,
	changed,
}: {
	isTemporal: boolean
	min: number | null
	max: number | null
	onChange: (next: { min?: number | null; max?: number | null }) => void
	/** Optional override for the helper text under the min/max fields. */
	rangeHint?: string
	/** Per-field "changed vs default" → bold-purple that field's label. */
	changed?: { min?: boolean; max?: boolean }
}) => {
	const lbl = boundLabelClass

	const inputClass = BOUND_INPUT_CLASS

	return (
		<div className="flex flex-col gap-2">
			<div className="vc-help">
				{rangeHint ??
					"Blank = auto-fit from the data. Set a bound to pin the axis (e.g. min = 0)."}
			</div>
			<div className="flex flex-col gap-1.5 text-sm">
				<label className="flex items-center gap-2">
					<span className={`w-24 ${lbl(changed?.min)}`}>Min</span>
					{isTemporal ? (
						<DateInput
							value={min}
							onChange={(ms) => onChange({ min: ms })}
							aria-label="Scale range min"
							className={DATE_BOUND_INPUT_CLASS}
						/>
					) : (
						<NumericBoundField
							value={min}
							onCommit={(v) => onChange({ min: v })}
							className={inputClass}
						/>
					)}
				</label>
				<label className="flex items-center gap-2">
					<span className={`w-24 ${lbl(changed?.max)}`}>Max</span>
					{isTemporal ? (
						<DateInput
							value={max}
							onChange={(ms) => onChange({ max: ms })}
							aria-label="Scale range max"
							className={DATE_BOUND_INPUT_CLASS}
						/>
					) : (
						<NumericBoundField
							value={max}
							onCommit={(v) => onChange({ max: v })}
							className={inputClass}
						/>
					)}
				</label>
			</div>
		</div>
	)
}

/** "Use a mirrored axis" mini-section at the bottom of the Scale section
 * (its own rule above when Min / Max sit over it). Bar measure
 * axis only: a two-level Direction variable sends each row's bar to one
 * side of zero while the values stay positive — expenses left / profit
 * right, males left / females right. While on, the side maxes and the
 * mirrored custom breaks here replace the Min / Max and plain Custom
 * breaks controls above. Unchecking clears the whole config (sparse). */
const MirroredAxisControls = ({
	mirror,
	orientation,
	directionOptions,
	directionLevels,
	changed,
	onChange,
	divider,
}: {
	mirror: MirrorAxisConfig
	/** The measure axis's screen axis: "x" → sides are Left / Right;
	 *  "y" → Lower / Upper. */
	orientation: "x" | "y"
	/** Fields with exactly two distinct values (the only valid directions). */
	directionOptions: string[]
	/** The chosen direction's two levels in display order (first = negative
	 *  side), or null when none is chosen / it no longer has two levels. */
	directionLevels: [string, string] | null
	changed: boolean
	onChange: (next: MirrorAxisConfig | undefined) => void
	/** Hairline above the group — only when Min / Max render above it; as the
	 *  Scale section's first block it needs none. */
	divider: boolean
}) => {
	const set = (next: Partial<MirrorAxisConfig>) =>
		onChange({ ...mirror, ...next })
	const negLabel = orientation === "x" ? "Left max" : "Lower max"
	const posLabel = orientation === "x" ? "Right max" : "Upper max"
	const inputClass = BOUND_INPUT_CLASS
	const lbl = boundLabelClass
	const chosen = mirror.directionField ?? ""
	// Keep a stale choice visible (disabled) so the select never shows a
	// blank while the stored field no longer qualifies.
	const staleChoice = chosen !== "" && !directionOptions.includes(chosen)
	const sidesHint = directionLevels
		? orientation === "x"
			? `“${directionLevels[0]}” draws to the left of 0, “${directionLevels[1]}” to the right. Reorder the variable's levels under Fields to swap them.`
			: `“${directionLevels[0]}” draws below 0, “${directionLevels[1]}” above. Reorder the variable's levels under Fields to swap them.`
		: directionOptions.length === 0
			? "No variable has exactly two options, so nothing can be mirrored."
			: staleChoice
				? "This variable no longer has exactly two options; pick another."
				: "Only variables with exactly two options are listed."
	return (
		<div className={divider ? "vc-divider-group" : "flex flex-col gap-2"}>
			<Checkbox
				label="Use a mirrored axis"
				checked={mirror.enabled}
				onChange={(on) =>
					onChange(on ? { ...mirror, enabled: true } : undefined)
				}
				changed={changed}
			/>
			<span className="vc-help">
				Splits each bar to either side of 0 by a two-option variable (like
				expenses vs. profits) while the values themselves stay positive.
			</span>
			{mirror.enabled && (
				<>
					<label className="flex items-center gap-2 text-sm">
						<span className={`${LABEL_COL} shrink-0 ${lbl(chosen !== "")}`}>
							Direction
						</span>
						<Select
							value={chosen}
							onChange={(e) =>
								set({ directionField: e.target.value || null })
							}
							className="min-w-0 flex-1"
							aria-label="Mirror direction variable"
						>
							<option value="">Choose a variable…</option>
							{staleChoice && (
								<option value={chosen} disabled>
									{chosen}
								</option>
							)}
							{directionOptions.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</Select>
					</label>
					<div className="flex gap-2">
						<LabelSpacer />
						<span className="min-w-0 flex-1 vc-help">{sidesHint}</span>
					</div>
					<label className="flex items-center gap-2 text-sm">
						<span
							className={`${LABEL_COL} shrink-0 ${lbl(mirror.negativeMax != null)}`}
						>
							{negLabel}
						</span>
						<NumericBoundField
							value={mirror.negativeMax ?? null}
							onCommit={(v) =>
								set({ negativeMax: v === null ? null : Math.abs(v) })
							}
							className={inputClass}
						/>
					</label>
					<label className="flex items-center gap-2 text-sm">
						<span
							className={`${LABEL_COL} shrink-0 ${lbl(mirror.positiveMax != null)}`}
						>
							{posLabel}
						</span>
						<NumericBoundField
							value={mirror.positiveMax ?? null}
							onCommit={(v) =>
								set({ positiveMax: v === null ? null : Math.abs(v) })
							}
							className={inputClass}
						/>
					</label>
					<div className="flex gap-2">
						<LabelSpacer />
						<span className="min-w-0 flex-1 vc-help">
							How far each side of 0 extends. Blank = auto-fit from the
							data on that side.
						</span>
					</div>
					<BreaksField
						isTemporal={false}
						breaks={mirror.breaks ?? []}
						onCommit={(breaks) =>
							set({ breaks: breaks.length > 0 ? breaks : undefined })
						}
						changed={(mirror.breaks?.length ?? 0) > 0}
						hint="Mirrored around 0, setting ticks on both sides in addition to the automatic ones above. Set Count to 0 for fully custom ticks."
					/>
				</>
			)}
		</div>
	)
}

/** Spine color + thickness. Shared with the chord ring axis's Spine section
 *  (there the "spine" is the arc along each group's outer edge) and with the
 *  radar Spokes section (there the "spine" is a perimeter spoke). */
export const SpineControls = ({
	spine,
	onChange,
	theme,
	axis,
	hideColorRow = false,
	showChanged = true,
	showOpacity = false,
}: {
	spine: SpineConfig
	onChange: (s: SpineConfig) => void
	theme: Theme
	/** Which theme spine this control resets to / dots against — the x / y
	 *  axis fields, or the polar fields (chord ring, radar spokes). */
	axis: "x" | "y" | "polar"
	/** Drop the Color row. Radar spokes take their color from the Color menu's
	 *  "Radar Spine" slot, so the radar panel points at that instead. */
	hideColorRow?: boolean
	/** Show the per-line "changed" dots (differs-from-theme). */
	showChanged?: boolean
	/** Add an Opacity row (`spine.opacity`, absent = 1). Only the radar
	 *  spokes read it. */
	showOpacity?: boolean
}) => {
	const set = (next: Partial<SpineConfig>) => onChange({ ...spine, ...next })
	const themeSpine = spineThemeFor(theme, axis)
	// `||` (not `??`) so a 0 / undefined theme value falls back to the
	// built-in default. A theme that somehow has `spineThickness: 0` would
	// otherwise have "reset" produce an invisible spine (= no visible change
	// for the user clicking the link).
	const resetColor = themeSpine.color || DEFAULT_SPINE_CONFIG.color
	const resetThickness = themeSpine.thickness || DEFAULT_SPINE_CONFIG.thickness

	return (
		<div className="flex flex-col gap-2">
			{!hideColorRow && (
				<div className="flex flex-wrap items-center gap-2">
					<ColorInput
						label="Color"
						labelClassName={LABEL_COL}
						value={spine.color}
						onChange={(color) => set({ color })}
						changed={showChanged ? valueChanged(spine.color, themeSpine.color) : undefined}
					/>
					{spine.color !== resetColor && (
						<ResetLink onClick={() => set({ color: resetColor })} underline />
					)}
				</div>
			)}
			<div className="flex items-center gap-2">
				<NumberInput
					label="Thickness"
					labelClassName={LABEL_COL}
					value={spine.thickness}
					min={0}
					max={5}
					step={0.5}
					onChange={(thickness) => set({ thickness })}
					inputClassName="w-16"
					suffix="px"
					changed={
						showChanged ? valueChanged(spine.thickness, themeSpine.thickness) : undefined
					}
				/>
				{spine.thickness !== resetThickness && (
					<ResetLink onClick={() => set({ thickness: resetThickness })} underline />
				)}
			</div>
			{showOpacity && (
				<div className="flex items-center gap-2">
					<NumberInput
						label="Opacity"
						labelClassName={LABEL_COL}
						value={spine.opacity ?? 1}
						min={0}
						max={1}
						step={0.05}
						clamp
						onChange={(opacity) => set({ opacity })}
						inputClassName="w-16"
						changed={showChanged ? (spine.opacity ?? 1) !== 1 : undefined}
					/>
					{(spine.opacity ?? 1) !== 1 && (
						<ResetLink onClick={() => set({ opacity: undefined })} underline />
					)}
				</div>
			)}
		</div>
	)
}

const GridlineControls = ({
	grid,
	onChange,
	theme,
	axis,
	isTemporal,
	showBreaks,
}: {
	grid: GridlineConfig
	onChange: (g: GridlineConfig) => void
	theme: Theme
	axis: "x" | "y" | "r"
	isTemporal: boolean
	/** Offer the "Custom breaks" box — continuous x/y axes only (categorical
	 *  bands and radar rings have no meaningful pinned positions). */
	showBreaks: boolean
}) => {
	const set = (next: Partial<GridlineConfig>) => onChange({ ...grid, ...next })
	// Pull per-axis theme defaults, falling back to the legacy shared
	// fields when the user hasn't set axis-specific overrides yet. `r`
	// is radar's radial axis (concentric rings).
	const themeColor =
		(axis === "x"
			? theme.xGridlineColor
			: axis === "y"
				? theme.yGridlineColor
				: theme.rGridlineColor) ?? theme.gridlineColor
	const themeThickness =
		(axis === "x"
			? theme.xGridlineThickness
			: axis === "y"
				? theme.yGridlineThickness
				: theme.rGridlineThickness) ?? theme.gridlineThickness
	// `||` (not `??`): a 0 / undefined theme thickness falls back to the
	// built-in default so "reset" never produces invisible gridlines.
	const resetColor = themeColor || DEFAULT_GRIDLINE_CONFIG.color
	const resetThickness = themeThickness || DEFAULT_GRIDLINE_CONFIG.thickness

	return (
		<div className="flex flex-col gap-2">
			<Checkbox
				label="Show gridlines"
				checked={grid.enabled}
				onChange={(enabled) => set({ enabled })}
				changed={valueChanged(grid.enabled, true)}
			/>
			{grid.enabled && (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label="Color"
							labelClassName={LABEL_COL}
							value={grid.color}
							onChange={(color) => set({ color })}
							changed={valueChanged(grid.color, themeColor)}
						/>
						{grid.color !== resetColor && (
							<ResetLink onClick={() => set({ color: resetColor })} underline />
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Thickness"
							labelClassName={LABEL_COL}
							value={grid.thickness}
							min={0}
							max={5}
							step={0.5}
							onChange={(thickness) => set({ thickness })}
							inputClassName="w-16"
							suffix="px"
							changed={valueChanged(grid.thickness, themeThickness)}
						/>
						{grid.thickness !== resetThickness && (
							<ResetLink
								onClick={() => set({ thickness: resetThickness })}
								underline
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<LabelSpacer />
						<Checkbox
							label="Match tick count"
							checked={grid.count === null}
							onChange={(matchTicks) => set({ count: matchTicks ? null : 5 })}
							changed={valueChanged(grid.count, null)}
						/>
					</div>
					{grid.count !== null && (
						<NumberInput
							label="Count"
							labelClassName={LABEL_COL}
							value={grid.count}
							min={2}
							max={20}
							step={1}
							onChange={(count) => set({ count })}
							inputClassName="w-16"
							changed={valueChanged(grid.count, null)}
						/>
					)}
					{showBreaks && (
						<BreaksField
							isTemporal={isTemporal}
							breaks={grid.breaks ?? []}
							onCommit={(breaks) =>
								set({ breaks: breaks.length > 0 ? breaks : undefined })
							}
							changed={valueChanged(grid.breaks, undefined)}
							hint="Comma-separated extra gridline positions, drawn in addition to the automatic ones above."
						/>
					)}
				</>
			)}
		</div>
	)
}

/** Tick mark color / thickness / length. Shared with the chord ring axis's
 *  Ticks section. */
export const TickmarkControls = ({
	tick,
	onChange,
	theme,
	divider = true,
}: {
	tick: TickmarkConfig
	onChange: (t: TickmarkConfig) => void
	theme: Theme
	/** Top divider + "Tick marks" subheader — for when the controls sit below
	 *  other controls in the same section (the chord ring axis). Off when the
	 *  controls are the whole section. */
	divider?: boolean
}) => {
	const set = (next: Partial<TickmarkConfig>) => onChange({ ...tick, ...next })
	// `||` / `> 0` (not `??`): a 0 / undefined theme value falls back to the
	// built-in default so "reset" never produces invisible tick marks.
	const resetColor = theme.tickmarkColor || DEFAULT_TICKMARK_CONFIG.color
	const resetThickness =
		theme.tickmarkThickness || DEFAULT_TICKMARK_CONFIG.thickness
	const resetLength =
		theme.tickmarkLength > 0
			? theme.tickmarkLength
			: DEFAULT_TICKMARK_CONFIG.length

	return (
		<div className={divider ? "vc-divider-group" : "flex flex-col gap-2"}>
			{divider && <span className="vc-group-header">Tick marks</span>}
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Color"
					labelClassName={LABEL_COL}
					value={tick.color}
					onChange={(color) => set({ color })}
					changed={valueChanged(tick.color, theme.tickmarkColor)}
				/>
				{tick.color !== resetColor && (
					<ResetLink onClick={() => set({ color: resetColor })} underline />
				)}
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Thickness"
					labelClassName={LABEL_COL}
					value={tick.thickness}
					min={0}
					max={5}
					step={0.5}
					onChange={(thickness) => set({ thickness })}
					inputClassName="w-16"
					suffix="px"
					changed={valueChanged(tick.thickness, theme.tickmarkThickness)}
				/>
				{tick.thickness !== resetThickness && (
					<ResetLink
						onClick={() => set({ thickness: resetThickness })}
						underline
					/>
				)}
			</div>
			<div className="flex items-center gap-2">
				<NumberInput
					label="Length"
					labelClassName={LABEL_COL}
					value={tick.length}
					min={0}
					max={20}
					step={1}
					onChange={(length) => set({ length })}
					inputClassName="w-16"
					suffix="px"
					changed={valueChanged(tick.length, theme.tickmarkLength)}
				/>
				{tick.length !== resetLength && (
					<ResetLink onClick={() => set({ length: resetLength })} underline />
				)}
			</div>
		</div>
	)
}

/** Per-axis tick LABEL font override (family / color / size / weight / style).
 *  Reuses the shared `FontEditor` so the controls match the Labels panel's
 *  title/subtitle font editors exactly. Any field left unset inherits the
 *  global Text encoding font (`labels.baseFont.text`); the per-field "reset"
 *  links clear back to that inherited default.
 *  Shown on every axis (x, y, r).
 *
 *  `legacyColor` seeds the editor's color from the older standalone
 *  `tickLabelColor` field so visuals saved before this override still show
 *  their chosen color (and keep it on the next edit). Also shared with the
 *  chord ring axis's Tick Labels section (which has no legacy color). */
export const TickLabelFontControl = ({
	value,
	legacyColor,
	inheritedColor,
	inheritedSize,
	inheritedFamily,
	inheritedWeight,
	onChange,
	afterColor,
}: {
	value: Partial<FontConfig> | undefined
	legacyColor: string | undefined
	inheritedColor: string
	/** Inherited size (pt) shown as the Size box's placeholder. */
	inheritedSize: number
	/** Inherited family named in the Family select's "(inherit)" entry. */
	inheritedFamily: string
	/** Effective inherited weight (base text weight ?? the renderer's normal
	 *  weight) named in the Weight select's "(inherit)" entry. */
	inheritedWeight: number
	onChange: (next: Partial<FontConfig> | undefined) => void
	/** Rendered directly under the editor's Color row (the x / y panels'
	 *  tick-label color rules). */
	afterColor?: React.ReactNode
}) => {
	const current: Partial<FontConfig> =
		value ?? (legacyColor ? { color: legacyColor } : {})
	return (
		<FontEditor
			value={current}
			onChange={(patch) =>
				onChange(Object.keys(patch).length > 0 ? patch : undefined)
			}
			showResetFields
			baseColor={inheritedColor}
			baseSize={inheritedSize}
			baseFamily={inheritedFamily}
			baseWeight={inheritedWeight}
			afterColor={afterColor}
		/>
	)
}

/** "Side" (Spine section): which plot edge the axis sits on. x: Bottom
 *  (default) / Top; y: Left (default) / Right. Writes the non-default side
 *  only (`"top"` / `"right"`) and clears to absent for the default, so the
 *  "changed" dot and saved visuals stay honest (see `AxisConfig.side`). */
const AxisSideControl = ({
	channel,
	value,
	changed,
	onChange,
}: {
	channel: "x" | "y"
	value: AxisSide | undefined
	changed: boolean
	onChange: (next: AxisSide | undefined) => void
}) => {
	const flipped = axisFlipped(channel, value)
	const [defaultLabel, flippedLabel] =
		channel === "x" ? ["Bottom", "Top"] : ["Left", "Right"]
	const flippedSide: AxisSide = channel === "x" ? "top" : "right"
	return (
		<div className="flex flex-col gap-1">
			<label className="flex items-center gap-2 text-sm">
				<span
					className={
						changed
							? "w-24 shrink-0 font-semibold !text-vc-section-header"
							: "w-24 shrink-0 vc-muted"
					}
				>
					Side
				</span>
				<Select
					aria-label="Axis side"
					value={flipped ? "flipped" : "default"}
					onChange={(e) =>
						onChange(e.target.value === "flipped" ? flippedSide : undefined)
					}
					className="flex-1"
				>
					<option value="default">{defaultLabel}</option>
					<option value="flipped">{flippedLabel}</option>
				</Select>
			</label>
			<p className="vc-help">
				Moves the whole axis — spine, tick marks, tick labels and title.
			</p>
		</div>
	)
}

/** Tick-label alignment — always shown (2026-11-09; it was gated on "Wrap
 *  text" before). Single-line labels align within the axis's shared label
 *  column (y / r) or at their tick (x); wrapped labels align their lines
 *  within the block. Reuses the Labels panel's left/center/right glyph
 *  buttons. The DEFAULT alignment is the axis's natural one (per
 *  `naturalWrapAlignFor` — anchor-derived, so a rotated x axis naturally
 *  right- or left-aligns, and a right-side y axis naturally left-aligns),
 *  and picking that natural value stores `undefined`, so the "changed" dot
 *  only lights for a real deviation and older saves stay byte-identical.
 *  The stored field keeps its historical `wrapTickLabelAlign` name. */
const TickLabelAlignmentControl = ({
	channel,
	tickLabelAngle,
	flipped,
	value,
	changed,
	onChange,
}: {
	channel: "x" | "y" | "r"
	/** The axis's explicit label angle — flips the natural alignment on a
	 *  rotated x axis (see `naturalWrapAlignFor`). */
	tickLabelAngle: number
	/** Axis drawn on its non-default side (x top / y right) — flips the
	 *  natural alignment with the label anchors. */
	flipped: boolean
	value: LabelAlignment | undefined
	changed: boolean
	onChange: (next: LabelAlignment | undefined) => void
}) => {
	const naturalAlign = naturalWrapAlignFor(channel, tickLabelAngle, flipped)
	return (
		<div className="flex items-center gap-2 text-sm">
			<span
				className={
					changed
						? "w-24 shrink-0 font-semibold !text-vc-section-header"
						: "w-24 shrink-0 vc-muted"
				}
			>
				Align
			</span>
			<AlignmentControl
				value={value ?? naturalAlign}
				onChange={(a) => onChange(a === naturalAlign ? undefined : a)}
			/>
		</div>
	)
}

/** Jitter slider — shown on the CATEGORICAL side of a strip plot. Spreads
 * points within each category band; 0 keeps them stacked on the band center.
 * "Only jitter overlapping points" (offered once there is any jitter, since
 * it is inert at 0) limits the spread to points that share an exact
 * position with another point. */
const JitterControl = ({
	jitterAmount,
	overlappingOnly,
	overlappingOnlyChanged,
	onChange,
}: {
	jitterAmount: number
	overlappingOnly: boolean
	overlappingOnlyChanged?: boolean
	onChange: (next: {
		jitterAmount?: number
		jitterOverlappingOnly?: boolean
	}) => void
}) => (
	<div className="flex flex-col gap-2">
		<label className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Jitter</span>
			<input
				type="range"
				min={0}
				max={1}
				step={0.05}
				value={jitterAmount}
				onChange={(e) => onChange({ jitterAmount: Number(e.target.value) })}
				className="min-w-0 flex-1"
			/>
			<span className="w-10 text-right text-sm vc-muted">
				{Math.round(jitterAmount * 100)}%
			</span>
		</label>
		{jitterAmount > 0 && (
			<Checkbox
				label="Only jitter overlapping points"
				checked={overlappingOnly}
				onChange={(next) =>
					onChange({ jitterOverlappingOnly: next ? true : undefined })
				}
				changed={overlappingOnlyChanged}
			/>
		)}
	</div>
)

const DEFAULT_RUG_TICK_LENGTH = DEFAULT_HISTOGRAM_CONFIG.rugTickLength ?? 10
const DEFAULT_RUG_TICK_THICKNESS =
	DEFAULT_HISTOGRAM_CONFIG.rugTickThickness ?? 1

/** The rug (points) toggle + tassel length/width, bound to the shared
 * `histogram` config so the same ticks, sizes, color, and opacity carry across
 * the Histogram ⇄ Density switch (both displays read `histogram.showRug` /
 * `rugTick*` and the Rug color / opacity slots). */
const RugControls = ({
	histogram,
	onChange,
}: {
	histogram: HistogramConfig
	onChange: (next: Partial<AxisConfig>) => void
}) => (
	<>
		<Checkbox
			label="Show points (rug)"
			checked={histogram.showRug}
			onChange={(showRug) => onChange({ histogram: { ...histogram, showRug } })}
		/>
		{histogram.showRug && (
			<>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Tassel length"
						labelClassName={LABEL_COL}
						value={histogram.rugTickLength ?? DEFAULT_RUG_TICK_LENGTH}
						min={1}
						max={100}
						step={1}
						clamp
						onChange={(rugTickLength) =>
							onChange({ histogram: { ...histogram, rugTickLength } })
						}
						inputClassName="w-20"
					/>
					{(histogram.rugTickLength ?? DEFAULT_RUG_TICK_LENGTH) !==
						DEFAULT_RUG_TICK_LENGTH && (
						<ResetLink
							ariaLabel="Reset tassel length"
							onClick={() =>
								onChange({
									histogram: {
										...histogram,
										rugTickLength: DEFAULT_RUG_TICK_LENGTH,
									},
								})
							}
							underline
						/>
					)}
				</div>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Tassel width"
						labelClassName={LABEL_COL}
						value={histogram.rugTickThickness ?? DEFAULT_RUG_TICK_THICKNESS}
						min={0}
						max={20}
						step={0.5}
						clamp
						onChange={(rugTickThickness) =>
							onChange({ histogram: { ...histogram, rugTickThickness } })
						}
						inputClassName="w-20"
					/>
					{(histogram.rugTickThickness ?? DEFAULT_RUG_TICK_THICKNESS) !==
						DEFAULT_RUG_TICK_THICKNESS && (
						<ResetLink
							ariaLabel="Reset tassel width"
							onClick={() =>
								onChange({
									histogram: {
										...histogram,
										rugTickThickness: DEFAULT_RUG_TICK_THICKNESS,
									},
								})
							}
							underline
						/>
					)}
				</div>
				<p className="vc-help">
					Set the rug color under{" "}
					<SidebarJumpText target={channelJump("hue", "color:rug")}>Color → Rug</SidebarJumpText> and its opacity under{" "}
					<SidebarJumpText target={channelJump("opacity", "opacity:rug")}>Opacity → Rug</SidebarJumpText>.
				</p>
			</>
		)}
	</>
)

/** Shared styling controls for a density curve (smoothing + optional fill),
 * used both by the standalone "Density" display and the histogram's density
 * overlay. The curve's color lives in the Color menu's Density Curve slot. */
const DensityCurveControls = ({
	bandwidthScale,
	fill,
	onChangeBandwidth,
	onChangeFill,
}: {
	bandwidthScale: number
	fill: boolean
	onChangeBandwidth: (n: number) => void
	onChangeFill: (b: boolean) => void
}) => (
	<>
		<label className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Smoothing</span>
			<input
				type="range"
				min={0.1}
				max={5}
				step={0.1}
				value={bandwidthScale}
				onChange={(e) => onChangeBandwidth(Number(e.target.value))}
				className="min-w-0 flex-1"
			/>
			<span className="w-10 text-right text-sm vc-muted">
				{bandwidthScale.toFixed(1)}×
			</span>
		</label>
		<Checkbox label="Fill under curve" checked={fill} onChange={onChangeFill} />
		<p className="vc-help">
			Smoothing scales the kernel bandwidth; higher is smoother. Set the curve
			color under{" "}
			<SidebarJumpText target={channelJump("hue", "color:densityCurveStroke")}>Color → Density curve outline</SidebarJumpText>.
		</p>
	</>
)


/** Single-select segmented control for the distribution display on a
 * quantitative position axis. Histogram, violin, and box plot are alternative
 * renderings of the same variable, so the choice is mutually exclusive with an
 * explicit "None" (plain points). Which segments appear depends on context:
 * a lone quantitative axis offers all three; a strip plot (quantitative paired
 * with a categorical axis) can't bin, so it offers None / Violin / Box. */
const DistributionTypeControls = ({
	histogramAvailable,
	violinBoxAvailable,
	histogram,
	overlay,
	boxSizeLabel,
	onChange,
}: {
	histogramAvailable: boolean
	violinBoxAvailable: boolean
	histogram: HistogramConfig
	overlay: DistributionOverlayConfig
	/** Orientation-aware label for the box thickness slider — "Box width" for a
	 * vertical box (value on y), "Box height" for a horizontal one (value on x). */
	boxSizeLabel: string
	onChange: (next: Partial<AxisConfig>) => void
}) => {
	const selected = distributionTypeOf(histogram, overlay)

	const segments: { key: DistributionType; label: string }[] = [
		{ key: "none", label: "None" },
		// Density (a standalone KDE curve) applies in the same lone-quantitative
		// situation as the histogram, so it sits beside it.
		...(histogramAvailable
			? ([
					{ key: "histogram", label: "Histogram" },
					{ key: "density", label: "Density" },
				] as const)
			: []),
		...(violinBoxAvailable
			? ([
					{ key: "violin", label: "Violin" },
					{ key: "box", label: "Box" },
				] as const)
			: []),
	]

	// Apply a selection by writing both configs at once so only one display is
	// ever active — histogram, the density curve, and the violin/box overlay are
	// mutually exclusive.
	const select = (type: DistributionType) => onChange(distributionTypePatch(histogram, overlay, type))

	const setOverlay = (next: Partial<DistributionOverlayConfig>) =>
		onChange({ distributionOverlay: { ...overlay, ...next } })

	return (
		<div className="flex flex-col gap-2">
			<Segmented
				ariaLabel="Distribution type"
				value={selected}
				segments={segments}
				onChange={select}
			/>
			{selected === "histogram" && (
				<>
					{/* Histogram shape: counts / density, bins, bin labels. */}
					<HistogramSubOptions
						histogram={histogram}
						onChange={(h) => onChange({ histogram: h })}
					/>
					{/* Rug (points) — grouped below the histogram shape and divided
					    off so the two clusters read as distinct groups. Shares the
					    tassel config with the Density display. */}
					<div className="vc-divider-group">
						<RugControls histogram={histogram} onChange={onChange} />
					</div>
					{/* Density curve — a smooth KDE overlaid on the bars, rescaled to
					    their count / relative-frequency units. Divided off as its own
					    cluster, like the rug above. */}
					<div className="vc-divider-group">
						<Checkbox
							label="Show density curve"
							checked={histogram.showDensity === true}
							onChange={(showDensity) =>
								onChange({ histogram: { ...histogram, showDensity } })
							}
						/>
						{histogram.showDensity && (
							<DensityCurveControls
								bandwidthScale={histogram.densityBandwidthScale ?? 1}
								fill={histogram.densityFill === true}
								onChangeBandwidth={(densityBandwidthScale) =>
									onChange({
										histogram: { ...histogram, densityBandwidthScale },
									})
								}
								onChangeFill={(densityFill) =>
									onChange({ histogram: { ...histogram, densityFill } })
								}
							/>
						)}
					</div>
				</>
			)}
			{selected === "density" && (
				<>
					{/* Same tassel config as the histogram rug, so switching between
					    Histogram and Density keeps the ticks and their sizes. */}
					<RugControls histogram={histogram} onChange={onChange} />
					<div className="vc-divider-group">
						<DensityCurveControls
							bandwidthScale={histogram.densityBandwidthScale ?? 1}
							fill={histogram.densityFill === true}
							onChangeBandwidth={(densityBandwidthScale) =>
								onChange({ histogram: { ...histogram, densityBandwidthScale } })
							}
							onChangeFill={(densityFill) =>
								onChange({ histogram: { ...histogram, densityFill } })
							}
						/>
					</div>
				</>
			)}
			{(selected === "violin" || selected === "box") && (
				<>
					<Checkbox
						label="Show points"
						checked={overlay.showPoints}
						onChange={(showPoints) => setOverlay({ showPoints })}
					/>
					{/* With the points visible the mean would be lost among them, so
					    the option only offers itself while they're hidden. */}
					{selected === "box" && !overlay.showPoints && (
						<Checkbox
							label="Mark mean"
							checked={overlay.markMean === true}
							onChange={(markMean) => setOverlay({ markMean })}
						/>
					)}
					{selected === "box" && (
						<label className="flex items-center gap-2 text-sm">
							<span className={LABEL_COL}>
								{boxSizeLabel}
							</span>
							<input
								type="range"
								min={0.25}
								max={3}
								step={0.25}
								value={overlay.boxWidthScale ?? 1}
								onChange={(e) =>
									setOverlay({ boxWidthScale: Number(e.target.value) })
								}
								className="min-w-0 flex-1"
							/>
							<span className="w-10 text-right text-sm vc-muted">
								{(overlay.boxWidthScale ?? 1).toFixed(2)}×
							</span>
						</label>
					)}
					<p className="vc-help">
						Set violin / box colors under{" "}
						<SidebarJumpText target={channelJump("hue", "color:violinFill")}>Color → Violin / box fill</SidebarJumpText> and{" "}
						<SidebarJumpText target={channelJump("hue", "color:violinStroke")}>Violin / box outline</SidebarJumpText>, and the
						border width under{" "}
						<SidebarJumpText target={channelJump("shape")}>Shape → Violin / box outline</SidebarJumpText>. A fill
						pattern lives under{" "}
						<SidebarJumpText target={channelJump("pattern")}>Pattern → Violin / box fill</SidebarJumpText>.
					</p>
					{selected === "box" && !overlay.showPoints && overlay.markMean === true && (
						<p className="vc-help">
							The mean point is styled like a data point: its shape and
							border width under{" "}
							<SidebarJumpText target={channelJump("shape")}>Shape</SidebarJumpText>, its fill and
							outline colors under{" "}
							<SidebarJumpText target={channelJump("hue")}>Color</SidebarJumpText> and{" "}
							<SidebarJumpText target={channelJump("opacity")}>Opacity</SidebarJumpText>, and its
							size under{" "}
							<SidebarJumpText target={channelJump("area")}>Area</SidebarJumpText>.
						</p>
					)}
				</>
			)}
		</div>
	)
}

/** The Regression section's controls: enable, fit type + degree, draw
 * position, per-group fits, and the confidence band. Styling is
 * intentionally NOT here — colors / width / opacities live under the Color
 * and Opacity menus' "Regression line" / "Confidence interval" subheaders,
 * and the line's dash under the Pattern menu's "Regression line"
 * subheader. */
const RegressionControls = ({
	regression,
	hueField,
	fieldNames,
	onChange,
}: {
	regression: RegressionConfig
	hueField: string | null
	fieldNames: string[]
	onChange: (next: Partial<RegressionConfig>) => void
}) => {
	const groupOptions = [
		{ value: "", label: "Choose a variable…" },
		...fieldNames.map((name) => ({ value: name, label: name })),
	]
	return (
		<div className="flex flex-col gap-2">
			<Checkbox
				label="Add regression line"
				checked={regression.enabled}
				onChange={(enabled) => onChange({ enabled })}
			/>
			{regression.enabled && (
				<>
					<div className="flex items-center gap-2 text-sm">
						<span className={`shrink-0 ${LABEL_COL}`}>
							Type
						</span>
						<Segmented
							ariaLabel="Regression type"
							value={regression.kind}
							segments={[
								{ key: "linear", label: "Linear" },
								{ key: "polynomial", label: "Polynomial" },
							]}
							onChange={(kind) => onChange({ kind })}
						/>
					</div>
					{regression.kind === "polynomial" && (
						<NumberInput
							label="Degree"
							labelClassName={LABEL_COL}
							value={regression.degree}
							min={2}
							max={6}
							step={1}
							clamp
							onChange={(degree) => onChange({ degree })}
						/>
					)}
					<div className="flex items-center gap-2 text-sm">
						<span className={`shrink-0 ${LABEL_COL}`}>
							Layer
						</span>
						<Segmented
							ariaLabel="Regression layer"
							value={regression.drawPosition}
							segments={[
								{ key: "front", label: "In front" },
								{ key: "back", label: "Behind chart" },
							]}
							onChange={(drawPosition) => onChange({ drawPosition })}
						/>
					</div>
					<div className="vc-divider-group">
						<Checkbox
							label="Line per group"
							checked={regression.perGroup}
							onChange={(on) =>
								onChange(
									// Pre-fill the grouping variable from the hue field the
									// moment per-group is switched on (only when nothing is
									// chosen yet); blank otherwise until the user picks one.
									on
										? {
												perGroup: true,
												groupField: regression.groupField ?? hueField,
											}
										: { perGroup: false }
								)
							}
						/>
						{regression.perGroup && (
							<SelectInput
								label="Group by"
								labelClassName={LABEL_COL}
								value={regression.groupField ?? ""}
								options={groupOptions}
								onChange={(groupField) =>
									onChange({ groupField: groupField === "" ? null : groupField })
								}
								selectClassName="flex-1"
							/>
						)}
					</div>
					<div className="vc-divider-group">
						<Checkbox
							label="Confidence interval"
							checked={regression.showCi}
							onChange={(showCi) => onChange({ showCi })}
						/>
						{regression.showCi && (
							<NumberInput
								label="Level %"
								labelClassName={LABEL_COL}
								value={regression.ciLevel}
								min={50}
								max={99.9}
								step={1}
								clamp
								onChange={(ciLevel) => onChange({ ciLevel })}
							/>
						)}
					</div>
					<p className="vc-help">
						Style the line under{" "}
						<SidebarJumpText target={channelJump("hue", "color:regressionStroke")}>Color → Regression line</SidebarJumpText> and{" "}
						<SidebarJumpText target={channelJump("opacity", "opacity:regressionStroke")}>Opacity → Regression line</SidebarJumpText>,
						the band under{" "}
						<SidebarJumpText target={channelJump("hue", "color:regressionCiFill")}>Color → Confidence interval</SidebarJumpText> and{" "}
						<SidebarJumpText target={channelJump("opacity", "opacity:regressionCiFill")}>Opacity → Confidence interval</SidebarJumpText>;
						set the line&apos;s dash under{" "}
						<SidebarJumpText target={channelJump("pattern", "pattern:regression")}>Pattern → Regression line</SidebarJumpText>.
					</p>
				</>
			)}
		</div>
	)
}

