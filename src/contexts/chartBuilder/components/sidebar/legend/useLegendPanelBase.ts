import { useEffect } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { densityCurveGroupField, densityCurveOn } from "../../../lib/colorSlots"
import { effectiveType } from "../../../lib/fieldType"
import { resolveHistogramMeasure } from "../../../lib/histogramMeasure"
import { histogramMeasureColorDomain } from "../../../lib/histogramMeasureColor"
import {
	DEFAULT_LEGEND_CONFIG,
	LEGEND_CHANNELS,
	QUANTITATIVE_LEGEND_CHANNELS,
	resolveLegendHidden,
	resolveGradientBarStyle,
	type LegendChannel,
	type LegendChannelConfig,
	type LegendConfig,
	type QuantitativeLegendChannel,
} from "../../../lib/labelsConfig"
import { legendHiddenPatch } from "../../../lib/legendEdits"
import { planLegendSections } from "../../../lib/legendSections"
import { isHierarchyModeId, packedSourceOf } from "../../../lib/packedMeasure"
import { explainLegendCustomization, legendConfigFromTheme, type LegendDotGroup } from "../../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	legendSizeProbeWantedAtom,
} from "../../../store/atoms"
import { renderChannelConfigsAtom } from "../../../store/renderConfigs"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../../store/useCurrentTheme"

/** What every Legend subsection reads: the legend config merged over its
 *  defaults, the theme baselines the reset links return to, and which legend
 *  channels are mapped, visible and quantitative in the current chart. */
export const useLegendPanelBase = () => {
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
	const barValue = <T>(next: T, themeValue: T): T | null =>
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
	const setProbeWanted = useSetAtom(legendSizeProbeWantedAtom)
	useEffect(() => {
		setProbeWanted(true)
		return () => setProbeWanted(false)
	}, [setProbeWanted])
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

	return {
		merged,
		update,
		theme,
		themeLegend,
		themeBar,
		bar,
		barValue,
		groupChanged,
		encodings,
		overrides,
		levelOrders,
		dataset,
		configs,
		renderConfigs,
		labels,
		modeDef,
		effHidden,
		setHidden,
		mappedLegendChannels,
		rugLegendMapped,
		densityCurveLegendMapped,
		coalescedSlots,
		anyLegendVisible,
		quantChannelGroups,
		updateChannelGroup,
		measureFormatGroups,
		measureLabel,
		hueMeasureActive,
		opacityMeasureActive,
		hueDerivedActive,
		hueField,
		hueType,
	}
}

export type LegendPanelBase = ReturnType<typeof useLegendPanelBase>
