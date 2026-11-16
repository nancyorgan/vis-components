import type {
	ChannelConfigs,
	OpacitySlotConfig,
	OpacitySlotKey,
} from "./channelConfig"
import { chartModeDefById, type ChartMode } from "./chartMode"
import {
	menuTargets,
	type OpacityFacet,
	type TargetContext,
	type TargetPart,
} from "./partTargets"
import type { Encodings } from "./types"

/** One opacity target: the Opacity menu's view of a row of `PART_TARGETS`
 * (lib/partTargets) — its label, the part it styles, when the chart draws
 * that part, the level it starts at, and whether it supports mapping a
 * variable (flow nodes / ribbons are level-only). */
export type OpacitySlotDef = OpacityFacet & {
	key: OpacitySlotKey
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

/** Every opacity target, in the table's order. Fill is NOT here — it reuses
 * the overall `opacity` encoding. The marks' own outline is the `border`
 * target, on every chart. */
export const OPACITY_SLOT_REGISTRY: readonly OpacitySlotDef[] = menuTargets("opacity").map(
	({ key, label, part, drawn, facet }) => ({
		...facet,
		key: key as OpacitySlotKey,
		label,
		part,
		drawn,
		isApplicable: (encodings, configs, mode) =>
			drawn({ canvas: chartModeDefById(mode).canvas, encodings, configs }),
	})
)

export const OPACITY_SLOT_DEFS: Record<OpacitySlotKey, OpacitySlotDef> =
	Object.fromEntries(OPACITY_SLOT_REGISTRY.map((d) => [d.key, d])) as Record<
		OpacitySlotKey,
		OpacitySlotDef
	>

/** This slot deviates from its untouched state: a field mapped, or its level
 * moved off the part's default. A slot OBJECT merely existing is NOT an edit —
 * the panel writes a well-formed `{field: null, level: default}` on any touch
 * (a reset included), so presence alone must not count. The single source for
 * both the panel's subsection dot and the encoding row's channel dot, so the
 * two can't drift. */
export const opacitySlotEdited = (
	key: OpacitySlotKey,
	slotCfg: OpacitySlotConfig | undefined
): boolean => {
	if (!slotCfg) return false
	if (slotCfg.field != null) return true
	// A stray key with no registry entry renders nowhere (nothing to clear), so
	// it never dots.
	const def = OPACITY_SLOT_DEFS[key]
	return def != null && slotCfg.level != null && slotCfg.level !== def.defaultLevel
}

/** The opacity targets a chart offers: those whose part it draws. */
export const opacitySlotsFor = (ctx: TargetContext): OpacitySlotDef[] =>
	OPACITY_SLOT_REGISTRY.filter((d) => d.drawn(ctx))

/** `opacitySlotsFor`, for a caller that holds the mode's id. */
export const applicableOpacitySlots = (
	mode: ChartMode,
	encodings: Encodings,
	configs: ChannelConfigs
): OpacitySlotDef[] =>
	opacitySlotsFor({ canvas: chartModeDefById(mode).canvas, encodings, configs })
