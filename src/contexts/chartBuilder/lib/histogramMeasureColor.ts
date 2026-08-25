import { DEFAULT_FACET_CONFIG, type ChannelConfigs } from "./channelConfig"
import { effectiveType } from "./fieldType"
import { histogramMeasureDomainFaceted } from "./histogramBins"
import { resolveHistogramMeasure } from "./histogramMeasure"
import { resolveFacetPanels, type FacetPanels } from "./resolveFacetPanels"
import type { DatasetView, Encodings, FieldType } from "./types"

/** The ONE domain the histogram measure-color encodings (Fill color / Fill
 *  opacity varying by Count / Density) use everywhere: per-panel bar fills,
 *  the legend's gradient ramp, and the Legend sidebar's break/format editor.
 *
 *  Color scales in this app are GLOBAL (aesthetic scales are built once over
 *  the whole dataset, independent of facet axis-share modes), and a single
 *  legend ramp can only depict a single domain — so the measure-color domain
 *  is `[0, max]` where `max` is the largest PER-PANEL bin measure across all
 *  rendered facet panels (`histogramMeasureDomainFaceted`): the tallest bar
 *  actually drawn anywhere hits the ramp's high end, and identical counts get
 *  identical colors in every panel. Non-faceted charts reduce to the plain
 *  full-dataset domain.
 *
 *  Returns `null` when the chart isn't an active histogram (or nothing bins).
 *  Pass `panels` when the caller already resolved the facet partition
 *  (PlotCanvas) to skip re-resolving it; the legend-side callers let it
 *  default. */
export const histogramMeasureColorDomain = (
	dataset: DatasetView,
	encodings: Encodings,
	channelConfigs: ChannelConfigs,
	overrides: Record<string, FieldType>,
	levelOrders: Record<string, readonly string[]>,
	panels?: FacetPanels
): { min: number; max: number } | null => {
	const getType = (name: string) => effectiveType(dataset, name, overrides)
	const hm = resolveHistogramMeasure(encodings, getType, channelConfigs)
	if (!hm) return null
	const panelData =
		panels ??
		resolveFacetPanels(dataset, encodings, levelOrders, overrides, {
			...DEFAULT_FACET_CONFIG,
			...channelConfigs.facet,
		})
	const panelValues = panelData.values.map((key) =>
		(panelData.rowsByValue.get(key) ?? []).map(
			(r) => r[hm.categoryField]
		)
	)
	const axisCfg = channelConfigs[hm.categoryChannel]
	return histogramMeasureDomainFaceted(
		panelValues,
		axisCfg?.histogram?.binCount ?? 10,
		hm.mode,
		{ min: axisCfg?.min ?? null, max: axisCfg?.max ?? null },
		axisCfg?.histogram?.labelMode ?? "range"
	)
}
