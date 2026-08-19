import { useEffect, useState } from "react"
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
	type RegressionConfig,
	type SpineConfig,
	type TickmarkConfig,
} from "../../../lib/channelConfig"
import { formatBreaksInput, parseBreaksInput } from "../../../lib/legendBreaks"
import { naturalWrapAlignFor } from "../../../lib/tickLabelWrap"
import { axisConfigFromTheme, valueChanged } from "../../../lib/themeConfig"
import type { FontConfig, LabelAlignment } from "../../../lib/labelsConfig"
import { maxMeaningfulTicks } from "../../../lib/scales"
import type { FieldType, Theme } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
} from "../../../store/atoms"
import { useCurrentTheme } from "../../../store/useCurrentTheme"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { Toggle } from "../../../../../components/ui/Toggle"
import { AlignmentControl, FontEditor } from "../LabelsPanel"

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
		tickmarks: valueChanged(configs[channel]?.tickmarks, themeAxis.tickmarks),
		tickLabelAngle: valueChanged(
			configs[channel]?.tickLabelAngle,
			themeAxis.tickLabelAngle
		),
		tickLabelFont: valueChanged(configs[channel]?.tickLabelFont, undefined),
		tickLabelColor: valueChanged(configs[channel]?.tickLabelColor, undefined),
		wrapTickLabels: valueChanged(configs[channel]?.wrapTickLabels, undefined),
		wrapTickLabelAlign: valueChanged(
			configs[channel]?.wrapTickLabelAlign,
			undefined
		),
		spine: valueChanged(configs[channel]?.spine, themeAxis.spine),
		gridlines: valueChanged(configs[channel]?.gridlines, themeAxis.gridlines),
		histogram: valueChanged(configs[channel]?.histogram, undefined),
		distributionOverlay: valueChanged(
			configs[channel]?.distributionOverlay,
			themeAxis.distributionOverlay
		),
		regression: valueChanged(configs[channel]?.regression, themeAxis.regression),
		jitter:
			valueChanged(configs[channel]?.jitterAmount, themeAxis.jitterAmount) ||
			valueChanged(configs[channel]?.beeswarm, undefined),
		offset:
			valueChanged(configs[channel]?.offset, undefined) ||
			valueChanged(configs[channel]?.offsetX, undefined) ||
			valueChanged(configs[channel]?.offsetY, undefined),
	}
	const sectionChanged = {
		Distribution: ch.histogram || ch.distributionOverlay || ch.jitter,
		Regression: ch.regression,
		// The tick density controls (count / stride) render in the Ticks section
		// on x/y, but under Tick Labels on r (which has no Ticks section).
		// Custom breaks pin extra TICKS and scale range (min/max) pins the
		// domain they lay out on, so both live with the density controls.
		Ticks:
			ch.tickmarks ||
			(channel !== "r" &&
				(ch.tickCount || ch.stride || ch.breaks || ch.min || ch.max)),
		"Tick Labels":
			(channel === "r" && (ch.tickCount || ch.stride)) ||
			ch.format ||
			ch.tickLabelAngle ||
			ch.tickLabelFont ||
			ch.tickLabelColor ||
			ch.wrapTickLabels ||
			ch.wrapTickLabelAlign ||
			(channel !== "r" && ch.offset),
		Spine: ch.spine,
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

	// Effective "Adjust position" nudge in screen px. The legacy single
	// `offset` was perpendicular-only (x-axis: positive = down/away, y-axis:
	// positive = left/away); it's folded in while the new 2D fields are unset
	// — the control clears it on its first write.
	const effOffsetX =
		config.offsetX ?? (channel === "y" ? -(config.offset ?? 0) : 0)
	const effOffsetY =
		config.offsetY ?? (channel === "x" ? (config.offset ?? 0) : 0)

	// Tick density controls — how many ticks get drawn. On a histogram axis the
	// bins are categorical bands — labeling every bin gets crowded, so expose
	// the same stride control the categorical axis uses (label every Nth bin).
	// Otherwise: categorical → stride; continuous → tick count. Lives in the
	// Ticks section on x/y; the r axis has no Ticks section, so it stays under
	// Tick Labels there.
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
			<span className="text-sm text-stone-600">
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
			<span className="text-sm text-stone-600">
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
			<span className="text-sm text-stone-600">max {maxTicks}</span>
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
								beeswarm={config.beeswarm ?? false}
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

			{channel !== "r" && (
				<Section title="Ticks" changed={sectionChanged.Ticks}>
					{tickDensityControls}
					{isContinuous && (
						<ScaleRangeControls
							isTemporal={effectiveType === "temporal"}
							min={config.min ?? null}
							max={config.max ?? null}
							onChange={(next) => update(next)}
							// On a histogram axis min/max limit the binned RANGE.
							rangeHint={
								isBinnedAxis
									? "Limits the value range that gets binned (rows outside are dropped)."
									: undefined
							}
							changed={{ min: ch.min, max: ch.max }}
						/>
					)}
					{/* Extra pinned tick positions, ADDED to the auto layout above
					 *  (Count 0 + breaks = fully custom ticks). Tick labels simply
					 *  follow the ticks. Continuous axes only — a binned histogram
					 *  axis is categorical bands. */}
					{isContinuous && !isBinnedAxis && (
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
					<TickmarkControls
						tick={config.tickmarks ?? DEFAULT_TICKMARK_CONFIG}
						onChange={(t) => update({ tickmarks: t })}
						theme={theme}
					/>
				</Section>
			)}

			<Section title="Tick Labels" changed={sectionChanged["Tick Labels"]}>
				<TickFormatControl
					value={config.customFormat}
					changed={ch.format}
					onChange={(customFormat) => update({ customFormat })}
				/>
				{/* The r axis has no Ticks section, so its density control (count /
				 *  stride) stays here; on x/y it lives in the Ticks section. */}
				{channel === "r" && tickDensityControls}
				<div className="mb-1.5 mt-1.5 flex items-center gap-2">
					<NumberInput
						label="Angle"
						labelClassName={LABEL_COL}
						value={config.tickLabelAngle ?? 0}
						min={-90}
						max={90}
						step={1}
						clamp
						onChange={(tickLabelAngle) => update({ tickLabelAngle })}
						inputClassName="w-20"
						suffix="°"
						changed={ch.tickLabelAngle}
					/>
					{(config.tickLabelAngle ?? 0) !== 0 && (
						<ResetLink
							onClick={() => update({ tickLabelAngle: 0 })}
							underline
						/>
					)}
				</div>
				<div className="mb-1.5 flex flex-col gap-1">
					<Toggle
						label="Wrap text"
						checked={config.wrapTickLabels === true}
						onChange={(wrapTickLabels) => update({ wrapTickLabels })}
						changed={ch.wrapTickLabels}
					/>
					{config.wrapTickLabels === true && (
						<WrapAlignmentControl
							channel={channel}
							tickLabelAngle={config.tickLabelAngle ?? 0}
							value={config.wrapTickLabelAlign}
							changed={ch.wrapTickLabelAlign}
							onChange={(wrapTickLabelAlign) =>
								update({ wrapTickLabelAlign })
							}
						/>
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
				/>
				{channel !== "r" && (
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
						onReset={() =>
							update({
								offset: undefined,
								offsetX: undefined,
								offsetY: undefined,
							})
						}
					/>
				)}
			</Section>

			{channel !== "r" && (
				<Section title="Spine" changed={sectionChanged.Spine}>
					<SpineControls
						spine={config.spine ?? DEFAULT_SPINE_CONFIG}
						onChange={(s) => update({ spine: s })}
						theme={theme}
					/>
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

/** The tick "Format" control: a preset dropdown (numeric + temporal d3
 *  specs) over a free-typed custom format box. Shared with the chord ring
 *  axis's Ticks section AND the per-field data-label formatting, so the
 *  format mental model matches x / y exactly. `label` overrides the row
 *  label (defaults to "Format") — data labels pass the field name. */
export const TickFormatControl = ({
	value,
	changed,
	onChange,
	label = "Format",
}: {
	value: string
	changed: boolean
	onChange: (customFormat: string) => void
	label?: string
}) => (
	<div className="mb-1.5 flex flex-col gap-1.5">
		<label className="flex items-center gap-2 text-sm">
			<span
				className={
					changed
						? "w-24 shrink-0 truncate font-semibold !text-vc-section-header"
						: "w-24 shrink-0 truncate text-stone-600 dark:text-stone-400"
				}
			>
				{label}
			</span>
			<select
				value=""
				onChange={(e) => {
					const v = e.target.value
					if (v === "__auto__") onChange("")
					else if (v) onChange(v)
				}}
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
			>
				<option value="">— Pick a preset —</option>
				<option value="__auto__">Auto (scale default)</option>
					<option value="literal">Literal (show value as-is)</option>
				<optgroup label="Numeric">
					<option value=",">Thousands separator (1,234)</option>
					<option value=".2f">Two decimals (12.34)</option>
					<option value=".0%">Percent (12%)</option>
					<option value=".1%">Percent · 1 decimal (12.3%)</option>
					<option value=".2e">Scientific (1.23e+4)</option>
					<option value="$,.2f">Currency ($1,234.56)</option>
					<option value=".3s">SI prefix (1.23k)</option>
				</optgroup>
				<optgroup label="Temporal">
					<option value="%Y-%m-%d">ISO date (2026-05-20)</option>
					<option value="%b %Y">Month + year (May 2026)</option>
					<option value="%Y">Year (2026)</option>
					<option value="%b %d">Day + month (May 20)</option>
					<option value="%H:%M">Time (14:35)</option>
				</optgroup>
			</select>
		</label>
		<div className="flex items-center gap-2">
			<LabelSpacer />
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Auto"
				aria-label="Custom format code"
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
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
}: {
	title: string
	children: React.ReactNode
	changed?: boolean
}) => (
	<CollapsibleSubsection title={title} changed={changed}>
		{children}
	</CollapsibleSubsection>
)

/** "Adjust position" X/Y nudge (data-labels style) that moves the whole axis
 *  (spine + tick marks + labels + title). The gridlines stay pinned to their
 *  data positions — only the axis chrome moves. Values arrive/leave in screen
 *  coords; the Y input shows math convention (positive = up), so the sign
 *  flips at this boundary in both directions. Renders at the end of the Tick
 *  Labels section behind a divider. */
const AxisAdjustPositionControl = ({
	offsetX,
	offsetY,
	changed,
	onChange,
	onReset,
}: {
	/** Effective nudge in screen px (legacy `offset` already folded in). */
	offsetX: number
	offsetY: number
	changed: boolean
	onChange: (next: { offsetX?: number; offsetY?: number }) => void
	onReset: () => void
}) => (
	<div className="mt-3 flex flex-col gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
		<div className="flex items-center gap-2">
			<span className="vc-group-header">Adjust position</span>
			{(offsetX !== 0 || offsetY !== 0) && (
				<ResetLink
					onClick={onReset}
					underline
				/>
			)}
		</div>
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
		<p className="vc-help">
			Moves the whole axis — spine, tick marks, and labels — without moving
			the gridlines. Positive X moves right; positive Y moves up.
		</p>
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
			<select
				value={histogram.mode}
				onChange={(e) =>
					onChange({
						...histogram,
						mode: e.target.value as "count" | "density",
					})
				}
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
			>
				<option value="count">Counts</option>
				<option value="density">Density (0–1)</option>
			</select>
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
		<span className="vc-help">
			Target bin count — edges snap to round numbers, so the actual number of
			bins may differ.
		</span>
		<label className="flex items-center gap-2 text-sm">
			<span className={LABEL_COL}>Bin labels</span>
			<select
				value={histogram.labelMode}
				onChange={(e) =>
					onChange({
						...histogram,
						labelMode: e.target.value as "range" | "low" | "high",
					})
				}
				className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
			>
				<option value="range">Full range (10 – 20)</option>
				<option value="low">Lowest value (10)</option>
				<option value="high">Highest value (20)</option>
			</select>
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
		<input
			type="text"
			inputMode="decimal"
			value={draft ?? (value ?? "")}
			onChange={handleChange}
			onBlur={() => setDraft(null)}
			className={className}
		/>
	)
}

/** Custom domain bounds for a continuous (quantitative or temporal) axis.
 * The min/max here pin the scale's domain (the base default applied to every
 * panel — facet-level range overrides still win where set). Bounds are stored
 * as plain numbers on the config; temporal values are epoch milliseconds,
 * surfaced/parsed as ISO dates in the inputs. Renders in the Ticks section,
 * between the density controls and the custom-breaks box. */
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
	const lbl = (on: boolean | undefined) =>
		on
			? "font-semibold !text-vc-section-header"
			: "text-stone-600 dark:text-stone-400"
	const toDateInput = (ms: number | null): string =>
		ms === null ? "" : new Date(ms).toISOString().slice(0, 10)
	const parseBound = (raw: string): number | null | undefined => {
		if (raw.trim() === "") return null
		const n = isTemporal ? new Date(raw).getTime() : Number(raw)
		// Bad input (e.g. mid-typing): leave the stored bound untouched.
		return Number.isFinite(n) ? n : undefined
	}
	const commitBound = (bound: "min" | "max", raw: string) => {
		const parsed = parseBound(raw)
		if (parsed === undefined) return
		onChange({ [bound]: parsed })
	}

	const inputClass =
		"w-24 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"

	return (
		<div className="mt-3 flex flex-col gap-1.5 border-t border-stone-200 pt-3 dark:border-stone-700">
			<span className="text-sm text-stone-600 dark:text-stone-400">
				Scale range
			</span>
			<div className="vc-help">
				{rangeHint ??
					"Blank = auto-fit from the data. Set a bound to pin the axis (e.g. min = 0)."}
			</div>
			<div className="flex flex-col gap-1.5 text-sm">
				<label className="flex items-center gap-2">
					<span className={`w-24 ${lbl(changed?.min)}`}>min</span>
					{isTemporal ? (
						<input
							type="date"
							value={toDateInput(min)}
							onChange={(e) => commitBound("min", e.target.value)}
							className={inputClass}
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
					<span className={`w-24 ${lbl(changed?.max)}`}>max</span>
					{isTemporal ? (
						<input
							type="date"
							value={toDateInput(max)}
							onChange={(e) => commitBound("max", e.target.value)}
							className={inputClass}
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

/** Free-typed "Custom breaks" text box, shared by the Ticks section
 * and the Gridlines section. The text is mirrored locally (so the cursor
 * doesn't jump while typing) and the parsed array commits on blur / Enter,
 * matching the legend's break-values box. Values are plain numbers — epoch
 * milliseconds for temporal axes, surfaced/parsed as ISO dates. */
const BreaksField = ({
	isTemporal,
	breaks,
	onCommit,
	hint,
	changed,
}: {
	isTemporal: boolean
	breaks: number[]
	onCommit: (breaks: number[]) => void
	/** Helper text shown under the box. */
	hint: string
	/** "Changed vs default" → bold-purple the label. */
	changed?: boolean
}) => {
	const parseBreaks = (text: string): number[] =>
		isTemporal
			? text
					.split(/[,;]+/)
					.map((s) => s.trim())
					.filter((s) => s !== "")
					.map((s) => new Date(s).getTime())
					.filter((n) => Number.isFinite(n))
			: parseBreaksInput(text)
	const formatBreaks = (vals: number[]): string =>
		isTemporal
			? vals.map((ms) => new Date(ms).toISOString().slice(0, 10)).join(", ")
			: formatBreaksInput(vals)

	const [breaksText, setBreaksText] = useState<string>(
		breaks.length > 0 ? formatBreaks(breaks) : ""
	)
	// Re-sync when `breaks` changes from outside (e.g. loading another visual)
	// and the local text doesn't already parse to it — preserves in-progress
	// typing. Excludes `breaksText` to avoid a re-sync loop.
	useEffect(() => {
		const parsed = parseBreaks(breaksText)
		const same =
			parsed.length === breaks.length && parsed.every((n, i) => n === breaks[i])
		if (!same) setBreaksText(breaks.length > 0 ? formatBreaks(breaks) : "")
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [breaks])
	const commitBreaks = (text: string) => onCommit(parseBreaks(text))

	return (
		<>
			<label className="flex items-center gap-2 text-sm">
				<span
					className={`w-24 shrink-0 ${
						changed
							? "font-semibold !text-vc-section-header"
							: "text-stone-600 dark:text-stone-400"
					}`}
				>
					Custom breaks
				</span>
				<input
					type="text"
					value={breaksText}
					onChange={(e) => setBreaksText(e.target.value)}
					onBlur={() => commitBreaks(breaksText)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							commitBreaks(breaksText)
							e.currentTarget.blur()
						}
					}}
					placeholder={isTemporal ? "e.g. 2024-01-01, 2024-07-01" : "e.g. 0, 50, 100, 150, 200"}
					className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				/>
			</label>
			<div className="flex gap-2">
				<LabelSpacer />
				<span className="min-w-0 flex-1 vc-help">
					{hint}
				</span>
			</div>
		</>
	)
}

/** Spine color + thickness. Shared with the chord ring axis's Spine section
 *  (there the "spine" is the arc along each group's outer edge) and with the
 *  radar Spokes section (there the "spine" is a perimeter spoke). */
export const SpineControls = ({
	spine,
	onChange,
	theme,
	hideColorRow = false,
	showChanged = true,
}: {
	spine: SpineConfig
	onChange: (s: SpineConfig) => void
	theme: Theme
	/** Drop the Color row. Radar spokes take their color from the Color menu's
	 *  "Radar Spine" slot, so the radar panel points at that instead. */
	hideColorRow?: boolean
	/** Show the per-line "changed" dots (differs-from-theme). Off for radar,
	 *  whose Spokes section has never lit dots. */
	showChanged?: boolean
}) => {
	const set = (next: Partial<SpineConfig>) => onChange({ ...spine, ...next })
	// `||` (not `??`) so a 0 / undefined theme value falls back to the
	// built-in default. A theme that somehow has `spineThickness: 0` would
	// otherwise have "reset" produce an invisible spine (= no visible change
	// for the user clicking the link).
	const resetColor = theme.spineColor || DEFAULT_SPINE_CONFIG.color
	const resetThickness = theme.spineThickness || DEFAULT_SPINE_CONFIG.thickness

	return (
		<div className="flex flex-col gap-2">
			{!hideColorRow && (
				<div className="flex items-center gap-2">
					<ColorInput
						label="Color"
						labelClassName={LABEL_COL}
						value={spine.color}
						onChange={(color) => set({ color })}
						changed={showChanged ? valueChanged(spine.color, theme.spineColor) : undefined}
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
						showChanged ? valueChanged(spine.thickness, theme.spineThickness) : undefined
					}
				/>
				{spine.thickness !== resetThickness && (
					<ResetLink onClick={() => set({ thickness: resetThickness })} underline />
				)}
			</div>
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
			<Toggle
				label="Show gridlines"
				checked={grid.enabled}
				onChange={(enabled) => set({ enabled })}
				changed={valueChanged(grid.enabled, true)}
			/>
			{grid.enabled && (
				<>
					<div className="flex items-center gap-2">
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
						<Toggle
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
		<div
			className={`flex flex-col gap-2 ${
				divider
					? "mt-3 border-t border-stone-200 pt-3 dark:border-stone-700"
					: ""
			}`}
		>
			{divider && (
				<span className="text-sm text-stone-600 dark:text-stone-400">
					Tick marks
				</span>
			)}
			<div className="flex items-center gap-2">
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
		/>
	)
}

/** Line alignment for wrapped tick labels — shown only while "Wrap text" is
 *  on (single-line labels have nothing to align). Reuses the Labels panel's
 *  left/center/right glyph buttons. The DEFAULT alignment is the axis's
 *  natural one (per `naturalWrapAlignFor` — anchor-derived, so a rotated x
 *  axis naturally right- or left-aligns), and picking that natural value
 *  stores `undefined`, so the "changed" dot only lights for a real
 *  deviation and older saves stay byte-identical. */
const WrapAlignmentControl = ({
	channel,
	tickLabelAngle,
	value,
	changed,
	onChange,
}: {
	channel: "x" | "y" | "r"
	/** The axis's explicit label angle — flips the natural alignment on a
	 *  rotated x axis (see `naturalWrapAlignFor`). */
	tickLabelAngle: number
	value: LabelAlignment | undefined
	changed: boolean
	onChange: (next: LabelAlignment | undefined) => void
}) => {
	const naturalAlign = naturalWrapAlignFor(channel, tickLabelAngle)
	return (
		<div className="flex items-center gap-2 text-sm">
			<span
				className={
					changed
						? "w-24 shrink-0 font-semibold !text-vc-section-header"
						: "w-24 shrink-0 text-stone-600 dark:text-stone-400"
				}
			>
				Alignment
			</span>
			<AlignmentControl
				value={value ?? naturalAlign}
				onChange={(a) => onChange(a === naturalAlign ? undefined : a)}
			/>
		</div>
	)
}

/** Beeswarm checkbox + jitter slider — shown on the CATEGORICAL side of a strip
 * plot. Checking "Make beeswarm" packs the points (deterministic dot-packing)
 * and disables the jitter slider, since the two are mutually-exclusive ways of
 * spreading points within a category. */
const JitterControl = ({
	jitterAmount,
	beeswarm,
	onChange,
}: {
	jitterAmount: number
	beeswarm: boolean
	onChange: (next: { jitterAmount?: number; beeswarm?: boolean }) => void
}) => (
	<div className="flex flex-col gap-1.5">
		<label className="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				checked={beeswarm}
				onChange={(e) => onChange({ beeswarm: e.target.checked })}
				className="h-3 w-3"
			/>
			<span className="text-stone-600 dark:text-stone-400">Make beeswarm</span>
		</label>
		<label
			className={`flex items-center gap-2 text-sm ${
				beeswarm ? "opacity-40" : ""
			}`}
		>
			<span className={LABEL_COL}>Jitter</span>
			<input
				type="range"
				min={0}
				max={1}
				step={0.05}
				value={jitterAmount}
				disabled={beeswarm}
				onChange={(e) => onChange({ jitterAmount: Number(e.target.value) })}
				className="min-w-0 flex-1"
			/>
			<span className="w-10 text-right text-sm text-stone-600">
				{Math.round(jitterAmount * 100)}%
			</span>
		</label>
	</div>
)

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
		<label className="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				checked={histogram.showRug}
				onChange={(e) =>
					onChange({ histogram: { ...histogram, showRug: e.target.checked } })
				}
				className="h-3 w-3"
			/>
			<span className="text-stone-600 dark:text-stone-400">
				Show points (rug)
			</span>
		</label>
		{histogram.showRug && (
			<>
				<NumberInput
					label="Tassel length"
					labelClassName={LABEL_COL}
					value={histogram.rugTickLength ?? 10}
					min={1}
					max={100}
					step={1}
					clamp
					onChange={(rugTickLength) =>
						onChange({ histogram: { ...histogram, rugTickLength } })
					}
					inputClassName="w-20"
				/>
				<NumberInput
					label="Tassel width"
					labelClassName={LABEL_COL}
					value={histogram.rugTickThickness ?? 1}
					min={0}
					max={20}
					step={0.5}
					clamp
					onChange={(rugTickThickness) =>
						onChange({ histogram: { ...histogram, rugTickThickness } })
					}
					inputClassName="w-20"
				/>
				<p className="vc-help">
					Ticks are centered on the axis (length splits evenly above and
					below). Set the rug color under the <strong>Color</strong> menu →{" "}
					<strong>Rug</strong> and its opacity under the{" "}
					<strong>Opacity</strong> menu → <strong>Rug</strong>.
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
		<NumberInput
			label="Smoothing"
			labelClassName={LABEL_COL}
			value={bandwidthScale}
			min={0.1}
			max={5}
			step={0.1}
			clamp
			onChange={onChangeBandwidth}
			inputClassName="w-20"
		/>
		<div className="flex items-center gap-2 text-sm">
			<LabelSpacer />
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={fill}
					onChange={(e) => onChangeFill(e.target.checked)}
					className="h-3 w-3"
				/>
				<span className="text-stone-600 dark:text-stone-400">Fill under curve</span>
			</label>
		</div>
		<p className="vc-help">
			Smoothing scales the kernel bandwidth — higher is smoother. Set the curve
			color under the <strong>Color</strong> menu → <strong>Density Curve</strong>.
		</p>
	</>
)

type DistributionType = "none" | "histogram" | "density" | "violin" | "box"

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
	const selected: DistributionType = histogram.enabled
		? "histogram"
		: overlay.showDensityCurve
			? "density"
			: overlay.showDensityViolin
				? "violin"
				: overlay.showBoxPlot
					? "box"
					: "none"

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
	const select = (type: DistributionType) =>
		onChange({
			histogram: { ...histogram, enabled: type === "histogram" },
			distributionOverlay: {
				...overlay,
				showDensityCurve: type === "density",
				showDensityViolin: type === "violin",
				showBoxPlot: type === "box",
			},
		})

	const setOverlay = (next: Partial<DistributionOverlayConfig>) =>
		onChange({ distributionOverlay: { ...overlay, ...next } })

	const segBase = "px-2 py-1 text-sm border-l first:border-l-0 border-stone-300 dark:border-stone-700"
	const segClass = (active: boolean) =>
		active
			? `${segBase} bg-brand-500 text-white`
			: `${segBase} bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700`

	return (
		<div className="flex flex-col gap-2">
			<div
				role="radiogroup"
				aria-label="Distribution type"
				className="inline-flex self-start overflow-hidden rounded border border-stone-300 dark:border-stone-700"
			>
				{segments.map((s) => (
					<button
						key={s.key}
						type="button"
						role="radio"
						aria-checked={selected === s.key}
						onClick={() => select(s.key)}
						className={segClass(selected === s.key)}
					>
						{s.label}
					</button>
				))}
			</div>
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
					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
						<RugControls histogram={histogram} onChange={onChange} />
					</div>
					{/* Density curve — a smooth KDE overlaid on the bars, rescaled to
					    their count / relative-frequency units. Divided off as its own
					    cluster, like the rug above. */}
					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={histogram.showDensity === true}
								onChange={(e) =>
									onChange({
										histogram: { ...histogram, showDensity: e.target.checked },
									})
								}
								className="h-3 w-3"
							/>
							<span className="text-stone-600 dark:text-stone-400">
								Show density curve
							</span>
						</label>
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
					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
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
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={overlay.showPoints}
							onChange={(e) => setOverlay({ showPoints: e.target.checked })}
							className="h-3 w-3"
						/>
						<span className="text-stone-600 dark:text-stone-400">
							Show points
						</span>
					</label>
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
							<span className="w-10 text-right text-sm text-stone-600">
								{(overlay.boxWidthScale ?? 1).toFixed(2)}×
							</span>
						</label>
					)}
					<p className="vc-help">
						Set violin / box colors under the <strong>Color</strong> menu →{" "}
						<strong>Violin / Box Fill</strong> and{" "}
						<strong>Violin / Box Outline</strong>.
					</p>
				</>
			)}
		</div>
	)
}

/** Shared segmented-radio row (the Distribution type control's idiom, reused
 * by the Regression section's Type / Position pickers). */
const SegmentedRadioRow = <K extends string>({
	ariaLabel,
	value,
	segments,
	onChange,
}: {
	ariaLabel: string
	value: K
	segments: ReadonlyArray<{ key: K; label: string }>
	onChange: (key: K) => void
}) => {
	const segBase =
		"px-2 py-1 text-sm border-l first:border-l-0 border-stone-300 dark:border-stone-700"
	const segClass = (active: boolean) =>
		active
			? `${segBase} bg-brand-500 text-white`
			: `${segBase} bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700`
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className="inline-flex self-start overflow-hidden rounded border border-stone-300 dark:border-stone-700"
		>
			{segments.map((s) => (
				<button
					key={s.key}
					type="button"
					role="radio"
					aria-checked={value === s.key}
					onClick={() => onChange(s.key)}
					className={segClass(value === s.key)}
				>
					{s.label}
				</button>
			))}
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
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={regression.enabled}
					onChange={(e) => onChange({ enabled: e.target.checked })}
					className="h-3 w-3"
				/>
				<span className="text-stone-600 dark:text-stone-400">
					Add regression line
				</span>
			</label>
			{regression.enabled && (
				<>
					<div className="flex items-center gap-2 text-sm">
						<span className={`shrink-0 ${LABEL_COL}`}>
							Type
						</span>
						<SegmentedRadioRow
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
							Position
						</span>
						<SegmentedRadioRow
							ariaLabel="Regression draw position"
							value={regression.drawPosition}
							segments={[
								{ key: "front", label: "In front" },
								{ key: "back", label: "Behind" },
							]}
							onChange={(drawPosition) => onChange({ drawPosition })}
						/>
					</div>
					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={regression.perGroup}
								onChange={(e) =>
									onChange(
										// Pre-fill the grouping variable from the hue field the
										// moment per-group is switched on (only when nothing is
										// chosen yet); blank otherwise until the user picks one.
										e.target.checked
											? {
													perGroup: true,
													groupField: regression.groupField ?? hueField,
												}
											: { perGroup: false }
									)
								}
								className="h-3 w-3"
							/>
							<span className="text-stone-600 dark:text-stone-400">
								Line per group
							</span>
						</label>
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
					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={regression.showCi}
								onChange={(e) => onChange({ showCi: e.target.checked })}
								className="h-3 w-3"
							/>
							<span className="text-stone-600 dark:text-stone-400">
								Confidence interval
							</span>
						</label>
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
						Style the line and band under the <strong>Color</strong> and{" "}
						<strong>Opacity</strong> menus → <strong>Regression line</strong>{" "}
						and <strong>Confidence interval</strong>; set the line&apos;s dash
						under the <strong>Pattern</strong> menu →{" "}
						<strong>Regression line</strong>.
					</p>
				</>
			)}
		</div>
	)
}

