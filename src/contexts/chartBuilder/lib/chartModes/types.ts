import type { ChannelConfigs } from "../channelConfig"
import type { MapConfig } from "../mapConfig"
import type { Encodings, FieldType } from "../types"

/** Optional type lookup passed to `detect` so modes that depend on field
 * type (e.g. Tile mode requiring categorical x AND y) can decide
 * accurately. Callers without a dataset in hand can omit it; modes that
 * need it should fall back to a safe default when absent. */
export type FieldTypeLookup = (fieldName: string) => FieldType | undefined

export type ChartModeLegendConfig = {
	/** When true, Legend hides any legend section for the length encoding
	 * even when length is mapped. Used by bar modes — length is redundant
	 * with the measure axis. */
	hideLengthInThisMode: boolean
	/** Mirror for pies: angle is redundant with the measure axis. */
	hideAngleInThisMode: boolean
	/** When true, Legend hides any legend section for the connection encoding
	 * even when connection is mapped. Used by geographic modes (choropleth) —
	 * there the connection channel is the region key (which feature each row
	 * is), not a visual series, so a per-region legend would be meaningless. */
	hideConnectionInThisMode: boolean
	/** When true, the Size (area) legend defaults to HIDDEN in this mode —
	 * unlike the hide flags above, the "Legends shown" toggle stays so the
	 * user can turn it back on. Used by the flow (sankey / chord) and
	 * hierarchy (pack / treemap / sunburst) modes, where every mark is sized
	 * by `area` and the diagram itself already communicates the magnitudes.
	 * Resolved via `resolveLegendHidden` (labelsConfig.ts); absent = false. */
	areaHiddenByDefault?: boolean
	/** Reverse the categorical legend order (top→bottom) so the top swatch
	 * aligns with the top of the stack. True for the VERTICAL stacked modes
	 * (bars-x, areas-x), where the first-encountered value sits at the bottom.
	 * False for the horizontal variants (bars-y, areas-y), which stack
	 * left→right so discovery order already matches the stack. */
	reverseCategoricalOrder: boolean
}

/** How the Annotations sidebar panel maps its coordinate inputs onto this
 * mode's encodings. The panel must NEVER compare mode ids — like the canvas
 * traits below, a new chart mode declares these and the panel honors them
 * without edits. */
export type ChartModeAnnotationTraits = {
	/** Encoding channel whose mapped field backs the HORIZONTAL axis for
	 * value-mode ("data units") annotation coordinates. Mirrors what the
	 * renderer scales against: `"x"` for cartesian modes, `"length"` when
	 * the measure runs horizontally (bars-y / areas-y), `"angle"` on radar
	 * (value-mode x IS the angle position). `null` = no field drives the
	 * horizontal value axis in this mode (pies / pies-y — the slice angle
	 * consumed it), so the panel falls back to a bare number input. */
	xValueChannel: "x" | "length" | "angle" | null
	/** Vertical counterpart: `"y"` for cartesian modes, `"length"` when the
	 * measure runs vertically (bars-x / areas-x), `"r"` on radar. `null` =
	 * no vertical value axis (pies / pies-x). */
	yValueChannel: "y" | "r" | "length" | null
	/** True when value-mode annotation coordinates are POLAR (radar):
	 * x reads as the angle position and y as the radial distance, so circle
	 * editors relabel their center inputs ("center angle" / "center r"),
	 * always measure the radius on the r axis, and hide the x/y radius-axis
	 * toggle. Polar modes WITHOUT value axes (the pie variants) leave this
	 * false — they disable value mode entirely instead (the panel derives
	 * that from `canvas.coordFamily === "polar"`). */
	polarValueCoords: boolean
}

/** Shape of a chart-type definition. Registering a new mode means adding
 * one of these to the registry (`chartModes/index.ts`) AND binding its
 * renderer component in `components/viz/rendererRegistry.ts` (keyed by
 * the `ChartMode` union, so forgetting the binding is a compile error).
 *
 * Mode defs are deliberately React-free — detection + declarative traits
 * only — so mode detection can be imported by tests, the layout solver,
 * and sidebar hooks without pulling in the renderer tree. */
export type ChartModeDef = {
	/** Stable identifier matching the existing ChartMode union string
	 * (`"scatter" | "bars-x" | "bars-y" | "pies-x" | "pies-y"` today). */
	id: string
	/** Return true when the current encodings select this mode. The first
	 * registered mode whose detect() returns true wins — put narrower
	 * modes before broader ones. `scatter` should be last (fallback).
	 *
	 * `getType`, when provided, lets the mode look up the effective type of
	 * any mapped field (respecting user overrides). Modes that don't need
	 * type info ignore the second argument; modes that DO need it (tile)
	 * should bail out gracefully when it's absent.
	 *
	 * `channelConfigs`, when provided, lets a mode consult per-channel config
	 * (e.g. the histogram toggle on an axis). Callers that omit it simply
	 * won't activate config-gated modes — a safe default.
	 *
	 * `mapConfig`, when provided, exposes the chart-wide map settings (e.g.
	 * `coordSystem`) so geographic modes can activate. Cartesian modes ignore
	 * it; callers that omit it simply won't activate geographic modes. */
	detect: (
		encodings: Encodings,
		getType?: FieldTypeLookup,
		channelConfigs?: ChannelConfigs,
		mapConfig?: MapConfig
	) => boolean
	legend: ChartModeLegendConfig
	facet: {
		/** True when this mode supports a shared measure axis across
		 * facet panels (bar modes). False for scatter/pie. */
		supportsSharedMeasureMax: boolean
	}
	/** Declarative traits the Annotations sidebar panel reads — see
	 * `ChartModeAnnotationTraits`. */
	annotations: ChartModeAnnotationTraits
	/** Declarative traits PlotCanvas branches on. PlotCanvas must NEVER
	 * compare mode ids — a new chart mode declares its traits here and the
	 * canvas honors them without edits. (The sidebar equivalent is the
	 * legend/facet blocks above.) */
	canvas: ChartModeCanvasTraits
}

/** How PlotCanvas lays out and adorns panels for a mode. */
export type ChartModeCanvasTraits = {
	/** Coordinate family. `"polar"` (radar + pie variants) drives the
	 * solver's reduced per-cell chrome (POLAR_MARGIN) and the angle/r →
	 * x/y share-mode migration; `"geo"` panels own their projection and
	 * ignore cartesian share plumbing. */
	coordFamily: "cartesian" | "polar" | "geo"
	/** Which ENCODING axis carries the continuous measure for bar/area-
	 * style charts: the axis whose bounds PlotCanvas translates into
	 * `measureMinOverride`/`measureMaxOverride` and whose share mode
	 * drives the per-group measure max. `"y"` = vertical (bars-x/areas-x),
	 * `"x"` = horizontal (bars-y/areas-y). `null` = no measure axis
	 * (scatter, tile, polar, geo). Non-null also implies the measure axis
	 * is continuous even when no field is mapped to it (histogram count). */
	measureAxis: "x" | "y" | null
	/** The field supplying the measure VALUE for the shared-axis group
	 * max. Declared only by measure-axis modes; encodes each mode's own
	 * fallback chain (e.g. areas-x reads `length` then `y`). */
	resolveMeasureField?: (encodings: Encodings) => string | null
	/** True when this mode's marks can point BELOW zero: the measure axis
	 * extends down to the lowest value in the data and marks grow from the
	 * zero baseline in whichever direction their value points. Absent /
	 * false = the measure axis floors at zero and a negative value collapses
	 * to nothing, which is the historical behavior for every measure-axis
	 * mode. Only bars implement the diverging geometry today; areas keep the
	 * zero floor until their path builder grows the same handling. */
	supportsNegativeMeasure?: boolean
	/** Polar-only: what "size panels by unit" uses as a panel's unit.
	 * `"rAxisMax"` (radar) = the R-axis data max, honoring R-range
	 * overrides and shareR group folding. `"angleSum"` (pies) = the sum
	 * of slice values; no R axis, so no override/share folding. */
	polarUnit?: "rAxisMax" | "angleSum"
	/** True when the renderer draws value-coordinate circle / line-segment
	 * annotations itself (radar: polar coords), so the canvas annotation
	 * layer must skip them. */
	valueAnnotationsInRenderer?: boolean
}
