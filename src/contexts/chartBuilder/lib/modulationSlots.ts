import type {
	ChannelConfigs,
	ModulationSlotConfig,
	ModulationSlotKey,
} from "./channelConfig"
import type { ChartMode } from "./chartMode"
import { isAreaModeId } from "./chartModes/families"
import {
	areaPointsOn,
	densityCurveFillOn,
	densityCurveOn,
	filledRadarOn,
	overlayOn,
	regressionCiOn,
	regressionOn,
	rugOn,
} from "./colorSlots"
import type { Encodings } from "./types"

/** The two color modulations that split by mark part. */
export type ModulationChannel = "saturation" | "brightness"

/** Where each channel keeps its per-part slots on `ChannelConfigs`. */
export const MODULATION_SLOTS_KEY = {
	saturation: "saturationSlots",
	brightness: "brightnessSlots",
} as const satisfies Record<ModulationChannel, keyof ChannelConfigs>

/** Static description of one saturation / brightness part. Mirrors
 * `OpacitySlotDef`, minus the default level: every part starts OFF (no
 * modulation), which is what the renderers drew before slots existed. */
export type ModulationSlotDef = {
	key: ModulationSlotKey
	label: string
	/** `null` = every chart mode (the marks' own outline). */
	modes: ReadonlySet<ChartMode> | null
	isApplicable: (
		encodings: Encodings,
		configs: ChannelConfigs,
		mode: ChartMode
	) => boolean
	/** False when the part carries no data to vary by (a dot map's regions):
	 *  the target offers one level, no "Vary by". Absent = true. */
	acceptsFieldMapping?: boolean
}

const m = (...modes: ChartMode[]): ReadonlySet<ChartMode> => new Set(modes)

/** Registry of every modulation slot, in display order. Fill is NOT here — it
 * reuses the overall `saturation` / `brightness` encoding. Only the scatter
 * and radar renderers (points, connection lines / polygon outlines, the
 * violin / box overlay, the polygon body) and the area renderer (the layer
 * Line and its point markers) read these parts today, so the gates keep
 * the menu from offering a control that would do nothing elsewhere. Area
 * charts read Line, Area fill, Point fill, Point outline (the panel hoists
 * the Line above the Fill there). The violin / box pair mirrors the Color and Opacity menus' slots
 * of the same names (`overlayOn` gate); the polygon body likewise
 * (`filledRadarOn`). In polygon mode the menus title Outline / Line "Point
 * outline" / "Connection line" (see `markPartTitles`). */
export const MODULATION_SLOT_REGISTRY: readonly ModulationSlotDef[] = [
	{
		key: "areaPointFill",
		label: "Point fill",
		modes: m("areas-x", "areas-y"),
		isApplicable: areaPointsOn,
	},
	{
		// The marks' own outline — a point's ring, a bar's, a slice's, a
		// cell's, a region's. Every renderer resolves it through
		// `lib/markOutline`, so the option reaches every outline. Not the area
		// modes: an area's own outline is its Line, and the points on it have
		// the Point outline target below. (Whether an outline is drawn at all
		// — not on line segments, nor a pure density curve — is asked of
		// `drawnParts` where the menus are assembled.)
		key: "outline",
		label: "Outline",
		modes: null,
		isApplicable: (_encodings, _configs, mode) => !isAreaModeId(mode),
	},
	{
		// The combo modes draw their line with scatter's line builder, which
		// has always shaded it by this target; the menu just never offered it.
		key: "line",
		label: "Line",
		modes: m("scatter", "radar", "areas-x", "areas-y", "combo-x", "combo-y"),
		isApplicable: (encodings) => !!encodings.connection?.field,
	},
	{
		// Bar + marks combo: the points on the line, beside the bars.
		key: "comboPointFill",
		label: "Point fill",
		modes: m("combo-x", "combo-y"),
		isApplicable: () => true,
	},
	{
		key: "areaPointOutline",
		label: "Point outline",
		modes: m("areas-x", "areas-y"),
		isApplicable: areaPointsOn,
	},
	{
		key: "violinFill",
		label: "Violin / box fill",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
	},
	{
		key: "violinStroke",
		label: "Violin / box outline",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
	},
	// The overlays drawn over the marks: each takes Saturation and Brightness
	// like its Color and Opacity, under the same gate (the overlay is on).
	{
		key: "stem",
		label: "Stem",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) =>
			(configs.connection?.axisStem ?? "none") !== "none",
	},
	{
		key: "regressionStroke",
		label: "Regression line",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => regressionOn(configs),
	},
	{
		key: "regressionCiFill",
		label: "Confidence interval",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => regressionCiOn(configs),
	},
	{
		key: "densityCurveFill",
		label: "Density curve fill",
		modes: m("scatter", "bars-x", "bars-y"),
		isApplicable: (_encodings, configs) => densityCurveFillOn(configs),
	},
	{
		key: "densityCurveStroke",
		label: "Density curve outline",
		modes: m("scatter", "bars-x", "bars-y"),
		isApplicable: (_encodings, configs) => densityCurveOn(configs),
	},
	{
		key: "rug",
		label: "Rug",
		modes: m("bars-x", "bars-y", "scatter"),
		isApplicable: (_encodings, configs) => rugOn(configs),
	},
	{
		// Bubble map: the bubbles' fill and outline, beside the regions'.
		key: "geoPointFill",
		label: "Point fill",
		modes: m("geo-symbols"),
		isApplicable: () => true,
	},
	{
		key: "geoPointStroke",
		label: "Point outline",
		modes: m("geo-symbols"),
		isApplicable: () => true,
	},
	{
		// Dot map: the regions behind the points. One level each — the
		// regions carry no data.
		key: "geoRegionFill",
		label: "Region fill",
		modes: m("geo-points"),
		isApplicable: () => true,
		acceptsFieldMapping: false,
	},
	{
		key: "geoRegionStroke",
		label: "Region outline",
		modes: m("geo-points"),
		isApplicable: () => true,
		acceptsFieldMapping: false,
	},
	{
		// The filled radar polygon's BODY. Untouched, the body inherits the
		// Point fill's shading along with its color; a level / field here
		// shades the body on its own instead (see `polygonBodyResolver`).
		key: "polygonFill",
		label: "Polygon fill",
		modes: m("radar"),
		isApplicable: (_encodings, configs) => filledRadarOn("radar", configs),
	},
]

/** This slot deviates from its untouched (off) state: a field mapped, or a
 * level set. Shared by the panel's subsection dot and the channel's encoding
 * row dot so the two can't drift. */
export const modulationSlotEdited = (
	slotCfg: ModulationSlotConfig | undefined
): boolean => !!slotCfg && (slotCfg.field != null || slotCfg.level != null)

/** Slots shown for a given chart mode + config. */
export const applicableModulationSlots = (
	mode: ChartMode,
	encodings: Encodings,
	configs: ChannelConfigs
): ModulationSlotDef[] =>
	MODULATION_SLOT_REGISTRY.filter(
		(d) =>
			(d.modes === null || d.modes.has(mode)) &&
			d.isApplicable(encodings, configs, mode)
	)
