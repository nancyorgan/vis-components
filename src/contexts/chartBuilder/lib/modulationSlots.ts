import type {
	ChannelConfigs,
	ModulationSlotConfig,
	ModulationSlotKey,
} from "./channelConfig"
import type { ChartMode } from "./chartMode"
import { areaPointsOn, filledRadarOn, overlayOn } from "./colorSlots"
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
	modes: ReadonlySet<ChartMode>
	isApplicable: (encodings: Encodings, configs: ChannelConfigs) => boolean
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
		key: "outline",
		label: "Outline",
		modes: m("scatter", "radar"),
		isApplicable: () => true,
	},
	{
		key: "line",
		label: "Line",
		modes: m("scatter", "radar", "areas-x", "areas-y"),
		isApplicable: (encodings) => !!encodings.connection?.field,
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
		(d) => d.modes.has(mode) && d.isApplicable(encodings, configs)
	)
