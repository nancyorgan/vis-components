import { useEffect, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useChartModeDef } from "../../store/useChartModeDef"
import {
	densityCurveGroupField,
	densityCurveOn,
} from "../../lib/colorSlots"
import { CHIP_INK } from "../../lib/previewInk"
import { effectiveType } from "../../lib/fieldType"
import { histogramMeasureDomain } from "../../lib/histogramBins"
import { resolveHistogramMeasure } from "../../lib/histogramMeasure"
import {
	DEFAULT_GRADIENT_BAR_RADIUS,
	DEFAULT_GRADIENT_BAR_TICK_COLOR,
	DEFAULT_LEGEND_CHANNEL_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	LEGEND_CHANNELS,
	LEGEND_FRIENDLY_NAME,
	QUANTITATIVE_LEGEND_CHANNELS,
	legendChannelHiddenByDefault,
	legendSwatchOutlineColor,
	legendSwatchOutlineWidth,
	legendSwatchShape,
	legendSwatchSize,
	resolveLegendHidden,
	type EncodingLegendChannel,
	type LegendChannel,
	type LegendChannelConfig,
	type LegendSwatchShape,
	type LegendConfig,
	type LegendOrientation,
	type LegendPosition,
	type QuantitativeLegendChannel,
	type SwatchShapeChannel,
} from "../../lib/labelsConfig"
import {
	formatBreaksInput,
	legendDataExtent,
	parseBreaksInput,
	resolveLegendBreaks,
} from "../../lib/legendBreaks"
import { DEFAULT_PATTERN_INK } from "../../lib/patterns"
import { SHAPE_PALETTE, symbolPath } from "../../lib/scales"
import {
	explainLegendCustomization,
	type LegendDotGroup,
} from "../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentLegendConfigAtom,
	currentRenderedGradientBarLengthAtom,
	currentThemeIdAtom,
	themeAtom,
	themesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

import { AlignmentControl } from "./LabelsPanel"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import {
	LABEL_COL,
	LABEL_COL_NESTED,
	LabelSpacerNested,
} from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { RadioGroup } from "../../../../components/ui/RadioGroup"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Toggle } from "../../../../components/ui/Toggle"

/** Fallbacks when neither the legend config nor the theme provides a swatch
 *  color — one definition so the aux and shape pickers can't drift. */
const DEFAULT_SWATCH_FILL = "#4f8eda"
const DEFAULT_SWATCH_STROKE = "#ffffff"

const POSITION_OPTIONS = [
	{ value: "right", label: "Right (outside)" },
	{ value: "left", label: "Left (outside)" },
	{ value: "top", label: "Top (outside)" },
	{ value: "bottom", label: "Bottom (outside)" },
	{ value: "inside", label: "Inside (custom coords)" },
] as const satisfies ReadonlyArray<{ value: LegendPosition; label: string }>

const ORIENTATION_OPTIONS = [
	{ value: "vertical", label: "Stacked" },
	{ value: "horizontal", label: "Horizontal" },
] as const satisfies ReadonlyArray<{
	value: LegendOrientation
	label: string
}>

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

	return (
		<div className="flex flex-col gap-2">
			<span className="text-xs text-stone-600 dark:text-stone-400">
				{sectionLabel}
				{dataHint && ` · ${dataHint}`}
			</span>
			{/* Rows subordinate to the section label indent by ml-6; the narrower
			 * LABEL_COL_NESTED keeps their controls on the shared 104px column
			 * (24px indent + 72px label + 8px gap). */}
			<div className="ml-6 flex flex-col gap-2">
				<label className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL_NESTED}>
						Label format
					</span>
					<select
						value=""
						onChange={(e) => {
							const v = e.target.value
							if (v === "__auto__") onChange({ ...cfg, format: "" })
							else if (v) onChange({ ...cfg, format: v })
						}}
						className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
					>
						<option value="">— Pick a preset —</option>
						<option value="__auto__">Auto (default)</option>
						<optgroup label="Numeric">
							<option value=",">Thousands separator (1,234)</option>
							<option value=",.0f">Whole numbers (1,234)</option>
							<option value=".2f">Two decimals (12.34)</option>
							<option value=".0%">Percent (12%)</option>
							<option value=".1%">Percent · 1 decimal (12.3%)</option>
							<option value=".2e">Scientific (1.23e+4)</option>
							<option value="$,.0f">Currency · whole ($1,234)</option>
							<option value="$,.2f">Currency · 2dp ($1,234.56)</option>
							<option value=".3s">SI prefix (1.23k)</option>
						</optgroup>
						<optgroup label="Temporal">
							<option value="%Y-%m-%d">ISO date (2026-05-20)</option>
							<option value="%b %Y">Month + year (May 2026)</option>
							<option value="%Y">Year (2026)</option>
						</optgroup>
					</select>
				</label>
				<div className="flex items-center gap-2">
					<LabelSpacerNested />
					<input
						type="text"
						value={cfg.format}
						onChange={(e) => onChange({ ...cfg, format: e.target.value })}
						placeholder="Auto"
						aria-label="Custom label format string"
						className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
					/>
				</div>
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
					<input
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
						className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
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
	const dataset = useCurrentDatasetView()
	// Prefer the LIVE theme from `themesAtom` so values edited in Settings
	// (e.g. legendSwatchColor) take effect immediately on the chart.
	// `themeAtom` is a legacy/fallback used when the chart's themeId is
	// missing from `themesAtom` (deleted theme, fresh chart, etc.).
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const liveTheme = allThemes.find((t) => t.id === currentThemeId)
	const theme = liveTheme ?? storedTheme
	const configs = useAtomValue(currentChannelConfigsAtom)
	const merged: LegendConfig = { ...DEFAULT_LEGEND_CONFIG, ...cfg }
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
	// [0, max] domain for the measure legend, matching the bars + Legend.tsx.
	const measureDomain =
		histMeasure && dataset
			? histogramMeasureDomain(
					dataset.rows.map((r) => r[histMeasure.categoryField]),
					configs[histMeasure.categoryChannel]?.histogram?.binCount ?? 10,
					histMeasure.mode,
					{
						min: configs[histMeasure.categoryChannel]?.min ?? null,
						max: configs[histMeasure.categoryChannel]?.max ?? null,
					},
					configs[histMeasure.categoryChannel]?.histogram?.labelMode ?? "range"
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

	// Rendered auto length of the gradient bar, published by the legend's
	// GradientBarRamp after each render. Placeholder + step start for the
	// "Bar length" input; 128 (the vertical bar's 8rem minimum) covers the
	// window before any bar has rendered.
	const autoGradientBarLength = useAtomValue(
		currentRenderedGradientBarLengthAtom,
	)
	const resolveGradientBarLengthStart = (): number =>
		merged.gradientBarLength ??
		(autoGradientBarLength && autoGradientBarLength > 0
			? autoGradientBarLength
			: 128)

	const modeDef = useChartModeDef()
	// EFFECTIVE per-channel visibility for every read below: the raw sparse
	// map plus the mode's default-hidden channels (e.g. Size starts off in
	// flow / hierarchy modes). Reads use `effHidden`; writes keep spreading
	// `merged.hidden` so mode defaults never get baked into the saved visual
	// (which would light the "changed" dot on a fresh chart).
	const effHidden = resolveLegendHidden(merged.hidden, modeDef.legend)

	const setHidden = (channel: LegendChannel, hidden: boolean) => {
		const nextHidden = { ...merged.hidden, [channel]: hidden }
		// Drop the key entirely when toggling back to the mode default
		// ("show", for all but the default-hidden channels) so the persisted
		// blob stays small.
		if (hidden === legendChannelHiddenByDefault(channel, modeDef.legend))
			delete nextHidden[channel]
		update({ hidden: nextHidden })
	}

	// Only surface toggles for channels that are actually mapped AND
	// meaningful in the current chart mode (e.g. length is hidden in bar
	// charts because it's the measure axis — surfacing the toggle would
	// imply the user could turn on a section that doesn't exist).
	const mappedLegendChannels = LEGEND_CHANNELS.filter((ch) => {
		// A measure source (Count/Density) counts as "mapped" for hue / opacity
		// even though it has no field.
		const measureMapped =
			(ch === "hue" && hueMeasureActive) ||
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
		!!densityCurveGroupField(configs) && densityCurveOn(configs)

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
		rugLegendMapped && !effHidden.rug && rendersSwatches(rugType)
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
	// A quantitative color section falls back to discrete swatches — even in
	// "bar" gradient style — when another group channel shares its field (a
	// composed per-stop visual can't render as a continuous gradient strip).
	const quantForcedToSwatches = (field: string | null): boolean =>
		!!field &&
		combineLegendSections &&
		(["saturation", "brightness", "pattern", "opacity"] as const).some(
			(c) => swatchChannelActive(c) && encodings[c]?.field === field
		)
	const hueRendersSwatches =
		mappedLegendChannels.includes("hue") &&
		!effHidden.hue &&
		(rendersSwatches(hueType) ||
			((hueType === "quantitative" || hueType === "temporal") &&
				quantForcedToSwatches(hueField)))
	const outlineHueRendersSwatches =
		mappedLegendChannels.includes("outlineHue") &&
		!effHidden.outlineHue &&
		(rendersSwatches(outlineHueType) ||
			((outlineHueType === "quantitative" || outlineHueType === "temporal") &&
				quantForcedToSwatches(outlineHueField)))
	const swatchShapeSections: SwatchShapeChannel[] = [
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
	const setSwatchShape = (ch: SwatchShapeChannel, shape: LegendSwatchShape) =>
		update({ swatchShapes: { ...merged.swatchShapes, [ch]: shape } })
	const setSwatchSize = (ch: SwatchShapeChannel, size: number) =>
		update({ swatchSizes: { ...merged.swatchSizes, [ch]: size } })
	const setSwatchOutlineColor = (ch: SwatchShapeChannel, color: string) =>
		update({
			swatchOutlineColors: { ...merged.swatchOutlineColors, [ch]: color },
		})
	const resetSwatchOutlineColor = (ch: SwatchShapeChannel) => {
		// Back to auto (pipe in the marks' outline color). An explicit null
		// entry is needed to override a legacy GLOBAL color; otherwise keep
		// the stored map sparse.
		const next = { ...merged.swatchOutlineColors }
		if (merged.swatchOutlineColor != null) next[ch] = null
		else delete next[ch]
		update({ swatchOutlineColors: next })
	}
	const setSwatchOutlineWidth = (ch: SwatchShapeChannel, width: number) => {
		// Keep the stored config sparse: 0 IS the default (no outline), so
		// drop the entry — unless a legacy GLOBAL width would shine through,
		// which an explicit 0 must override.
		const next = { ...merged.swatchOutlineWidths }
		if (width === 0 && (merged.swatchOutlineWidth ?? 0) === 0) delete next[ch]
		else next[ch] = width
		update({ swatchOutlineWidths: next })
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
	const shapeGroupedWithAux = auxSharingShapeField.length > 0
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
	// Header for the shape swatch subsection: when a same-field aux channel
	// (e.g. Size) merged in, name both — "Size · Shape" — so it's clear this
	// one control drives the combined legend's swatch.
	const shapeSwatchHeader = shapeGroupedWithAux
		? [
				...auxSharingShapeField.map((ch) => LEGEND_FRIENDLY_NAME[ch]),
				LEGEND_FRIENDLY_NAME.shape,
			].join(" · ")
		: LEGEND_FRIENDLY_NAME.shape
	// The combine toggle only makes sense when ≥2 legend channels actually
	// share a field; otherwise there's nothing to combine.
	const sharedVariableExists = (() => {
		const byField = new Map<string, number>()
		for (const ch of mappedLegendChannels) {
			if (effHidden[ch as LegendChannel]) continue
			const f = encodings[ch]?.field
			if (!f) continue
			byField.set(f, (byField.get(f) ?? 0) + 1)
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
						<Toggle
							key={ch}
							label={LEGEND_FRIENDLY_NAME[ch]}
							checked={!effHidden[ch]}
							onChange={(show) => setHidden(ch, !show)}
						/>
					))}
					{rugLegendMapped && (
						<Toggle
							key="rug"
							label={LEGEND_FRIENDLY_NAME.rug}
							checked={!effHidden.rug}
							onChange={(show) => setHidden("rug", !show)}
						/>
					)}
					{densityCurveLegendMapped && (
						<Toggle
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
						<div className="flex flex-col gap-1 border-t border-stone-200 pt-2 dark:border-stone-700">
							<Toggle
								label="Combine legends with same variables"
								checked={combineLegendSections}
								onChange={(combineSameVariable) =>
									update({ combineSameVariable })
								}
							/>
							<p className="vc-help">
								When more than one encoding maps to the same field, show one
								merged legend (a combined swatch and title) instead of a
								separate legend for each.
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
							options={POSITION_OPTIONS}
							onChange={(position) => update({ position })}
							selectClassName="flex-1"
						/>
						{merged.position === "inside" && (
							<>
								<NumberInput
									label="X"
									labelClassName={LABEL_COL}
									value={merged.insideX}
									onChange={(insideX) => update({ insideX })}
									step={0.02}
									inputClassName="w-16"
								/>
								<NumberInput
									label="Y"
									labelClassName={LABEL_COL}
									value={merged.insideY}
									onChange={(insideY) => update({ insideY })}
									step={0.02}
									inputClassName="w-16"
								/>
							</>
						)}
					</div>

					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
						<RadioGroup
							legend="Orientation"
							value={merged.orientation}
							options={ORIENTATION_OPTIONS}
							onChange={(orientation) => update({ orientation })}
						/>
					</div>

					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
						<Toggle
							label="Border box"
							checked={merged.showBorder}
							onChange={(showBorder) => update({ showBorder })}
						/>
						{merged.showBorder && (
							<>
								<div className="flex items-center gap-2">
									<ColorInput
										label="Color"
										labelClassName={LABEL_COL}
										value={merged.borderColor}
										onChange={(borderColor) => update({ borderColor })}
									/>
									{merged.borderColor !== DEFAULT_LEGEND_CONFIG.borderColor && (
										<button
											type="button"
											onClick={() =>
												update({ borderColor: DEFAULT_LEGEND_CONFIG.borderColor })
											}
											className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
										>
											reset
										</button>
									)}
								</div>
								<div className="flex items-center gap-2">
									<NumberInput
										label="Radius"
										labelClassName={LABEL_COL}
										value={merged.borderRadius}
										min={0}
										step={1}
										onChange={(borderRadius) => update({ borderRadius })}
										inputClassName="w-16"
										suffix="px"
									/>
									{merged.borderRadius !== DEFAULT_LEGEND_CONFIG.borderRadius && (
										<button
											type="button"
											onClick={() =>
												update({
													borderRadius: DEFAULT_LEGEND_CONFIG.borderRadius,
												})
											}
											className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
										>
											reset
										</button>
									)}
								</div>
							</>
						)}
					</div>

					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
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

					<div className="flex flex-col gap-2 border-t border-stone-200 pt-2 dark:border-stone-700">
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
								<button
									type="button"
									onClick={() =>
										update({ columns: DEFAULT_LEGEND_CONFIG.columns })
									}
									className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
								>
									reset
								</button>
							)}
						</div>
						<p className="vc-help">
							Splits several legends into their own columns, or wraps a
							single legend&apos;s entries across columns.
						</p>
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
									<button
										type="button"
										onClick={() =>
											update({ columnGap: DEFAULT_LEGEND_CONFIG.columnGap })
										}
										className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
									>
										reset
									</button>
								)}
							</div>
						)}
					</div>
				</CollapsibleSubsection>
			)}

			{(quantChannelGroups.length > 0 || measureFormatGroups.length > 0) &&
				dataset && (
				<CollapsibleSubsection
						title="Label formatting"
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
					{showGradientLegendStyle &&
						(merged.gradientLegendStyle ?? "bar") === "bar" && (
							<div className="flex flex-col gap-1">
								<div className="flex items-center gap-2">
									<span className={`${LABEL_COL} text-sm`}>Label alignment</span>
									<AlignmentControl
										value={
											merged.gradientBarLabelAlign ??
											(merged.orientation === "horizontal" ? "center" : "left")
										}
										onChange={(gradientBarLabelAlign) =>
											update({ gradientBarLabelAlign })
										}
									/>
								</div>
								<p className="vc-help">
									How the gradient bar&apos;s break labels align — against
									each stop under a horizontal bar, within the label column
									beside a stacked one.
								</p>
							</div>
						)}
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
							 *  px value — so this is a clear-to-null raw input
							 *  (NumberInput can't emit null). The placeholder shows the
							 *  RENDERED auto length (published by GradientBarRamp) and
							 *  the first interaction — focus, spinner click, or arrow
							 *  key — steps from that displayed value instead of jumping
							 *  to 0 ([[auto-input-step-from-displayed]]). */}
							<div className="flex items-center gap-2">
								<label className="flex items-center gap-2 text-sm">
									<span className={LABEL_COL}>Bar length</span>
									<input
										type="number"
										min={0}
										step={1}
										value={merged.gradientBarLength ?? ""}
										placeholder={
											autoGradientBarLength != null
												? String(autoGradientBarLength)
												: "auto"
										}
										onChange={(e) =>
											update({
												gradientBarLength:
													e.target.value === ""
														? null
														: Math.max(0, Number(e.target.value)),
											})
										}
										// Native spinner buttons fire no keydown — from a
										// blank input they'd jump to min (0). Seed the auto
										// value on focus so every interaction steps from
										// the visible number; clearing reverts to auto.
										onFocus={() => {
											if (merged.gradientBarLength != null) return
											update({
												gradientBarLength: resolveGradientBarLengthStart(),
											})
										}}
										// Belt-and-suspenders for the first arrow press
										// racing the focus-fill.
										onKeyDown={(e) => {
											if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
												return
											e.preventDefault()
											const step = e.key === "ArrowUp" ? 1 : -1
											update({
												gradientBarLength: Math.max(
													0,
													resolveGradientBarLengthStart() + step,
												),
											})
										}}
										className="w-16 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500"
									/>
									<span className="text-sm text-stone-600">px</span>
								</label>
								{merged.gradientBarLength != null && (
									<button
										type="button"
										onClick={() => update({ gradientBarLength: null })}
										className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
									>
										reset
									</button>
								)}
							</div>
							<div className="flex items-center gap-2">
								<NumberInput
									label="Corner radius"
									labelClassName={LABEL_COL}
									value={merged.gradientBarRadius ?? DEFAULT_GRADIENT_BAR_RADIUS}
									min={0}
									step={1}
									onChange={(gradientBarRadius) => update({ gradientBarRadius })}
									inputClassName="w-16"
									suffix="px"
								/>
								{merged.gradientBarRadius != null &&
									merged.gradientBarRadius !== DEFAULT_GRADIENT_BAR_RADIUS && (
										<button
											type="button"
											onClick={() => update({ gradientBarRadius: null })}
											className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
										>
											reset
										</button>
									)}
							</div>
							<NumberInput
								label="Tick length"
								labelClassName={LABEL_COL}
								value={merged.gradientBarTickLength ?? 0}
								min={0}
								step={1}
								onChange={(gradientBarTickLength) =>
									update({ gradientBarTickLength })
								}
								inputClassName="w-16"
								suffix="px"
							/>
							{(merged.gradientBarTickLength ?? 0) > 0 && (
								<>
									<NumberInput
										label="Tick thickness"
										labelClassName={LABEL_COL}
										value={merged.gradientBarTickThickness ?? 1}
										min={0}
										step={0.5}
										onChange={(gradientBarTickThickness) =>
											update({ gradientBarTickThickness })
										}
										inputClassName="w-16"
										suffix="px"
									/>
									<div className="flex items-center gap-2">
										<ColorInput
											label="Tick color"
											labelClassName={LABEL_COL}
											value={
												merged.gradientBarTickColor ??
												DEFAULT_GRADIENT_BAR_TICK_COLOR
											}
											onChange={(gradientBarTickColor) =>
												update({ gradientBarTickColor })
											}
											showHexInput
										/>
										{merged.gradientBarTickColor != null && (
											<button
												type="button"
												onClick={() => update({ gradientBarTickColor: null })}
												className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
											>
												reset
											</button>
										)}
									</div>
								</>
							)}
							<p className="vc-help">
								Bar length is the gradient&apos;s height when the legend is
								stacked, its width when horizontal — clear for the automatic
								size. Tick length above 0 draws a mark at each break stop,
								between the bar and its labels.
							</p>
						</div>
					)}
				</CollapsibleSubsection>
			)}

			{showAuxSwatchColor && (
				<CollapsibleSubsection
						title={`${auxSwatchHeader} swatch`}
						changed={groupChanged("auxSwatch")}
					>
					<div className="flex items-center gap-2">
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
								<button
									type="button"
									onClick={() => update({ auxLegendSwatchColor: null })}
									className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
								>
									reset
								</button>
							)}
					</div>
					{showAuxSwatchStroke && (
						<div className="flex items-center gap-2">
							<ColorInput
								label="Swatch border"
								labelClassName={LABEL_COL}
								value={resolvedAuxSwatchStroke}
								onChange={(auxLegendSwatchStroke) =>
									update({ auxLegendSwatchStroke })
								}
								showHexInput
							/>
							{merged.auxLegendSwatchStroke !== null &&
								merged.auxLegendSwatchStroke !== undefined && (
									<button
										type="button"
										onClick={() => update({ auxLegendSwatchStroke: null })}
										className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
									>
										reset
									</button>
								)}
						</div>
					)}
					<p className="vc-help">
						Color used for these legend swatches when they render alongside
						the gradient (no hue color to inherit). Resets to the theme&apos;s
						default.
					</p>
				</CollapsibleSubsection>
			)}

			{swatchShapeSections.length > 0 && (
				<CollapsibleSubsection
						title="Swatches"
						changed={groupChanged("swatchShape")}
					>
					{swatchShapeSections.map((ch) => {
						const current = legendSwatchShape(merged, ch)
						// null = rectangle, "line" = line segment, then palette shapes.
						const options: LegendSwatchShape[] = [
							null,
							"line",
							...SHAPE_PALETTE.map((_, i) => i),
						]
						return (
							<div key={ch} className="flex flex-col gap-1 text-sm">
								{swatchShapeSections.length > 1 && (
									<span className="vc-group-header">
										{LEGEND_FRIENDLY_NAME[ch]}
									</span>
								)}
								<span className="text-stone-600 dark:text-stone-400">
									Swatch shape
								</span>
								<div className="flex flex-wrap gap-1">
									{options.map((opt) => {
										const selected = current === opt
										const shapeName =
											opt === null
												? "Rectangle (default)"
												: opt === "line"
													? "Line segment"
													: `Shape ${opt + 1}`
										return (
											<button
												key={opt === null ? "rect" : String(opt)}
												type="button"
												onClick={() => setSwatchShape(ch, opt)}
												aria-pressed={selected}
												aria-label={shapeName}
												title={
													opt === null || opt === "line"
														? shapeName
														: undefined
												}
												className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
													selected
														? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
														: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
												}`}
											>
												<SwatchShapeGlyph idx={opt} selected={selected} />
											</button>
										)
									})}
								</div>
								<NumberInput
									label="Swatch size"
									labelClassName={LABEL_COL}
									value={legendSwatchSize(merged, ch) ?? 5}
									min={3}
									max={20}
									step={1}
									clamp
									onChange={(size) => setSwatchSize(ch, size)}
									suffix="px"
								/>
								{/* Swatch color: opacity / saturation / brightness swatches
								 *  paint with the shared aux color (no hue scale to inherit
								 *  from), so its picker lives right in their group — the
								 *  same `auxLegendSwatchColor` the Length / Angle / Size
								 *  subsection edits. Resets to the theme's default. */}
								{(ch === "opacity" ||
									ch === "saturation" ||
									ch === "brightness") && (
									<div className="flex items-center gap-2">
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
											<button
												type="button"
												onClick={() =>
													update({ auxLegendSwatchColor: null })
												}
												className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
											>
												reset
											</button>
										)}
									</div>
								)}
								{/* Standalone pattern section (not sharing a hue color):
								 *  the swatch tiles default to the Pattern menu's Background
								 *  (else gray) under a near-black ink — offer both as
								 *  legend-side overrides. Per-category ink overrides from
								 *  the Pattern menu still win in the renderer, and both
								 *  rows are moot when hue shares the field (that section
								 *  is hue-led, so this group doesn't render for it). */}
								{ch === "pattern" && (
									<>
										<div className="flex items-center gap-2">
											<ColorInput
												label="Background"
												labelClassName={LABEL_COL}
												value={
													merged.patternLegendBgColor ??
													configs.pattern?.backgroundColor ??
													"#e2e8f0"
												}
												onChange={(patternLegendBgColor) =>
													update({ patternLegendBgColor })
												}
												showHexInput
											/>
											{merged.patternLegendBgColor != null && (
												<button
													type="button"
													onClick={() =>
														update({ patternLegendBgColor: null })
													}
													className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
												>
													reset
												</button>
											)}
										</div>
										<div className="flex items-center gap-2">
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
												<button
													type="button"
													onClick={() =>
														update({ patternLegendInkColor: null })
													}
													className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
												>
													reset
												</button>
											)}
										</div>
									</>
								)}
								{/* Swatch outline: per-section color + width. Hidden
								 *  while the outline-color channel is encoded — mapped
								 *  outline colors own the swatch strokes and this
								 *  setting is inert (the renderer ignores it too).
								 *  Width 0 (the default) draws no outline. The color
								 *  seeds from the marks' outline color (Color menu →
								 *  Outline) so the legend matches the chart when the
								 *  user turns the width up — except aux-painted
								 *  sections (opacity / saturation / brightness), whose
								 *  swatches aren't mark stand-ins: those seed from the
								 *  theme's legend-swatch outline, matching the
								 *  renderer. */}
								{!outlineHueField && (
									<>
										<div className="flex items-center gap-2">
											<ColorInput
												label="Outline color"
												labelClassName={LABEL_COL}
												value={
													legendSwatchOutlineColor(merged, ch) ??
													(ch === "opacity" ||
													ch === "saturation" ||
													ch === "brightness"
														? resolvedAuxSwatchStroke
														: (configs.shape?.outlineColor ??
															theme.outlineColor ??
															"#cccccc"))
												}
												onChange={(color) =>
													setSwatchOutlineColor(ch, color)
												}
												showHexInput
											/>
											{legendSwatchOutlineColor(merged, ch) !== null && (
												<button
													type="button"
													onClick={() => resetSwatchOutlineColor(ch)}
													className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
												>
													reset
												</button>
											)}
										</div>
										<NumberInput
											label="Outline width"
											labelClassName={LABEL_COL}
											value={legendSwatchOutlineWidth(merged, ch) ?? 0}
											min={0}
											max={10}
											step={0.5}
											clamp
											onChange={(width) => setSwatchOutlineWidth(ch, width)}
											inputClassName="w-16"
											suffix="px"
										/>
									</>
								)}
							</div>
						)
					})}
				</CollapsibleSubsection>
			)}

			{showShapeSwatch && (
				<CollapsibleSubsection
						title={`${shapeSwatchHeader} swatch`}
						changed={groupChanged("shapeSwatch")}
					>
					<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<ColorInput
							label="Fill"
							labelClassName={LABEL_COL}
							value={
								merged.shapeLegendFillColor ??
								theme.legendSwatchColor ??
								DEFAULT_SWATCH_FILL
							}
							onChange={(shapeLegendFillColor) =>
								update({ shapeLegendFillColor })
							}
							showHexInput={false}
						/>
						{merged.shapeLegendFillColor !== null &&
							merged.shapeLegendFillColor !== undefined && (
								<button
									type="button"
									onClick={() => update({ shapeLegendFillColor: null })}
									className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
								>
									reset
								</button>
							)}
					</div>
					<div className="flex items-center gap-2">
						<ColorInput
							label="Stroke"
							labelClassName={LABEL_COL}
							value={
								merged.shapeLegendStrokeColor ??
								theme.outlineColor ??
								DEFAULT_SWATCH_STROKE
							}
							onChange={(shapeLegendStrokeColor) =>
								update({ shapeLegendStrokeColor })
							}
							showHexInput={false}
						/>
						{merged.shapeLegendStrokeColor !== null &&
							merged.shapeLegendStrokeColor !== undefined && (
								<button
									type="button"
									onClick={() => update({ shapeLegendStrokeColor: null })}
									className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
								>
									reset
								</button>
							)}
					</div>
					<p className="vc-help">
						Default fill / stroke for shape swatches in the legend. Per-shape
						overrides set in the Shape panel (including
						<code> none</code> for outline-only) win when present.
					</p>
					</div>
				</CollapsibleSubsection>
			)}
		</div>
	)
}

const PREVIEW_SIZE = 20

/** Preview glyph for the swatch shape picker. `null` renders the default
 *  rounded rectangle, `"line"` a short line segment, otherwise the matching
 *  `SHAPE_PALETTE` symbol. */
const SwatchShapeGlyph = ({
	idx,
	selected,
}: {
	idx: LegendSwatchShape
	selected: boolean
}) => {
	const fill = selected ? "currentColor" : CHIP_INK
	if (idx === null) {
		return (
			<svg
				width={PREVIEW_SIZE}
				height={PREVIEW_SIZE}
				viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
				aria-hidden="true"
			>
				<rect
					x={4}
					y={6}
					width={12}
					height={8}
					rx={1.5}
					fill={fill}
					fillOpacity={0.9}
				/>
			</svg>
		)
	}
	if (idx === "line") {
		return (
			<svg
				width={PREVIEW_SIZE}
				height={PREVIEW_SIZE}
				viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
				aria-hidden="true"
			>
				<line
					x1={3}
					y1={PREVIEW_SIZE / 2}
					x2={PREVIEW_SIZE - 3}
					y2={PREVIEW_SIZE / 2}
					stroke={fill}
					strokeOpacity={0.9}
					strokeWidth={2.5}
					strokeLinecap="round"
				/>
			</svg>
		)
	}
	return (
		<svg
			width={PREVIEW_SIZE}
			height={PREVIEW_SIZE}
			viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
			aria-hidden="true"
		>
			<path d={symbolPath(idx, 5)} fill={fill} fillOpacity={0.9} />
		</svg>
	)
}
