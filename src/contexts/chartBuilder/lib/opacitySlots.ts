import type { ChannelConfigs, OpacitySlotKey } from "./channelConfig"
import type { ChartMode } from "./chartMode"
import {
	densityCurveFillOn,
	densityCurveOn,
	histogramOn,
	overlayOn,
	regressionCiOn,
	regressionOn,
} from "./colorSlots"
import type { Encodings } from "./types"

/** Static description of one opacity-slot target: its label, which chart modes
 * surface it (`null` = every mode, for the universal border), an extra
 * applicability gate, the good-looking default opacity, and whether it supports
 * mapping a variable (the radar spine is level-only). Mirrors `ColorSlotDef`. */
export type OpacitySlotDef = {
	key: OpacitySlotKey
	label: string
	/** `null` = applicable in every chart mode (universal, e.g. border). */
	modes: ReadonlySet<ChartMode> | null
	isApplicable: (
		encodings: Encodings,
		configs: ChannelConfigs,
		mode: ChartMode
	) => boolean
	/** Default opacity when the slot has no explicit level — replaces the color
	 * registry's `themeColor`. Parts that read semi-transparent today (violin
	 * fill) keep a sensible default rather than snapping to 1. */
	defaultLevel: number
	/** When false, the slot offers a single level only — no "vary by" field
	 * dropdown (e.g. the radar spine). */
	acceptsFieldMapping: boolean
}

const m = (...modes: ChartMode[]): ReadonlySet<ChartMode> => new Set(modes)

/** Registry of every opacity slot, in display order. Fill is NOT here — it
 * reuses the overall `opacity` encoding. Border is universal; the remaining
 * slots mirror `COLOR_SLOT_REGISTRY`'s gates exactly. */
export const OPACITY_SLOT_REGISTRY: readonly OpacitySlotDef[] = [
	{
		// Stroke/outline opacity. Labeled "Outline" to match the Color menu's
		// outline subheader; the storage key stays `border` for back-compat.
		key: "border",
		label: "Outline",
		modes: null,
		isApplicable: () => true,
		defaultLevel: 1,
		acceptsFieldMapping: true,
	},
	{
		key: "rug",
		label: "Rug",
		// Histogram rug (bars) + the density display's rug (scatter) — same
		// tassel config, so Rug opacity stays put across the Histogram ⇄ Density
		// switch.
		modes: m("bars-x", "bars-y", "scatter"),
		isApplicable: (_encodings, configs) =>
			histogramOn(configs) || densityCurveOn(configs),
		defaultLevel: 1,
		acceptsFieldMapping: true,
	},
	{
		key: "line",
		label: "Line",
		modes: m("scatter"),
		isApplicable: (encodings) => !!encodings.connection?.field,
		defaultLevel: 1,
		acceptsFieldMapping: true,
	},
	{
		key: "violinFill",
		label: "Violin / Box Fill",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
		defaultLevel: 0.45,
		acceptsFieldMapping: true,
	},
	{
		key: "violinStroke",
		label: "Violin / Box Outline",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
		defaultLevel: 1,
		acceptsFieldMapping: true,
	},
	// Density-curve opacity is level-only BY DESIGN, even though the color
	// slots of the same name accept a field: curve GROUPING is driven by the
	// color slots' field, and both renderers resolve curve opacity once per
	// curve (not per row), so a field mapped here would render per-category
	// controls that have no effect on the canvas. Same rationale as the flow
	// node/ribbon slots above. Making this functional means threading per-row
	// opacity through buildDensityCurve — a feature, not a flag flip.
	{
		key: "densityCurveFill",
		label: "Density Curve Fill",
		modes: m("scatter", "bars-x", "bars-y"),
		// Mirrors the color slot's gate: only when "Fill under curve" is on.
		isApplicable: (_encodings, configs) => densityCurveFillOn(configs),
		defaultLevel: 0.25,
		acceptsFieldMapping: false,
	},
	{
		key: "densityCurveStroke",
		label: "Density Curve Outline",
		modes: m("scatter", "bars-x", "bars-y"),
		isApplicable: (_encodings, configs) => densityCurveOn(configs),
		defaultLevel: 1,
		acceptsFieldMapping: false,
	},
	{
		key: "regressionStroke",
		label: "Regression line",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => regressionOn(configs),
		defaultLevel: 1,
		acceptsFieldMapping: true,
	},
	{
		// The band reads as a translucent wash under the line — full opacity
		// would bury the dots it overlaps.
		key: "regressionCiFill",
		label: "Confidence interval",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => regressionCiOn(configs),
		defaultLevel: 0.15,
		acceptsFieldMapping: true,
	},
	{
		key: "stem",
		label: "Stem",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) =>
			(configs.connection?.axisStem ?? "none") !== "none",
		defaultLevel: 1,
		acceptsFieldMapping: true,
	},
	{
		key: "spine",
		label: "Radar Spine",
		modes: m("radar"),
		isApplicable: () => true,
		defaultLevel: 1,
		acceptsFieldMapping: false,
	},
	// Flow diagrams (chord / sankey) split opacity by mark part: node arcs /
	// rects anchor the eye at full opacity while ribbons / links read as
	// translucent washes of their source node's color. Flow marks aggregate
	// many rows, so a per-row field mapping is ill-defined — level only.
	{
		key: "node",
		label: "Nodes",
		modes: m("chord", "sankey"),
		isApplicable: () => true,
		defaultLevel: 1,
		acceptsFieldMapping: false,
	},
	{
		key: "ribbon",
		label: "Ribbons",
		modes: m("chord", "sankey"),
		isApplicable: () => true,
		defaultLevel: 0.45,
		acceptsFieldMapping: false,
	},
]

export const OPACITY_SLOT_DEFS: Record<OpacitySlotKey, OpacitySlotDef> =
	Object.fromEntries(OPACITY_SLOT_REGISTRY.map((d) => [d.key, d])) as Record<
		OpacitySlotKey,
		OpacitySlotDef
	>

/** Slots shown for a given chart mode + config — mode matches (or is universal)
 * AND the feature gate passes. Used by the Opacity panel to pick subheaders. */
export const applicableOpacitySlots = (
	mode: ChartMode,
	encodings: Encodings,
	configs: ChannelConfigs
): OpacitySlotDef[] =>
	OPACITY_SLOT_REGISTRY.filter(
		(d) =>
			(d.modes === null || d.modes.has(mode)) &&
			d.isApplicable(encodings, configs, mode)
	)
