import type {
	ChannelConfigs,
	ModulationSlotConfig,
	ModulationSlotKey,
} from "./channelConfig"
import { chartModeDefById, type ChartMode } from "./chartMode"
import {
	menuTargets,
	type ModulationFacet,
	type TargetContext,
	type TargetPart,
} from "./partTargets"
import type { Encodings } from "./types"

/** The two color modulations that split by mark part. */
export type ModulationChannel = "saturation" | "brightness"

/** Where each channel keeps its per-part slots on `ChannelConfigs`. */
export const MODULATION_SLOTS_KEY = {
	saturation: "saturationSlots",
	brightness: "brightnessSlots",
} as const satisfies Record<ModulationChannel, keyof ChannelConfigs>

/** One saturation / brightness target: those menus' view of a row of
 * `PART_TARGETS` (lib/partTargets). Like an opacity target minus the default
 * level: every part starts OFF (no modulation), which is what the renderers
 * drew before the targets existed. */
export type ModulationSlotDef = ModulationFacet & {
	key: ModulationSlotKey
	label: string
	/** The part the target styles. */
	part: TargetPart
	/** The chart draws that part. */
	drawn: (ctx: TargetContext) => boolean
	/** `drawn`, for a caller that holds the mode's id. */
	isApplicable: (
		encodings: Encodings,
		configs: ChannelConfigs,
		mode: ChartMode
	) => boolean
}

/** Every saturation / brightness target, in the table's order. Fill is NOT
 * here — it reuses the overall `saturation` / `brightness` encoding. The
 * marks' own outline is the `outline` target; on an area chart, whose own
 * outline is its Line, it is the `line` target (see the table). */
export const MODULATION_SLOT_REGISTRY: readonly ModulationSlotDef[] = menuTargets(
	"modulation"
).map(({ key, label, part, drawn, facet }) => ({
	...facet,
	key: key as ModulationSlotKey,
	label,
	part,
	drawn,
	isApplicable: (encodings, configs, mode) =>
		drawn({ canvas: chartModeDefById(mode).canvas, encodings, configs }),
}))

/** This slot deviates from its untouched (off) state: a field mapped, or a
 * level set. Shared by the panel's subsection dot and the channel's encoding
 * row dot so the two can't drift. */
export const modulationSlotEdited = (
	slotCfg: ModulationSlotConfig | undefined
): boolean => !!slotCfg && (slotCfg.field != null || slotCfg.level != null)

/** The saturation / brightness targets a chart offers: those whose part it
 * draws. */
export const modulationSlotsFor = (ctx: TargetContext): ModulationSlotDef[] =>
	MODULATION_SLOT_REGISTRY.filter((d) => d.drawn(ctx))

/** `modulationSlotsFor`, for a caller that holds the mode's id. */
export const applicableModulationSlots = (
	mode: ChartMode,
	encodings: Encodings,
	configs: ChannelConfigs
): ModulationSlotDef[] =>
	modulationSlotsFor({ canvas: chartModeDefById(mode).canvas, encodings, configs })
