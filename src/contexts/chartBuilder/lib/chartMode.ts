import type { ChannelConfigs } from "./channelConfig"
import { MODE_REGISTRY } from "./chartModes"
import { ScatterMode } from "./chartModes/scatter"
import type { FieldTypeLookup } from "./chartModes/types"
import type { MapConfig } from "./mapConfig"
import type { Encodings } from "./types"

export type ChartMode =
	| "scatter"
	| "bars-x"
	| "bars-y"
	| "pies"
	| "pies-x"
	| "pies-y"
	| "areas-x"
	| "areas-y"
	| "radar"
	| "tile"
	| "geo-points"
	| "geo-symbols"
	| "geo-choropleth"
	| "packed-circles"
	| "treemap"
	| "sunburst"
	| "chord"
	| "sankey"
	| "hexbin"

/** Resolve the chart mode for a given encoding set by walking the mode
 * registry in order. Falls back to scatter (which always matches).
 *
 * Bar mode activates when `length` is mapped AND exactly one of {x, y} is
 * mapped. Pie mode is the angular analogue: `angle` mapped AND exactly one
 * of {x, y} mapped, with no length. Length takes precedence when both are
 * set — combining length + angle is a scatter concept (vector fields).
 *
 * `getType` is optional — modes that need type info (currently just Tile,
 * which checks that both axes are categorical/ordinal) won't activate
 * without it. Callers without dataset access can omit it and they'll
 * just never see those types selected, which is the safer default.
 *
 * `mapConfig` is likewise optional — geographic modes consult it (e.g.
 * `coordSystem`) to activate; cartesian modes ignore it.
 */
export const getChartMode = (
	encodings: Encodings,
	getType?: FieldTypeLookup,
	channelConfigs?: ChannelConfigs,
	mapConfig?: MapConfig
): ChartMode => {
	for (const mode of MODE_REGISTRY) {
		if (mode.detect(encodings, getType, channelConfigs, mapConfig))
			return mode.id as ChartMode
	}
	return "scatter"
}

/** Return the full ChartModeDef, not just the id. Useful for callers that
 * need the mode's Renderer, legend config, or facet capabilities. */
export const getChartModeDef = (
	encodings: Encodings,
	getType?: FieldTypeLookup,
	channelConfigs?: ChannelConfigs,
	mapConfig?: MapConfig
): (typeof MODE_REGISTRY)[number] => {
	for (const mode of MODE_REGISTRY) {
		if (mode.detect(encodings, getType, channelConfigs, mapConfig)) return mode
	}
	// MODE_REGISTRY always ends with ScatterMode (detect=true), so this is
	// unreachable — returning ScatterMode explicitly preserves narrowing.
	return ScatterMode
}
