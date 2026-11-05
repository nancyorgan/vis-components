import { useEffect, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useChartModeDef } from "../../store/useChartModeDef"
import { TickFormatControl } from "./channelOptions/AxisOptionsPanel"
import {
	densityCurveGroupField,
	densityCurveOn,
} from "../../lib/colorSlots"
import {
	PX_PER_UNIT,
	UNIT_OPTIONS,
	UNIT_STEP,
	pxToUnit,
	type DisplayUnit,
} from "../../lib/displayUnits"
import {
	legendHiddenPatch,
	swatchOutlineWidthPatch,
	swatchShapePatch,
	swatchSizePatch,
} from "../../lib/legendEdits"
import { effectiveType } from "../../lib/fieldType"
import { DEFAULT_FILL } from "../../lib/channelConfig"
import { histogramMeasureColorDomain } from "../../lib/histogramMeasureColor"
import { resolveHistogramMeasure } from "../../lib/histogramMeasure"
import {
	DEFAULT_LEGEND_CHANNEL_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	LEGEND_CHANNELS,
	LEGEND_ORIENTATION_OPTIONS,
	LEGEND_POSITION_OPTIONS,
	LEGEND_FRIENDLY_NAME,
	QUANTITATIVE_LEGEND_CHANNELS,
	legendSwatchOutlineColor,
	resolveLegendSwatchOutlineColor,
	resolveLegendSwatchSize,
	resolveLegendHidden,
	resolveGradientBarStyle,
	type EncodingLegendChannel,
	type FontConfig,
	type LabelAlignment,
	type LegendChannel,
	type LegendChannelConfig,
	type LegendConfig,
	type QuantitativeLegendChannel,
	type SwatchShapeChannel,
} from "../../lib/labelsConfig"
import {
	formatBreaksInput,
	legendDataExtent,
	parseBreaksInput,
	resolveLegendBreaks,
} from "../../lib/legendBreaks"
import { planLegendSections } from "../../lib/legendSections"
import {
	legendSwatchControls,
	resolveSectionOutlineWidth,
	resolveSectionSwatchShape,
	sectionOutlineWidthAuto,
	type SwatchMember,
} from "../../lib/legendSwatchControls"
import { isHierarchyModeId, packedSourceOf } from "../../lib/packedMeasure"
import { DEFAULT_PATTERN_INK } from "../../lib/patterns"
import {
	explainLegendCustomization,
	legendConfigFromTheme,
	type LegendDotGroup,
} from "../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentRenderedGradientBarLengthAtom,
	currentRenderedInsideAutoXAtom,
	currentLegendMinHeightAtom,
	currentLegendMinWidthAtom,
	legendSizeProbeWantedAtom,
	currentRenderedLegendHeightAtom,
	currentRenderedLegendWidthAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"

import { AlignmentControl, FontEditor } from "./LabelsPanel"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { SidebarJumpLink } from "../../../../components/ui/SidebarJumpLink"
import { ColorInput } from "../../../../components/ui/ColorInput"
import {
	LABEL_COL,
	LABEL_COL_NESTED,
	LabelSpacerNested,
} from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { renderChannelConfigsAtom } from "../../store/renderConfigs"
import { SwatchShapePicker } from "./SwatchShapePicker"
import { RadioGroup } from "../../../../components/ui/RadioGroup"
import { Segmented } from "../../../../components/ui/Segmented"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Checkbox } from "../../../../components/ui/Checkbox"
import { Input } from "../../../../components/ui/Input"
import { Select } from "../../../../components/ui/Select"

/** Fallbacks when neither the legend config nor the theme provides a swatch
 *  color — one definition so the aux and shape pickers can't drift. */
const DEFAULT_SWATCH_FILL = "#4f8eda"
const DEFAULT_SWATCH_STROKE = "#ffffff"

type BgKind = "transparent" | "themeDefault" | "custom"

const QuantLegendChannelControls = ({
	sectionLabel,
	values,
	fieldType,
	cfg,
	onChange,
}: {
	/** Header text — e.g. "Color legend formatting" for a single channel,
	 *  "Color · Length · Angle legend formatting" when shared. */
	sectionLabel: string
	values: unknown[]
	fieldType: "quantitative" | "temporal" | "ordinal"
	cfg: LegendChannelConfig
	onChange: (next: LegendChannelConfig) => void
}) => {
	// Local mirror of the breaks text input so users can free-type without
	// the parsed array snapping cursor position back on every keystroke. We
	// commit the parsed array on blur (or when the field auto-fills from
	// breakCount), keeping the jotai atom canonical but the textbox
	// uninterrupted.
	const [breaksText, setBreaksText] = useState<string>(
		cfg.breaks.length > 0 ? formatBreaksInput(cfg.breaks) : "",
	)

	// Sync the local text input when `cfg.breaks` changes from OUTSIDE the
	// component — e.g., loading a different visual. Without this, the text
	// input keeps its initial state across visual switches, so the saved
	// breaks load into the jotai atom but stay invisible in the sidebar.
	// We only re-sync when the local text doesn't already parse to the
	// current cfg.breaks — preserves the in-progress typing case.
	useEffect(() => {
		const parsed = parseBreaksInput(breaksText)
		const sameAsCfg =
			parsed.length === cfg.breaks.length &&
			parsed.every((n, i) => n === cfg.breaks[i])
		if (!sameAsCfg) {
			setBreaksText(cfg.breaks.length > 0 ? formatBreaksInput(cfg.breaks) : "")
		}
		// Intentionally excluding `breaksText` to avoid an infinite re-sync
		// loop; the sync only fires when `cfg.breaks` itself changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- see above
	}, [cfg.breaks])

	const commit = (text: string) => {
		const parsed = parseBreaksInput(text)
		onChange({ ...cfg, breaks: parsed })
	}

	const populateFromCount = (count: number) => {
		// Treat the user's current domain as "lo..hi" — either their
		// existing custom breaks min/max, or the underlying data extent.
		// The dropdown then expands into `count` evenly-spaced break
		// values, which the user can refine by hand afterwards.
		const stops = resolveLegendBreaks(
			values,
			fieldType,
			{ ...cfg, breakCount: count, breaks: [] },
			5,
			2,
		)
		const next: LegendChannelConfig = {
			...cfg,
			breakCount: count,
			breaks: stops,
		}
		onChange(next)
		setBreaksText(stops.length > 0 ? formatBreaksInput(stops) : "")
	}

	const extent = legendDataExtent(values, fieldType)
	const dataHint = extent ? `data range ${extent[0]} — ${extent[1]}` : null

	// Each legend's block is a divider group (no rule above the first one,
	// which sits right under the subsection header).
	return (
		<div className="vc-divider-group first:border-t-0 first:pt-0">
			<span className="vc-group-header">
				{sectionLabel}
				{dataHint && (
					<span className="font-normal vc-muted">{` · ${dataHint}`}</span>
				)}
			</span>
			{/* Rows subordinate to the section label indent by ml-6; the narrower
			 * LABEL_COL_NESTED keeps their controls on the shared 104px column
			 * (24px indent + 72px label + 8px gap). */}
			{/* The shared format control (preset dropdown over the custom box)
			 *  sits on the panel's main label column, so its select lines up
			 *  with the nested Breaks rows below (both start at 104px). */}
			<TickFormatControl
				value={cfg.format}
				changed={cfg.format !== ""}
				onChange={(format) => onChange({ ...cfg, format })}
			/>
			<div className="ml-6 flex flex-col gap-2">
				<div className="flex items-center gap-2 text-sm">
					<NumberInput
						label="Breaks"
						labelClassName={LABEL_COL_NESTED}
						value={cfg.breakCount}
						min={2}
						max={12}
						step={1}
						clamp
						onChange={(n) => populateFromCount(n)}
						inputClassName="w-16"
					/>
				</div>
				<label className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL_NESTED}>Custom breaks</span>
					<Input
						type="text"
						value={breaksText}
						onChange={(e) => setBreaksText(e.target.value)}
						onBlur={() => commit(breaksText)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								commit(breaksText)
								e.currentTarget.blur()
							}
						}}
						placeholder="e.g. 0, 50, 100, 150, 200"
						className="flex-1 font-mono"
					/>
				</label>
				<div className="flex gap-2">
					<LabelSpacerNested />
					<span className="min-w-0 flex-1 vc-help">
						Comma- or space-separated. Min and max define the gradient extent;
						the chart&apos;s color/size mapping uses this range too.
					</span>
				</div>
			</div>
		</div>
	)
}

export const LegendPanel = () => {
	const [cfg, setCfg] = useAtom(currentLegendConfigAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const theme = useCurrentTheme()
	const configs = useAtomValue(currentChannelConfigsAtom)
	// What the Legend actually plans from: an untouched density-curve fill
	// varies by the Color variable there (`withColorSlotDefaults`), so the
	// curve's legend section exists without a stored slot.
	const renderConfigs = useAtomValue(renderChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const merged: LegendConfig = { ...DEFAULT_LEGEND_CONFIG, ...cfg }
	// The config a fresh chart on this theme is seeded with — the baseline
	// the reset links below return to (same baseline as the dots).
	const themeLegend = legendConfigFromTheme(theme)
	// Gradient bar: the visual's entries are null until edited and follow
	// the theme live, so `themeBar` (theme → built-in) is what an unset
	// field shows and `bar` is what renders.
	const themeBar = resolveGradientBarStyle(DEFAULT_LEGEND_CONFIG, theme)
	const bar = resolveGradientBarStyle(merged, theme)
	// Sparse against the theme: picking the theme's own value drops the
	// entry, so the dot clears and a later theme edit flows through.
	const barValue = <T,>(next: T, themeValue: T): T | null =>
		next === themeValue ? null : next
	// Per-subsection "changed" dots: a group lights when a setting it owns
	// differs from the theme baseline. Compared against the raw `cfg` (not
	// `merged`) so an absent field falls back to the default without dotting.
	const changedGroups = explainLegendCustomization(cfg, theme)
	const groupChanged = (g: LegendDotGroup): boolean => changedGroups.has(g)

	// Histogram Fill color / opacity can vary by the bins' DERIVED measure
	// (Count / Density) with no backing field. The legend renders a synthetic
	// quantitative section for it (see Legend.tsx), so this panel must treat
	// such a channel like a mapped quantitative one — otherwise the gradient
	// style toggle / break-format editor never surface. Gated on the histogram
	// actually being active so we don't offer controls for a section that
	// wouldn't render.
	const histMeasure = dataset
		? resolveHistogramMeasure(
				encodings,
				(n) => effectiveType(dataset, n, overrides),
				configs
			)
		: null
	const hueMeasureActive = !!(histMeasure && encodings.hue?.measureSource)
	const opacityMeasureActive = !!(histMeasure && encodings.opacity?.measureSource)
	// [0, max] domain for the measure legend, matching the bars + Legend.tsx
	// (shared seam — faceted charts top out at the largest per-panel bin).
	const measureDomain =
		histMeasure && dataset
			? histogramMeasureColorDomain(
					dataset,
					encodings,
					configs,
					overrides,
					levelOrders
				)
			: null
	const measureLabel = histMeasure?.mode === "density" ? "Density" : "Count"

	// Hue field type drives whether the gradient-style toggle is shown at
	// all (only meaningful for a quantitative/temporal hue legend). A hue
	// measure source is always quantitative (count / density numbers).
	const hueField = encodings.hue?.field ?? null
	const hueType = hueMeasureActive
		? "quantitative"
		: hueField && dataset
			? effectiveType(dataset, hueField, overrides)
			: undefined

	const update = (next: Partial<LegendConfig>) => setCfg({ ...merged, ...next })

	// "Legend width": px-truth (`merged.width`) shown in the user's display
	// unit. Blank = auto, with the RENDERED auto width (published by Legend
	// after each render) as the placeholder, so the first spinner click or
	// arrow key steps from the visible number instead of jumping to 0
	// ([[auto-input-step-from-displayed]] — NumberInput steps from a numeric
	// placeholder). The px value is stored UNROUNDED (7.5 cm = 283.46px) and
	// converted back at 4 decimals, so anything a user would type in cm / in
	// round-trips to the same number and NumberInput keeps the in-progress
	// text ("1.", "7.567") — it drops its draft whenever the value it gets
	// back differs from what was typed. The placeholder (auto width) shows
	// the friendlier 2-decimal form; the renderer rounds the px.
	const widthUnit: DisplayUnit = merged.widthUnit ?? "px"
	const autoLegendWidth = useAtomValue(currentRenderedLegendWidthAtom)
	const widthToUnit = (px: number): number =>
		widthUnit === "px"
			? Math.round(px)
			: Number((px / PX_PER_UNIT[widthUnit]).toFixed(4))
	const widthValue = merged.width != null ? widthToUnit(merged.width) : null
	const widthPlaceholder =
		autoLegendWidth != null
			? String(
					widthUnit === "px"
						? Math.round(autoLegendWidth)
						: pxToUnit(autoLegendWidth, widthUnit)
				)
			: "Auto"
	// Stepper floor: the narrowest width the legend can still shrink to
	// (measured by Legend). Rounded UP in the display unit so a step never
	// lands below it. Typing stays unclamped.
	const minLegendWidth = useAtomValue(currentLegendMinWidthAtom)
	const setProbeWanted = useSetAtom(legendSizeProbeWantedAtom)
	useEffect(() => {
		setProbeWanted(true)
		return () => setProbeWanted(false)
	}, [setProbeWanted])
	const toUnitCeil = (px: number, unit: DisplayUnit): number =>
		unit === "px"
			? Math.ceil(px)
			: Math.ceil((px / PX_PER_UNIT[unit]) * 10000) / 10000
	const widthMin =
		minLegendWidth != null ? toUnitCeil(minLegendWidth, widthUnit) : 0
	const commitWidthUnit = (n: number) =>
		update({ width: Math.max(0, n * PX_PER_UNIT[widthUnit]) })

	// "Legend height": same px-truth / display-unit / auto-placeholder scheme
	// as the width. The placeholder is the legend's natural height (default
	// row spacing); a typed height re-spaces the entry rows to fill it.
	const heightUnit: DisplayUnit = merged.heightUnit ?? "px"
	const autoLegendHeight = useAtomValue(currentRenderedLegendHeightAtom)
	const heightValue =
		merged.height != null
			? heightUnit === "px"
				? Math.round(merged.height)
				: Number((merged.height / PX_PER_UNIT[heightUnit]).toFixed(4))
			: null
	const heightPlaceholder =
		autoLegendHeight != null
			? String(
					heightUnit === "px"
						? Math.round(autoLegendHeight)
						: pxToUnit(autoLegendHeight, heightUnit)
				)
			: "Auto"
	const minLegendHeight = useAtomValue(currentLegendMinHeightAtom)
	const heightMin =
		minLegendHeight != null ? toUnitCeil(minLegendHeight, heightUnit) : 0
	const commitHeightUnit = (n: number) =>
		update({ height: Math.max(0, n * PX_PER_UNIT[heightUnit]) })

	// Rendered auto length of the gradient bar, published by the legend's
	// GradientBarRamp after each render. Placeholder + step start for the
	// "Bar length" input; 128 (the vertical bar's 8rem minimum) covers the
	// window before any bar has rendered.
	const autoGradientBarLength = useAtomValue(
		currentRenderedGradientBarLengthAtom,
	)
	const resolveGradientBarLengthStart = (): number =>
		bar.length ??
		(autoGradientBarLength && autoGradientBarLength > 0
			? autoGradientBarLength
			: 128)

	// Effective top-left-anchored X of an AUTO inside legend (insideX null =
	// hug the upper-right corner), published by ChartCanvas after each
	// measure. Placeholder + step start for the inside "X" input, so the
	// first interaction takes over from where the legend actually sits
	// instead of jumping it back to the left edge. 3 decimals keeps the
	// takeover shift sub-pixel at typical plot widths.
	const autoInsideX = useAtomValue(currentRenderedInsideAutoXAtom)
	const roundedAutoInsideX =
		autoInsideX != null ? Math.round(autoInsideX * 1000) / 1000 : null

	const modeDef = useChartModeDef()
	// EFFECTIVE per-channel visibility for every read below: the raw sparse
	// map plus the mode's default-hidden channels (e.g. Size starts off in
	// flow / hierarchy modes). Reads use `effHidden`; writes keep spreading
	// `merged.hidden` so mode defaults never get baked into the saved visual
	// (which would light the "changed" dot on a fresh chart).
	const effHidden = resolveLegendHidden(merged.hidden, modeDef.legend)
	// Tree modes (packed circles / treemap / sunburst): Fill color varied by
	// a DERIVED source (Top-level group / Nesting depth) has no field but
	// renders a discrete Color legend (legendSections' derived-hue section),
	// so its "Legends shown" toggle must surface too. Gated like the section:
	// a mapped connection, or there is no tree to derive from.
	const hueDerivedActive =
		isHierarchyModeId(modeDef.id) &&
		packedSourceOf(encodings.hue) !== null &&
		!!encodings.connection?.field

	const setHidden = (channel: LegendChannel, hidden: boolean) =>
		update(legendHiddenPatch(merged, channel, hidden, modeDef.legend))

	// Only surface toggles for channels that are actually mapped AND
	// meaningful in the current chart mode (e.g. length is hidden in bar
	// charts because it's the measure axis — surfacing the toggle would
	// imply the user could turn on a section that doesn't exist).
	const mappedLegendChannels = LEGEND_CHANNELS.filter((ch) => {
		// A measure source (Count/Density) counts as "mapped" for hue / opacity
		// even though it has no field — as does a hierarchy-derived hue.
		const measureMapped =
			(ch === "hue" && (hueMeasureActive || hueDerivedActive)) ||
			(ch === "opacity" && opacityMeasureActive)
		if (!encodings[ch]?.field && !measureMapped) return false
		if (ch === "length" && modeDef.legend.hideLengthInThisMode) return false
		if (ch === "angle" && modeDef.legend.hideAngleInThisMode) return false
		return true
	})

	// The rug color slot is a legend channel too (its own "Legends shown"
	// toggle), but it's slot-mapped rather than encoding-mapped — surfaced only
	// when a rug is actually drawn and colored by a field.
	const rugVisible = (c: (typeof configs)["x"]): boolean =>
		c?.histogram?.showRug === true &&
		(c?.histogram?.enabled === true ||
			c?.distributionOverlay?.showDensityCurve === true)
	const rugLegendMapped =
		!!configs.colorSlots?.rug?.field &&
		(rugVisible(configs.x) || rugVisible(configs.y))

	// A density curve grouped by a field gets its own "Density Curve" legend
	// (its categories), with a hide toggle — same pattern as the rug.
	const densityCurveLegendMapped =
		!!densityCurveGroupField(renderConfigs) && densityCurveOn(configs)

	// Slot legends the renderer folds into another legend on their field (a
	// rug / density curve colored exactly like the Color legend — see the
	// coalescing pass in planLegendSections). Mirrored here so the panel
	// doesn't offer swatch controls for a section that isn't drawn. Same
	// inputs the Legend hands the planner; the inside offsets only place the
	// box and don't change which sections exist.
	const coalescedSlots: readonly LegendChannel[] =
		dataset && (rugLegendMapped || densityCurveLegendMapped)
			? (planLegendSections({
					encodings,
					configs: renderConfigs,
					dataset,
					overrides,
					labels,
					legendCfg: { ...merged, hidden: effHidden },
					modeDef,
					insideExtras: { top: 0, right: 0, bottom: 0, left: 0 },
					levelOrders,
				})?.coalescedSlots ?? [])
			: []

	// When every mapped legend channel is hidden via the "Legends shown"
	// toggles, the legend won't render at all — so the position / border /
	// background controls below have nothing to act on. Collapse the
	// "Legend properties" section in that case to avoid implying the user
	// is configuring something visible.
	const anyLegendVisible =
		mappedLegendChannels.some((ch) => !effHidden[ch]) ||
		(rugLegendMapped && !effHidden.rug) ||
		(densityCurveLegendMapped && !effHidden.densityCurve)

	// Quantitative-legend channels that are mapped to a quant/temporal/
	// ordinal-numeric field AND not user-hidden via the "Legends shown"
	// toggles. Hidden channels drop their break/format editor so the
	// sidebar isn't crowded with controls for things that don't render.
	const quantLegendChannels = QUANTITATIVE_LEGEND_CHANNELS.filter((ch) => {
		if (!mappedLegendChannels.includes(ch)) return false
		if (effHidden[ch as LegendChannel]) return false
		const field = encodings[ch]?.field
		if (!field || !dataset) return false
		const t = effectiveType(dataset, field, overrides)
		return t === "quantitative" || t === "temporal" || t === "ordinal"
	})

	// Group the quant channels by the field they encode. Channels that
	// share a field get ONE editor whose edits fan out to every channel in
	// the group — so a user typing breakpoints for the Color legend on
	// `silliness_score` doesn't have to retype them on the Length and
	// Angle legends.
	const quantChannelGroups: { field: string; channels: QuantitativeLegendChannel[] }[] = []
	{
		const seenFields = new Map<string, number>()
		for (const ch of quantLegendChannels) {
			const f = encodings[ch]?.field
			if (!f) continue
			const existingIdx = seenFields.get(f)
			if (existingIdx !== undefined) {
				quantChannelGroups[existingIdx].channels.push(ch)
			} else {
				seenFields.set(f, quantChannelGroups.length)
				quantChannelGroups.push({ field: f, channels: [ch] })
			}
		}
	}

	const updateChannelGroup = (
		channels: QuantitativeLegendChannel[],
		next: LegendChannelConfig,
	) => {
		const nextChannels = { ...(merged.channels ?? {}) }
		for (const ch of channels) nextChannels[ch] = next
		update({ channels: nextChannels })
	}

	// Break / format editors for the measure legend(s). These have no field, so
	// they're built from the [0, max] measure domain rather than `quantChannelGroups`.
	// Editing writes `channels.hue` / `channels.opacity`, which the synthetic
	// measure section in Legend.tsx reads — so breaks / number format apply.
	const measureFormatGroups: {
		channel: "hue" | "opacity"
		values: unknown[]
	}[] = []
	if (measureDomain && measureDomain.max > 0) {
		if (hueMeasureActive && !effHidden.hue)
			measureFormatGroups.push({
				channel: "hue",
				values: [measureDomain.min, measureDomain.max],
			})
		if (opacityMeasureActive && !effHidden.opacity)
			measureFormatGroups.push({
				channel: "opacity",
				values: [measureDomain.min, measureDomain.max],
			})
	}

	// Visibility flags for the "always-rendered" sub-sections — only show
	// them when their channel is actually mapped and not hidden, so users
	// editing a vector field (length + angle only) don't see Shape swatch
	// and Hue gradient-style controls cluttering the panel.
	const showGradientLegendStyle =
		mappedLegendChannels.includes("hue") &&
		!effHidden.hue &&
		(hueType === "quantitative" || hueType === "temporal")
	const showShapeSwatch =
		mappedLegendChannels.includes("shape") && !effHidden.shape
	// The hue swatch-shape picker only matters when the color legend renders
	// discrete swatches: a categorical/ordinal hue legend, or a
	// quantitative/temporal one the user has switched to "swatches" style. A
	// plain gradient bar has no swatches to reshape, so the picker stays
	// hidden there.
	const rendersSwatches = (t: ReturnType<typeof effectiveType> | undefined) =>
		t === "categorical" ||
		t === "ordinal" ||
		((t === "quantitative" || t === "temporal") &&
			(merged.gradientLegendStyle ?? "bar") === "swatches")
	// Every legend section that draws discrete swatches gets its own
	// swatch-shape picker, keyed by the channel that LEADS the section in the
	// renderer (Legend.tsx's GROUP_CHANNELS order): channels sharing a field
	// collapse into one combined section that reads its shape from its first
	// channel — so a pattern on hue's field is covered by the Color picker,
	// while a standalone pattern gets a Pattern picker of its own.
	const outlineHueField = encodings.outlineHue?.field ?? null
	const outlineHueType =
		outlineHueField && dataset
			? effectiveType(dataset, outlineHueField, overrides)
			: undefined
	const rugField = configs.colorSlots?.rug?.field ?? null
	const rugType =
		rugField && dataset ? effectiveType(dataset, rugField, overrides) : undefined
	const rugRendersSwatches =
		rugLegendMapped &&
		!effHidden.rug &&
		!coalescedSlots.includes("rug") &&
		rendersSwatches(rugType)
	const combineLegendSections = merged.combineSameVariable !== false
	// Group channels that can lead a swatch-drawing section, in the
	// renderer's GROUP_CHANNELS order.
	const swatchGroupChannels = [
		"hue",
		"outlineHue",
		"saturation",
		"brightness",
		"pattern",
		"opacity",
	] as const
	type SwatchGroupChannel = (typeof swatchGroupChannels)[number]
	// Mapped + visible (per the "Legends shown" toggles).
	const swatchChannelActive = (ch: SwatchGroupChannel): boolean =>
		mappedLegendChannels.includes(ch) && !effHidden[ch]
	const leadsSwatchSection = (ch: SwatchGroupChannel): boolean => {
		if (!swatchChannelActive(ch)) return false
		const field = encodings[ch]?.field
		if (!field) return false
		// With combining off every channel emits its own section.
		if (!combineLegendSections) return true
		// A visible shape channel on the same field turns the combined
		// section's swatches into per-category shape glyphs, which ignore the
		// swatch shape — don't offer an inert picker.
		if (showShapeSwatch && encodings.shape?.field === field) return false
		// The first group channel on the field keys the section; later ones
		// are covered by that channel's picker.
		return !swatchGroupChannels
			.slice(0, swatchGroupChannels.indexOf(ch))
			.some((prev) => swatchChannelActive(prev) && encodings[prev]?.field === field)
	}
	// Every swatch-group channel folded into the section `ch` leads — the
	// group's header names them all ("Brightness · Pattern") so a combined
	// section's controls aren't mislabeled as the lead channel alone.
	const swatchSectionMembers = (ch: SwatchGroupChannel): SwatchGroupChannel[] => {
		const field = encodings[ch]?.field
		if (!field || !combineLegendSections) return [ch]
		return swatchGroupChannels.filter(
			(c) => swatchChannelActive(c) && encodings[c]?.field === field
		)
	}
	// The glyph the marks draw when no Shape field varies it — same mode
	// rule Legend.tsx applies (the Default shape only draws in glyph modes).
	const marksShape =
		modeDef.canvas.shapeRole === "glyph" ? (renderConfigs.defaultShape ?? 0) : 0
	// EVERY channel the renderer folds into the section on `field` that
	// `lead` leads — group channels plus Shape / Length / Angle / Size, in
	// the renderer's GROUP_CHANNELS order. legendSwatchControls turns this
	// into the subsection's rows, so the panel offers exactly the swatch
	// properties no member encodes.
	const sectionMembersOf = (
		field: string | null | undefined,
		lead: SwatchMember
	): SwatchMember[] => {
		if (!field || !combineLegendSections) return [lead]
		const order: SwatchMember[] = [
			...swatchGroupChannels,
			"shape",
			"length",
			"angle",
			"area",
		]
		return order.filter(
			(c) =>
				c === lead ||
				(mappedLegendChannels.includes(c as EncodingLegendChannel) &&
					!effHidden[c as LegendChannel] &&
					encodings[c as keyof typeof encodings]?.field === field &&
					(c !== "shape" || showShapeSwatch))
		)
	}
	// Line-chart context for the rule (a Pattern member draws the dash
	// overlay) — the same test Legend.tsx hands the renderer.
	const swatchCtx = {
		connection:
			!modeDef.legend.hideConnectionInThisMode && !!encodings.connection?.field,
	}
	const isQuantField = (field: string | null | undefined): boolean => {
		if (!field || !dataset) return false
		const t = effectiveType(dataset, field, overrides)
		return t === "quantitative" || t === "temporal"
	}
	// A quantitative color section falls back to discrete swatches — even in
	// "bar" gradient style — when another group channel shares its field (a
	// composed per-stop visual can't render as a continuous gradient strip).
	const quantForcedToSwatches = (field: string | null): boolean =>
		!!field &&
		combineLegendSections &&
		((["saturation", "brightness", "pattern", "opacity"] as const).some(
			(c) => swatchChannelActive(c) && encodings[c]?.field === field
		) ||
			// Size / Angle on the field draw per-stop glyphs (the combined
			// legend's glyph path), whatever the gradient style.
			(["area", "angle"] as const).some(
				(c) =>
					mappedLegendChannels.includes(c) &&
					!effHidden[c] &&
					encodings[c]?.field === field
			))
	const hueRendersSwatches =
		mappedLegendChannels.includes("hue") &&
		!effHidden.hue &&
		// A derived tree hue (Top-level group / depth) has no field type but
		// renders discrete swatches, so the swatch controls apply to it too.
		(hueDerivedActive ||
			rendersSwatches(hueType) ||
			((hueType === "quantitative" || hueType === "temporal") &&
				quantForcedToSwatches(hueField)))
	const outlineHueRendersSwatches =
		mappedLegendChannels.includes("outlineHue") &&
		!effHidden.outlineHue &&
		(rendersSwatches(outlineHueType) ||
			((outlineHueType === "quantitative" || outlineHueType === "temporal") &&
				quantForcedToSwatches(outlineHueField)))
	// The shape channel never emits a swatch-shape section (its glyphs ARE the
	// encoding) — it gets its own "Shape swatch" subsection below instead.
	const swatchShapeSections: Exclude<SwatchShapeChannel, "shape">[] = [
		...(hueRendersSwatches && leadsSwatchSection("hue")
			? (["hue"] as const)
			: []),
		...(outlineHueRendersSwatches && leadsSwatchSection("outlineHue")
			? (["outlineHue"] as const)
			: []),
		...(["saturation", "brightness", "pattern", "opacity"] as const).filter(
			leadsSwatchSection
		),
		...(rugRendersSwatches ? (["rug"] as const) : []),
	]
	// Swatch shape / size / outline entries are SPARSE against the theme:
	// picking the theme's own value drops the entry (so the subsection's dot
	// clears and a later theme edit flows through), anything else is stored
	// explicitly — the rectangle as "rect", since a stored null means
	// "follow the theme". Hue's legacy global fields are cleared alongside
	// so they can't shine through a dropped entry.
	const setSwatchSize = (ch: SwatchShapeChannel, size: number) =>
		update(swatchSizePatch(merged, ch, size, theme))
	const setSwatchOutlineColor = (ch: SwatchShapeChannel, color: string) =>
		update({
			swatchOutlineColors: { ...merged.swatchOutlineColors, [ch]: color },
		})
	const resetSwatchOutlineColor = (ch: SwatchShapeChannel) => {
		// Back to the theme's default (its own color, else auto: pipe in the
		// marks' outline color). An explicit null entry is needed to override
		// a legacy GLOBAL color; otherwise keep the stored map sparse.
		const next = { ...merged.swatchOutlineColors }
		if (merged.swatchOutlineColor != null) next[ch] = null
		else delete next[ch]
		update({ swatchOutlineColors: next })
	}
	// The standalone-swatch color picker appears for channels in
	// {length, angle, area, opacity} that are mapped + visible AND aren't
	// sharing a field with hue (those get their color from the hue
	// gradient, so the swatch picker doesn't apply). The subheader's
	// text names exactly the channels that USE the color — e.g. just
	// "Length" when length stands alone, "Length · Angle" when both do.
	const visibleHueField =
		mappedLegendChannels.includes("hue") && !effHidden.hue
			? hueField
			: null
	const auxSwatchableChannels: EncodingLegendChannel[] = ["length", "angle", "area", "opacity"]
	const auxSwatchActiveChannels = auxSwatchableChannels.filter((ch) => {
		if (!mappedLegendChannels.includes(ch)) return false
		if (effHidden[ch]) return false
		// Field-mapped opacity carries its own Swatch color row inside the
		// "Swatches" section (its per-section group), so it drops out of this
		// shared subsection. Only the measure-mapped (Count / Density) opacity
		// ramp — which has no group there — still needs this picker.
		if (ch === "opacity" && encodings.opacity?.field) return false
		// Sharing a field with the visible hue channel means the swatch
		// inherits color from the gradient — the picker would have no
		// visible effect, so leave it out of the header.
		const f = encodings[ch]?.field
		if (f && visibleHueField && f === visibleHueField) return false
		// Likewise any other group channel (Saturation, Pattern, …) on the
		// field: the section is that channel's, and its own subsection
		// carries the swatch rows (legendSwatchControls) — a second picker
		// here would edit settings that section doesn't read.
		if (
			f &&
			combineLegendSections &&
			swatchGroupChannels.some(
				(g) => swatchChannelActive(g) && encodings[g]?.field === f
			)
		)
			return false
		return true
	})
	// "Combine legends with same variables": when on (the default), an aux
	// channel that shares the SHAPE channel's field folds into a single
	// "Size · Shape swatch" subsection whose fill / stroke (the shape
	// channel's — it wins in the combined glyph) governs the merged swatch.
	// Those channels drop out of the standalone aux-swatch header so the user
	// isn't offered a second, no-effect color picker for the same swatch.
	const shapeField = showShapeSwatch ? (encodings.shape?.field ?? null) : null
	const auxSharingShapeField =
		combineLegendSections && shapeField
			? auxSwatchActiveChannels.filter((ch) => encodings[ch]?.field === shapeField)
			: []
	// Every channel the Shape legend section depicts, and the rows it gets
	// (legendSwatchControls): Color on the field owns the fill, Pattern
	// tiles it, Outline color owns the stroke color, Size the radius.
	const shapeMembers: SwatchMember[] = sectionMembersOf(shapeField, "shape")
	const shapeControls = legendSwatchControls(shapeMembers)
	// ≥2 members → the combined renderer (its defaults differ from the
	// standalone Shape legend's).
	const shapeSectionCombined = shapeMembers.length > 1
	// Aux channels shown in their OWN swatch subsection = the active ones not
	// folded into the Shape swatch above.
	const auxSwatchDisplayChannels = auxSwatchActiveChannels.filter(
		(ch) => !auxSharingShapeField.includes(ch)
	)
	const showAuxSwatchColor = auxSwatchDisplayChannels.length > 0
	const auxSwatchHeader = auxSwatchDisplayChannels
		.map((ch) => LEGEND_FRIENDLY_NAME[ch])
		.join(" · ")
	const resolvedAuxSwatchColor =
		merged.auxLegendSwatchColor ?? theme.legendSwatchColor ?? DEFAULT_SWATCH_FILL
	// The swatch border only applies to the area (size) legend — its swatch
	// is a filled circle. Length / angle swatches are lines and opacity
	// swatches are borderless, so only surface the border control when the
	// area channel is among the active aux swatches.
	const showAuxSwatchStroke = auxSwatchDisplayChannels.includes("area")
	const resolvedAuxSwatchStroke =
		merged.auxLegendSwatchStroke ?? theme.legendSwatchStroke ?? DEFAULT_SWATCH_STROKE
	// No-hue pattern tiles (a section with Pattern but no Color — pattern-,
	// saturation-, brightness-, opacity-, outline- or shape-led): the tiles
	// ARE the fill, defaulting to the Pattern menu's Background (else gray)
	// under a near-black ink — offer both as legend-side overrides.
	// Per-category ink overrides from the Pattern menu still win in the
	// renderer. Shared by every swatch subsection whose fill control is
	// "pattern" (legendSwatchControls).
	const patternFillRows = (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Background"
					labelClassName={LABEL_COL}
					value={
						merged.patternLegendBgColor ??
						configs.defaultFill ??
						DEFAULT_FILL
					}
					onChange={(patternLegendBgColor) =>
						update({ patternLegendBgColor })
					}
					showHexInput
				/>
				{merged.patternLegendBgColor != null && (
					<ResetLink
						onClick={() =>
							update({ patternLegendBgColor: null })
						}
					/>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<ColorInput
					label="Pattern color"
					labelClassName={LABEL_COL}
					value={
						merged.patternLegendInkColor ??
						DEFAULT_PATTERN_INK
					}
					onChange={(patternLegendInkColor) =>
						update({ patternLegendInkColor })
					}
					showHexInput
				/>
				{merged.patternLegendInkColor != null && (
					<ResetLink
						onClick={() =>
							update({ patternLegendInkColor: null })
						}
					/>
				)}
			</div>
		</>
	)
	// Header for the shape swatch subsection: when a same-field aux channel
	// (e.g. Size) merged in, name both — "Size · Shape" — so it's clear this
	// one control drives the combined legend's swatch.
	const shapeSwatchHeader = shapeMembers
		.map((ch) => LEGEND_FRIENDLY_NAME[ch as LegendChannel])
		.join(" · ")
	// The combine toggle only makes sense when ≥2 legend channels actually
	// share a field; otherwise there's nothing to combine. The rug and
	// density-curve slot legends count too — they fold into a same-field
	// Color legend (or into each other) under the same toggle.
	const sharedVariableExists = (() => {
		const byField = new Map<string, number>()
		const count = (f: string | null | undefined) => {
			if (f) byField.set(f, (byField.get(f) ?? 0) + 1)
		}
		for (const ch of mappedLegendChannels) {
			if (effHidden[ch as LegendChannel]) continue
			count(encodings[ch]?.field)
		}
		if (rugLegendMapped && !effHidden.rug) count(configs.colorSlots?.rug?.field)
		if (densityCurveLegendMapped && !effHidden.densityCurve) {
			count(densityCurveGroupField(renderConfigs))
		}
		for (const n of byField.values()) if (n >= 2) return true
		return false
	})()

	const bgKind: BgKind =
		merged.backgroundColor === null
			? "transparent"
			: merged.backgroundColor === theme.legendBackgroundColor
				? "themeDefault"
				: "custom"
	const setBgKind = (kind: BgKind) => {
		if (kind === "transparent") update({ backgroundColor: null })
		else if (kind === "themeDefault")
			update({ backgroundColor: theme.legendBackgroundColor ?? "#ffffff" })
		else update({ backgroundColor: merged.backgroundColor ?? "#ffffff" })
	}

	// "Legend text" — what the entry labels inherit when the per-visual
	// `textFont` leaves a field blank. Mirrors `resolveLegendTextFont`'s
	// fallback chain minus the override the editor itself writes, and stays
	// in POINTS (the font editor's unit; the resolver converts to px).
	const baseText = labels.baseFont.text
	const inheritedTextFont = {
		family: baseText.legendFamily ?? baseText.family,
		color: baseText.legendColor ?? baseText.color,
		size: baseText.legendSize ?? baseText.size,
		// Entry labels render with no weight attribute when nothing sets one,
		// so the browser's 400 is what the user actually sees inherited.
		weight: baseText.legendWeight ?? baseText.weight ?? 400,
		italic: baseText.legendItalic ?? baseText.italic ?? false,
		underline: baseText.legendUnderline ?? baseText.underline ?? false,
	}
	// The bar's break labels with no visual or theme alignment: centered
	// under a horizontal bar, left beside a vertical one.
	const breakLabelAlignAuto: LabelAlignment =
		merged.orientation === "horizontal" ? "center" : "left"
	// Left IS the historical layout (labels hug their swatches), so picking it
	// clears the setting rather than storing a redundant value — keeps the
	// config sparse and the subsection's dot honest.
	const setTextAlign = (a: LabelAlignment) =>
		update({ textAlign: a === "left" ? null : a })
	// The font editor clears a field by writing it back as `undefined`, which
	// still counts as a key — and a key is what the "changed" dot reads. Drop
	// them so clearing every field really does read as untouched.
	const setTextFont = (next: Partial<FontConfig>) => {
		const clean: Partial<FontConfig> = {}
		for (const [k, v] of Object.entries(next)) {
			if (v !== undefined) (clean as Record<string, unknown>)[k] = v
		}
		update({ textFont: clean })
	}

	return (
		<div className="vc-option-panel">
			{/* "Legends shown" comes first — every other control on the
			 *  panel is downstream of which channels are visible. Hiding all
			 *  channels here is also how the user disables the legend now
			 *  that the "Show legend" master toggle has been retired. */}
			{(mappedLegendChannels.length > 0 ||
				rugLegendMapped ||
				densityCurveLegendMapped) && (
				<CollapsibleSubsection
						title="Legends shown"
						changed={groupChanged("shown")}
					>
					{mappedLegendChannels.map((ch) => (
						<Checkbox
							key={ch}
							label={LEGEND_FRIENDLY_NAME[ch]}
							checked={!effHidden[ch]}
							onChange={(show) => setHidden(ch, !show)}
						/>
					))}
					{rugLegendMapped && (
						<Checkbox
							key="rug"
							label={LEGEND_FRIENDLY_NAME.rug}
							checked={!effHidden.rug}
							onChange={(show) => setHidden("rug", !show)}
						/>
					)}
					{densityCurveLegendMapped && (
						<Checkbox
							key="densityCurve"
							label={LEGEND_FRIENDLY_NAME.densityCurve}
							checked={!effHidden.densityCurve}
							onChange={(show) => setHidden("densityCurve", !show)}
						/>
					)}
					{/* Merge legends for encodings that share a field into one
					 *  section + one title, instead of a legend per channel. Only
					 *  offered when there's actually a shared field to combine. */}
					{sharedVariableExists && (
						<div className="vc-divider-group">
							<Checkbox
								label="Combine legends with same variables"
								checked={combineLegendSections}
								onChange={(combineSameVariable) =>
									update({ combineSameVariable })
								}
							/>
							<p className="vc-help">
								When more than one encoding maps to the same field, show one
								combined legend.
							</p>
						</div>
					)}
				</CollapsibleSubsection>
			)}

			{anyLegendVisible && (
				<CollapsibleSubsection
						title="Legend properties"
						changed={groupChanged("properties")}
					>
					{/* Placement group — position (+ inside coords) and orientation.
					 *  Each group is wrapped in its own `flex flex-col gap-2` so rows
					 *  get vertical breathing room, and groups are split by a gray
					 *  `border-t` rule matching the encoding option panels. */}
					<div className="flex flex-col gap-2">
						<SelectInput
							label="Position"
							labelClassName={LABEL_COL}
							value={merged.position}
							options={LEGEND_POSITION_OPTIONS}
							onChange={(position) => update({ position })}
							selectClassName="flex-1"
						/>
						{merged.position === "inside" && (
							<>
								{/* X is nullable: blank/auto anchors the legend's RIGHT
								 *  edge in the plot's upper-right corner — no top-left-
								 *  anchored number can hug that corner without knowing
								 *  the legend's width. The placeholder shows the
								 *  equivalent top-left X published by the render; focus
								 *  seeds it so every interaction steps from where the
								 *  legend actually sits, and clearing reverts to auto
								 *  (mirrors the Bar length input below). */}
								<div className="flex items-center gap-2">
									<NumberInput
										label="X"
										labelClassName={LABEL_COL}
										value={merged.insideX ?? null}
										step={0.02}
										placeholder={
											roundedAutoInsideX != null
												? String(roundedAutoInsideX)
												: "Auto"
										}
										onChange={(insideX) => update({ insideX })}
										onClear={() => update({ insideX: null })}
										inputClassName="w-16"
									/>
									{merged.insideX != null && (
										<ResetLink onClick={() => update({ insideX: null })} />
									)}
								</div>
								<div className="flex items-center gap-2">
									<NumberInput
										label="Y"
										labelClassName={LABEL_COL}
										value={merged.insideY}
										onChange={(insideY) => update({ insideY })}
										step={0.02}
										inputClassName="w-16"
									/>
									{merged.insideY !== DEFAULT_LEGEND_CONFIG.insideY && (
										<ResetLink
											onClick={() => update({ insideY: DEFAULT_LEGEND_CONFIG.insideY })}
										/>
									)}
								</div>
							</>
						)}
					</div>

					{/* Legend width group — a fixed box width (px truth, shown in
					 *  px / in / cm) between Position and Orientation. Blank = auto.
					 *  Labels that stop fitting wrap onto extra lines in the render. */}
					<div className="vc-divider-group">
						<div className="flex items-center gap-2">
							<NumberInput
								label="Legend width"
								labelClassName={LABEL_COL}
								min={widthMin}
								step={UNIT_STEP[widthUnit]}
								value={widthValue}
								placeholder={widthPlaceholder}
								onChange={commitWidthUnit}
								onClear={() => update({ width: null })}
								inputClassName="w-20"
							/>
							<Select
								aria-label="Legend width unit"
								value={widthUnit}
								onChange={(e) =>
									update({ widthUnit: e.target.value as DisplayUnit })
								}
							>
								{UNIT_OPTIONS.map((u) => (
									<option key={u} value={u}>
										{u}
									</option>
								))}
							</Select>
							{merged.width != null && (
								<ResetLink onClick={() => update({ width: null })} />
							)}
						</div>
					</div>

					{/* Legend height group — a fixed box height; the gap between
					 *  stacked entries stretches or tightens to fill it. */}
					<div className="vc-divider-group">
						<div className="flex items-center gap-2">
							<NumberInput
								label="Legend height"
								labelClassName={LABEL_COL}
								min={heightMin}
								step={UNIT_STEP[heightUnit]}
								value={heightValue}
								placeholder={heightPlaceholder}
								onChange={commitHeightUnit}
								onClear={() => update({ height: null })}
								inputClassName="w-20"
							/>
							<Select
								aria-label="Legend height unit"
								value={heightUnit}
								onChange={(e) =>
									update({ heightUnit: e.target.value as DisplayUnit })
								}
							>
								{UNIT_OPTIONS.map((u) => (
									<option key={u} value={u}>
										{u}
									</option>
								))}
							</Select>
							{merged.height != null && (
								<ResetLink onClick={() => update({ height: null })} />
							)}
						</div>
					</div>

					<div className="vc-divider-group">
						<div className="flex items-center gap-2 text-sm">
							<span className={LABEL_COL}>Orientation</span>
							<Segmented
								ariaLabel="Orientation"
								value={merged.orientation}
								segments={LEGEND_ORIENTATION_OPTIONS.map((o) => ({
									key: o.value,
									label: o.label,
								}))}
								onChange={(orientation) => update({ orientation })}
							/>
						</div>
					</div>

					<div className="vc-divider-group">
						<div className="flex items-center gap-2">
							<NumberInput
								label="Legend columns"
								labelClassName={LABEL_COL}
								value={merged.columns ?? 1}
								min={1}
								max={6}
								step={1}
								clamp
								onChange={(columns) => update({ columns })}
								inputClassName="w-16"
							/>
							{(merged.columns ?? 1) !== (DEFAULT_LEGEND_CONFIG.columns ?? 1) && (
								<ResetLink
									onClick={() =>
										update({ columns: DEFAULT_LEGEND_CONFIG.columns })
									}
								/>
							)}
						</div>
						{(merged.columns ?? 1) > 1 && (
							<div className="flex items-center gap-2">
								<NumberInput
									label="Column gap"
									labelClassName={LABEL_COL}
									value={merged.columnGap ?? DEFAULT_LEGEND_CONFIG.columnGap ?? 24}
									min={-48}
									max={96}
									step={2}
									clamp
									onChange={(columnGap) => update({ columnGap })}
									inputClassName="w-16"
									suffix="px"
								/>
								{(merged.columnGap ?? DEFAULT_LEGEND_CONFIG.columnGap) !==
									DEFAULT_LEGEND_CONFIG.columnGap && (
									<ResetLink
										onClick={() =>
											update({ columnGap: DEFAULT_LEGEND_CONFIG.columnGap })
										}
									/>
								)}
							</div>
						)}
					</div>
				</CollapsibleSubsection>
			)}

			{/* Box — the legend box's fill and border. Corner radius rounds the
			 *  border, so it (and the border color) only shows while Border is
			 *  on. */}
			{anyLegendVisible && (
				<CollapsibleSubsection title="Box" changed={groupChanged("box")}>
					<div className="flex flex-col gap-2">
						<RadioGroup
							legend="Background"
							value={bgKind}
							options={[
								{ value: "transparent", label: "Transparent" },
								{
									value: "themeDefault",
									label: "Theme default",
									trailing: theme.legendBackgroundColor ? (
										<span
											className="ml-1 inline-block h-6 w-10 rounded border border-stone-300 dark:border-stone-700"
											style={{ backgroundColor: theme.legendBackgroundColor }}
										/>
									) : null,
								},
								{
									value: "custom",
									label: "Custom",
									// Render the inline color picker on the custom row so
									// the swatch is visible whether or not "custom" is
									// currently selected.
									trailing: (
										<ColorInput
											label="Custom legend background color"
											labelClassName="sr-only"
											value={merged.backgroundColor ?? "#ffffff"}
											onChange={(backgroundColor) =>
												update({ backgroundColor })
											}
											disabled={bgKind !== "custom"}
											showHexInput={false}
										/>
									),
								},
							]}
							onChange={setBgKind}
						/>
					</div>

					<div className="vc-divider-group">
						<Checkbox
							label="Border"
							checked={merged.showBorder}
							onChange={(showBorder) => update({ showBorder })}
						/>
						{merged.showBorder && (
							<>
								<div className="flex items-center gap-2">
									<NumberInput
										label="Corner radius"
										labelClassName={LABEL_COL}
										value={merged.borderRadius}
										min={0}
										step={1}
										onChange={(borderRadius) => update({ borderRadius })}
										inputClassName="w-16"
										suffix="px"
									/>
									{merged.borderRadius !== themeLegend.borderRadius && (
										<ResetLink
											onClick={() =>
												update({ borderRadius: themeLegend.borderRadius })
											}
										/>
									)}
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<ColorInput
										label="Border color"
										labelClassName={LABEL_COL}
										value={merged.borderColor}
										onChange={(borderColor) => update({ borderColor })}
									/>
									{merged.borderColor !== themeLegend.borderColor && (
										<ResetLink
											onClick={() =>
												update({ borderColor: themeLegend.borderColor })
											}
										/>
									)}
								</div>
							</>
						)}
					</div>

				</CollapsibleSubsection>
			)}

			{/* Legend text — the labels beside each swatch. Separate from
			 *  "Legend titles" in the Labels panel (those style the section
			 *  headings) and from the theme's Legend text defaults, which this
			 *  overrides per visual. */}
			{anyLegendVisible && (
				<CollapsibleSubsection
						title="Legend text"
						changed={groupChanged("text")}
					>
					{/* Align leads, matching the Labels panel's title rows
					 *  (Align, then Family / Color / Size / Weight / Style). */}
					<div className="flex items-center gap-2 text-sm">
						<span className={LABEL_COL}>Align</span>
						<AlignmentControl
							value={merged.textAlign ?? "left"}
							onChange={setTextAlign}
						/>
						{merged.textAlign != null && (
							<ResetLink onClick={() => update({ textAlign: null })} />
						)}
					</div>
					{/* The gradient bar's break labels align on their own —
					 *  only while a bar-style gradient legend shows. */}
					{showGradientLegendStyle &&
						(merged.gradientLegendStyle ?? "bar") === "bar" && (
							<div className="flex flex-col gap-1">
								<div className="flex items-center gap-2 text-sm">
									<span className={LABEL_COL}>Align break labels</span>
									<AlignmentControl
										value={bar.labelAlign ?? breakLabelAlignAuto}
										onChange={(gradientBarLabelAlign) =>
											update({
												gradientBarLabelAlign: barValue(
													gradientBarLabelAlign,
													themeBar.labelAlign ?? breakLabelAlignAuto
												),
											})
										}
									/>
								</div>
							</div>
						)}
					<FontEditor
						value={merged.textFont ?? {}}
						onChange={setTextFont}
						showResetFields
						baseFamily={inheritedTextFont.family}
						baseColor={inheritedTextFont.color}
						baseSize={inheritedTextFont.size}
						baseWeight={inheritedTextFont.weight}
						baseItalic={inheritedTextFont.italic}
						baseUnderline={inheritedTextFont.underline}
					/>
					{/* The legend section TITLES live in Titles → Legend titles;
					 *  jump there rather than explain it in prose. */}
					<SidebarJumpLink
						label="Edit legend titles →"
						target={{ section: "Titles", subsection: "legend-titles" }}
					/>
				</CollapsibleSubsection>
			)}

			{(quantChannelGroups.length > 0 || measureFormatGroups.length > 0) &&
				dataset && (
				<CollapsibleSubsection
						title="Label format"
						changed={groupChanged("formatting")}
					>
					{measureFormatGroups.map(({ channel, values }) => {
						const channelCfg: LegendChannelConfig = {
							...DEFAULT_LEGEND_CHANNEL_CONFIG,
							...(merged.channels?.[channel] ?? {}),
						}
						return (
							<QuantLegendChannelControls
								key={`measure-${channel}`}
								sectionLabel={`${measureLabel} legend formatting`}
								values={values}
								fieldType="quantitative"
								cfg={channelCfg}
								onChange={(next) =>
									update({
										channels: { ...(merged.channels ?? {}), [channel]: next },
									})
								}
							/>
						)
					})}
					{quantChannelGroups.map(({ field, channels }) => {
						const t = effectiveType(dataset, field, overrides) as
							| "quantitative"
							| "temporal"
							| "ordinal"
						const values = dataset.rows.map((r) => r[field])
						const primary = channels[0]
						const channelCfg: LegendChannelConfig = {
							...DEFAULT_LEGEND_CHANNEL_CONFIG,
							...(merged.channels?.[primary] ?? {}),
						}
						const headerName =
							channels.length === 1
								? LEGEND_FRIENDLY_NAME[primary]
								: channels.map((c) => LEGEND_FRIENDLY_NAME[c]).join(" · ")
						return (
							<QuantLegendChannelControls
								key={field}
								sectionLabel={`${headerName} legend formatting`}
								values={values}
								fieldType={t}
								cfg={channelCfg}
								onChange={(next) => updateChannelGroup(channels, next)}
							/>
						)
					})}
				</CollapsibleSubsection>
			)}

			{showGradientLegendStyle && (
				<CollapsibleSubsection
						title="Gradient legend style"
						changed={groupChanged("gradient")}
					>
					<RadioGroup
						legend="Gradient legend style"
						value={merged.gradientLegendStyle ?? "bar"}
						options={[
							{ value: "bar", label: "Show gradient bar" },
							{ value: "swatches", label: "Show swatches" },
						]}
						onChange={(gradientLegendStyle) => update({ gradientLegendStyle })}
					/>
					{(merged.gradientLegendStyle ?? "bar") === "bar" && (
						<div className="flex flex-col gap-2">
							{/* Auto (null) is orientation-dependent (8rem minimum
							 *  vertical, full legend width horizontal) — not one fixed
							 *  px value — so this is a clear-to-null input (`onClear`).
							 *  The placeholder shows the RENDERED auto length (published
							 *  by GradientBarRamp) and the first spinner click / arrow
							 *  key steps from that displayed value instead of jumping
							 *  to 0 ([[auto-input-step-from-displayed]]). */}
							<div className="flex items-center gap-2">
								<NumberInput
									label="Bar length"
									labelClassName={LABEL_COL}
									min={0}
									step={1}
									value={merged.gradientBarLength ?? null}
									placeholder={
										themeBar.length != null
											? String(themeBar.length)
											: autoGradientBarLength != null
												? String(autoGradientBarLength)
												: "Auto"
									}
									stepBase={resolveGradientBarLengthStart()}
									onChange={(n) =>
										update({
											gradientBarLength: barValue(Math.max(0, n), themeBar.length),
										})
									}
									onClear={() => update({ gradientBarLength: null })}
									inputClassName="w-16"
									suffix="px"
								/>
								{merged.gradientBarLength != null && (
									<ResetLink onClick={() => update({ gradientBarLength: null })} />
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Bar thickness"
									labelClassName={LABEL_COL}
									value={bar.thickness}
									min={0}
									step={1}
									onChange={(n) =>
										update({
											gradientBarThickness: barValue(Math.max(0, n), themeBar.thickness),
										})
									}
									inputClassName="w-16"
									suffix="px"
								/>
								{merged.gradientBarThickness != null && (
									<ResetLink onClick={() => update({ gradientBarThickness: null })} />
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Corner radius"
									labelClassName={LABEL_COL}
									value={bar.radius}
									min={0}
									step={1}
									onChange={(n) =>
										update({ gradientBarRadius: barValue(n, themeBar.radius) })
									}
									inputClassName="w-16"
									suffix="px"
								/>
								{merged.gradientBarRadius != null && (
									<ResetLink onClick={() => update({ gradientBarRadius: null })} />
								)}
							</div>
							{/* Border thickness is the switch ([[legend-swatch-outline]]
							 *  convention): 0 (the default) draws no border and hides
							 *  the color picker, which is inert until there's a stroke
							 *  to color. */}
							<div className="vc-divider-group">
								<div className="flex items-center gap-2">
									<NumberInput
										label="Border thickness"
										labelClassName={LABEL_COL}
										value={bar.borderWidth}
										min={0}
										step={0.5}
										onChange={(n) =>
											update({
												gradientBarBorderWidth: barValue(
													Math.max(0, n),
													themeBar.borderWidth
												),
											})
										}
										inputClassName="w-16"
										suffix="px"
									/>
									{merged.gradientBarBorderWidth != null && (
										<ResetLink onClick={() => update({ gradientBarBorderWidth: null })} />
									)}
								</div>
								{bar.borderWidth > 0 && (
									<div className="flex flex-wrap items-center gap-2">
										<ColorInput
											label="Border color"
											labelClassName={LABEL_COL}
											value={bar.borderColor}
											onChange={(c) =>
												update({
													gradientBarBorderColor: barValue(c, themeBar.borderColor),
												})
											}
											showHexInput
										/>
										{merged.gradientBarBorderColor != null && (
											<ResetLink
												onClick={() => update({ gradientBarBorderColor: null })}
											/>
										)}
									</div>
								)}
							</div>
							<div className="vc-divider-group">
								<div className="flex items-center gap-2">
									<NumberInput
										label="Tick length"
										labelClassName={LABEL_COL}
										value={bar.tickLength}
										min={0}
										step={1}
										onChange={(n) =>
											update({ gradientBarTickLength: barValue(n, themeBar.tickLength) })
										}
										inputClassName="w-16"
										suffix="px"
									/>
									{merged.gradientBarTickLength != null && (
										<ResetLink onClick={() => update({ gradientBarTickLength: null })} />
									)}
								</div>
								{bar.tickLength > 0 && (
									<>
										<div className="flex items-center gap-2">
											<NumberInput
												label="Tick thickness"
												labelClassName={LABEL_COL}
												value={bar.tickThickness}
												min={0}
												step={0.5}
												onChange={(n) =>
													update({
														gradientBarTickThickness: barValue(n, themeBar.tickThickness),
													})
												}
												inputClassName="w-16"
												suffix="px"
											/>
											{merged.gradientBarTickThickness != null && (
												<ResetLink
													onClick={() => update({ gradientBarTickThickness: null })}
												/>
											)}
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<ColorInput
												label="Tick color"
												labelClassName={LABEL_COL}
												value={bar.tickColor}
												onChange={(c) =>
													update({
														gradientBarTickColor: barValue(c, themeBar.tickColor),
													})
												}
												showHexInput
											/>
											{merged.gradientBarTickColor != null && (
												<ResetLink onClick={() => update({ gradientBarTickColor: null })} />
											)}
										</div>
									</>
								)}
							</div>
						</div>
					)}
				</CollapsibleSubsection>
			)}

			{showAuxSwatchColor && (
				<CollapsibleSubsection
						title={`${auxSwatchHeader} swatch`}
						changed={groupChanged("auxSwatch")}
					>
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label="Swatch color"
							labelClassName={LABEL_COL}
							value={resolvedAuxSwatchColor}
							onChange={(auxLegendSwatchColor) =>
								update({ auxLegendSwatchColor })
							}
							showHexInput
						/>
						{merged.auxLegendSwatchColor !== null &&
							merged.auxLegendSwatchColor !== undefined && (
								<ResetLink onClick={() => update({ auxLegendSwatchColor: null })} />
							)}
					</div>
					{/* Size glyphs: shape (default: the marks' own) — Length /
					 *  Angle swatches are line segments, so only a Size legend
					 *  takes one — plus the outline color + width below. */}
					{showAuxSwatchStroke && (
						<div className="flex flex-col gap-1 text-sm">
							<span className="vc-muted">Swatch shape</span>
							<SwatchShapePicker
								value={merged.auxLegendSwatchShape ?? marksShape}
								defaultShape={marksShape}
								options="glyphs"
								onChange={(shape) =>
									update({
										auxLegendSwatchShape:
											shape === marksShape || typeof shape !== "number"
												? null
												: shape,
									})
								}
							/>
						</div>
					)}
					{showAuxSwatchStroke && (
						<div className="flex flex-wrap items-center gap-2">
							<ColorInput
								label="Outline color"
								labelClassName={LABEL_COL}
								value={resolvedAuxSwatchStroke}
								onChange={(auxLegendSwatchStroke) =>
									update({ auxLegendSwatchStroke })
								}
								showHexInput
							/>
							{merged.auxLegendSwatchStroke !== null &&
								merged.auxLegendSwatchStroke !== undefined && (
									<ResetLink onClick={() => update({ auxLegendSwatchStroke: null })} />
								)}
						</div>
					)}
					{showAuxSwatchStroke && (
						<div className="flex items-center gap-2">
							<NumberInput
								label="Outline width"
								labelClassName={LABEL_COL}
								value={merged.auxLegendSwatchStrokeWidth ?? 1}
								min={0}
								max={5}
								step={0.5}
								clamp
								onChange={(w) =>
									update({ auxLegendSwatchStrokeWidth: w === 1 ? null : w })
								}
								inputClassName="w-16"
								suffix="px"
							/>
							{merged.auxLegendSwatchStrokeWidth != null && (
								<ResetLink
									onClick={() => update({ auxLegendSwatchStrokeWidth: null })}
								/>
							)}
						</div>
					)}
				</CollapsibleSubsection>
			)}

			{swatchShapeSections.map((ch) => {
						// Group channels folded into this section (lead first). Drives
						// which color rows are live: pattern tiles
						// own the swatch background, so the aux Swatch-color row is
						// inert when pattern is a member (except in line context,
						// where the dash overlay strokes with the aux color), and
						// the pattern Background / Pattern-color rows surface on
						// whichever section pattern folded into (unless hue leads —
						// hue owns the tile background there).
						const members: readonly SwatchGroupChannel[] =
							ch === "rug" ? [] : swatchSectionMembers(ch)
						const patternInSection = members.includes("pattern")
						// Every channel the section's swatches depict → the rows
						// this subsection offers (see legendSwatchControls).
						const sectionField = ch === "rug" ? rugField : encodings[ch]?.field
						const swatchMembers: SwatchMember[] =
							ch === "rug" ? ["rug"] : sectionMembersOf(sectionField, ch)
						const controls = legendSwatchControls(swatchMembers, swatchCtx)
						const glyphSection = controls.shapeOptions === "glyphs"
						const outlineAuto = sectionOutlineWidthAuto(
							swatchMembers,
							isQuantField(sectionField),
							configs.shape?.outlineWidth
						)
						const outlineWidth = resolveSectionOutlineWidth(
							merged,
							theme,
							ch,
							outlineAuto
						)
						const shapeValue = resolveSectionSwatchShape(
							merged,
							theme,
							ch,
							swatchMembers,
							marksShape,
							swatchCtx
						)
						const auxColorRow =
							(ch === "opacity" ||
								ch === "saturation" ||
								ch === "brightness") &&
							(!patternInSection || !!encodings.connection?.field)
						// Nothing to choose (e.g. a Color · Length vector-field
						// legend: segments in the hue color) → no subsection.
						if (
							!controls.shape &&
							!controls.size &&
							!controls.outlineColor &&
							!controls.outlineWidth &&
							!auxColorRow &&
							controls.fill !== "pattern"
						)
							return null
						// Each swatch-drawing legend section gets its OWN collapsible
						// subsection, titled by the channels it represents — matching
						// the standalone "Shape swatch" / "Size swatch" subsections.
						const sectionName =
							ch === "rug"
								? LEGEND_FRIENDLY_NAME.rug
								: swatchMembers
										.map((c) => LEGEND_FRIENDLY_NAME[c as LegendChannel])
										.join(" · ")
						// The dot lights when ANY member channel's swatch settings
						// deviate — a combined "Brightness · Pattern" subsection also
						// hosts the pattern rows, so it tracks both channels.
						const sectionChanged =
							ch === "rug"
								? groupChanged("swatch:rug")
								: members.some((m) => groupChanged(`swatch:${m}`))
						return (
							<CollapsibleSubsection
								key={ch}
								title={`${sectionName} swatch`}
								changed={sectionChanged}
							>
							<div className="flex flex-col gap-1 text-sm">
								{controls.shape && (
									<>
										<span className="vc-muted">Swatch shape</span>
										{/* Glyph sections (Size / Angle folded in) draw the
										 *  marks' shape by default and take glyphs only — a
										 *  rectangle or line can't show a size or rotation. */}
										<SwatchShapePicker
											value={shapeValue}
											defaultShape={
												glyphSection ? marksShape : theme.legendSwatchShape
											}
											options={controls.shapeOptions}
											onChange={(shape) =>
												update(
													swatchShapePatch(
														merged,
														ch,
														shape,
														theme,
														glyphSection ? marksShape : undefined
													)
												)
											}
										/>
									</>
								)}
								{controls.size && (
								<div className="flex items-center gap-2">
									<NumberInput
										label="Swatch size"
										labelClassName={LABEL_COL}
										value={resolveLegendSwatchSize(merged, theme, ch)}
										min={3}
										max={20}
										step={1}
										clamp
										onChange={(size) => setSwatchSize(ch, size)}
										suffix="px"
									/>
									{resolveLegendSwatchSize(merged, theme, ch) !==
										theme.legendSwatchSize && (
										<ResetLink
											onClick={() => setSwatchSize(ch, theme.legendSwatchSize)}
										/>
									)}
								</div>
								)}
								{/* Swatch color: opacity / saturation / brightness swatches
								 *  paint with the shared aux color (no hue scale to inherit
								 *  from), so its picker lives right in their group — the
								 *  same `auxLegendSwatchColor` the Length / Angle / Size
								 *  subsection edits. Resets to the theme's default. Inert
								 *  (hidden) when pattern shares the section — the tiles
								 *  paint the pattern Background instead — unless the dash
								 *  overlay (line context) strokes with this color. */}
								{auxColorRow && (
									<div className="flex flex-wrap items-center gap-2">
										<ColorInput
											label="Swatch color"
											labelClassName={LABEL_COL}
											value={resolvedAuxSwatchColor}
											onChange={(auxLegendSwatchColor) =>
												update({ auxLegendSwatchColor })
											}
											showHexInput
										/>
										{merged.auxLegendSwatchColor != null && (
											<ResetLink
												onClick={() =>
													update({ auxLegendSwatchColor: null })
												}
											/>
										)}
									</div>
								)}
								{/* No-hue pattern tiles (pattern leads, or folded into a
								 *  sat / bri / opacity-led section): the tiles default to
								 *  the Pattern menu's Background (else gray) under a
								 *  near-black ink — offer both as legend-side overrides.
								 *  Per-category ink overrides from the Pattern menu still
								 *  win in the renderer, and both rows are moot when hue
								 *  shares the field (that section is hue-led — hue owns
								 *  the tile background). */}
								{controls.fill === "pattern" && patternFillRows}
								{/* Swatch outline: per-section color + width, per
								 *  legendSwatchControls — the color row hides only when an
								 *  Outline color channel is IN this section (its scale
								 *  strokes the glyphs); the width always applies, and
								 *  channels on other fields never switch either off.
								 *  Width 0 draws no outline; the width starts from the
								 *  section's auto width (sectionOutlineWidthAuto), else
								 *  the theme's. A theme without an outline color
								 *  seeds it from the marks' outline color (Color menu →
								 *  Outline) so the legend matches the chart when the
								 *  user turns the width up — except aux-painted
								 *  sections (opacity / saturation / brightness), whose
								 *  swatches aren't mark stand-ins: those seed from the
								 *  theme's legend-swatch outline, matching the
								 *  renderer. */}
								{controls.outlineColor && (
										<div className="flex flex-wrap items-center gap-2">
											<ColorInput
												label="Outline color"
												labelClassName={LABEL_COL}
												value={resolveLegendSwatchOutlineColor(
													merged,
													theme,
													ch,
													ch === "opacity" ||
														ch === "saturation" ||
														ch === "brightness"
														? resolvedAuxSwatchStroke
														: (configs.shape?.outlineColor ??
															theme.outlineColor ??
															"#cccccc")
												)}
												onChange={(color) =>
													setSwatchOutlineColor(ch, color)
												}
												showHexInput
											/>
											{legendSwatchOutlineColor(merged, ch) !== null && (
												<ResetLink onClick={() => resetSwatchOutlineColor(ch)} />
											)}
										</div>
								)}
								{controls.outlineWidth && (
										<div className="flex items-center gap-2">
											<NumberInput
												label="Outline width"
												labelClassName={LABEL_COL}
												value={outlineWidth}
												min={0}
												max={10}
												step={0.5}
												clamp
												onChange={(width) =>
													update(
														swatchOutlineWidthPatch(
															merged,
															ch,
															width,
															theme,
															outlineAuto
														)
													)
												}
												inputClassName="w-16"
												suffix="px"
											/>
											{outlineWidth !==
												(outlineAuto ?? theme.legendSwatchOutlineWidth) && (
												<ResetLink
													onClick={() =>
														update(
															swatchOutlineWidthPatch(
																merged,
																ch,
																outlineAuto ?? theme.legendSwatchOutlineWidth,
																theme,
																outlineAuto
															)
														)
													}
												/>
											)}
										</div>
								)}
							</div>
							</CollapsibleSubsection>
						)
					})}

			{showShapeSwatch && (
				<CollapsibleSubsection
						title={`${shapeSwatchHeader} swatch`}
						changed={
							groupChanged("shapeSwatch") || groupChanged("swatch:shape")
						}
					>
					<div className="flex flex-col gap-2">
					{/* Fill per legendSwatchControls: Color owns it; a Pattern
					 *  member tiles it (Background + Pattern color); else the
					 *  shape swatch color. Defaults shown are what the renderer
					 *  draws: the standalone Shape legend's neutral gray, or the
					 *  combined legend's aux / theme swatch color. */}
					{shapeControls.fill === "pattern" && patternFillRows}
					{shapeControls.fill === "color" && (
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label="Swatch color"
							labelClassName={LABEL_COL}
							value={
								merged.shapeLegendFillColor ??
								(!shapeSectionCombined
									? "#9ca3af"
									: shapeMembers.some((c) =>
												(
													[
														"opacity",
														"saturation",
														"brightness",
														"area",
														"length",
														"angle",
													] as SwatchMember[]
												).includes(c)
										  )
										? resolvedAuxSwatchColor
										: (theme.legendSwatchColor ??
											configs.defaultFill ??
											DEFAULT_FILL))
							}
							onChange={(shapeLegendFillColor) =>
								update({ shapeLegendFillColor })
							}
							showHexInput={false}
						/>
						{merged.shapeLegendFillColor !== null &&
							merged.shapeLegendFillColor !== undefined && (
								<ResetLink onClick={() => update({ shapeLegendFillColor: null })} />
							)}
					</div>
					)}
					{/* Outline color: hidden when an Outline color channel
					 *  shares the field (it strokes each glyph). Default shown is
					 *  what the renderer draws: the combined legend follows the
					 *  marks' outline (Shape menu), the standalone one a dark
					 *  contrast stroke. */}
					{shapeControls.outlineColor && (
					<div className="flex flex-wrap items-center gap-2">
						<ColorInput
							label="Outline color"
							labelClassName={LABEL_COL}
							value={
								merged.shapeLegendStrokeColor ??
								(shapeSectionCombined
									? (configs.shape?.outlineColor ?? DEFAULT_SWATCH_STROKE)
									: "#1f2937")
							}
							onChange={(shapeLegendStrokeColor) =>
								update({ shapeLegendStrokeColor })
							}
							showHexInput={false}
						/>
						{merged.shapeLegendStrokeColor !== null &&
							merged.shapeLegendStrokeColor !== undefined && (
								<ResetLink onClick={() => update({ shapeLegendStrokeColor: null })} />
							)}
					</div>
					)}
					<div className="flex items-center gap-2">
						<NumberInput
							label="Outline width"
							labelClassName={LABEL_COL}
							value={merged.shapeLegendStrokeWidth ?? 1}
							min={0}
							max={5}
							step={0.5}
							clamp
							onChange={(shapeLegendStrokeWidth) =>
								update({ shapeLegendStrokeWidth })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{merged.shapeLegendStrokeWidth != null && (
							<ResetLink onClick={() => update({ shapeLegendStrokeWidth: null })} />
						)}
					</div>
					{/* Glyph radius for shape swatches. Hidden when the Size (area)
					 *  channel merged into this section — the size scale then owns
					 *  each swatch's radius and this input would be inert. */}
					{shapeControls.size && (
						<div className="flex items-center gap-2">
							<NumberInput
								label="Swatch size"
								labelClassName={LABEL_COL}
								value={resolveLegendSwatchSize(merged, theme, "shape")}
								min={3}
								max={20}
								step={1}
								clamp
								onChange={(size) => setSwatchSize("shape", size)}
								suffix="px"
							/>
							{resolveLegendSwatchSize(merged, theme, "shape") !==
								theme.legendSwatchSize && (
								<ResetLink
									onClick={() => setSwatchSize("shape", theme.legendSwatchSize)}
								/>
							)}
						</div>
					)}
					</div>
				</CollapsibleSubsection>
			)}
		</div>
	)
}
