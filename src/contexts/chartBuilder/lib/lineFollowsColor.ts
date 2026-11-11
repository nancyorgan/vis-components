/** Lines follow Color: on a line chart, mapping Color (`hue`) also sets
 * Color > Line > Vary by to the same variable, so each line draws in its
 * points' color. Applied at the moment of the pick (the encoding shelf, a
 * chart spec), never on load. Pure. */

import { deepEqual } from "../../../lib/deepEqual"
import type { ChannelConfigs, ColorSlotConfig } from "./channelConfig"
import {
	colorSlotEdited,
	COLOR_SLOT_DEFS,
	legacySlotColor,
	lineSlotFollowsHue,
} from "./colorSlots"
import { CATEGORICAL_HUE_PALETTE } from "./scales"
import { seedColorSlot } from "./seedColorSlot"
import type { Encodings, FieldType, Theme } from "./types"

type LineChartEncodings = Pick<Encodings, "x" | "y" | "length" | "angle" | "connection">

/** A line chart: x and y mapped, a series variable on Connection that is
 * neither of them, nothing on Length or Angle. Not a dumbbell (connection =
 * the category axis), an area chart (y on Length), bars or a combo. */
export const isLineChart = (encodings: LineChartEncodings): boolean => {
	const x = encodings.x?.field ?? null
	const y = encodings.y?.field ?? null
	const series = encodings.connection?.field ?? null
	return (
		!!x &&
		!!y &&
		!!series &&
		series !== x &&
		series !== y &&
		!encodings.length?.field &&
		!encodings.angle?.field
	)
}

/** The palette the Color (hue) mapping draws with, as the hue scale reads
 * it: the ordinal ramp for an ordinal field (else the categorical palette),
 * the categorical palette otherwise, and with neither stored the hue
 * scale's own built-in palette (`scales.ts`), which is what the points
 * then draw, NOT the theme's default palette. */
const huePaletteOf = (
	configs: ChannelConfigs,
	hueType: FieldType
): { id: string | null; colors: string[] } => {
	if (hueType === "ordinal" && configs.ordinalPalette)
		return { id: configs.ordinalPaletteId ?? null, colors: configs.ordinalPalette }
	if (configs.categoricalPalette)
		return { id: configs.categoricalPaletteId ?? null, colors: configs.categoricalPalette }
	return { id: null, colors: [...CATEGORICAL_HUE_PALETTE] }
}

/** The Line slot varying by the Color variable, as Color > Line > Vary by
 * stores the pick (`seedColorSlot`), on the Color mapping's OWN palette or
 * gradient (the visual's pick, not the theme default) so each line matches
 * its points. Per-value Color overrides reach the line through the render
 * link (`linkColorConfigs`), so none are copied. */
export const lineSlotFollowingHue = (
	hueField: string,
	hueType: FieldType,
	configs: ChannelConfigs,
	theme: Theme
): ColorSlotConfig => {
	const existing = configs.colorSlots?.line
	const singleColor =
		existing?.singleColor ??
		legacySlotColor("line", configs) ??
		COLOR_SLOT_DEFS.line.themeColor(theme)
	const seeded = seedColorSlot(hueField, hueType, theme)
	if (hueType === "quantitative" || hueType === "temporal") {
		return {
			...existing,
			singleColor,
			...seeded,
			field: hueField,
			...(configs.hue?.kind === "quantitative" ? { hue: { ...configs.hue } } : {}),
		}
	}
	const pal = huePaletteOf(configs, hueType)
	return {
		...existing,
		singleColor,
		...seeded,
		field: hueField,
		paletteId: pal.id,
		palette: [...pal.colors],
	}
}

/** Someone already chose how the lines are colored: an older connection
 * line color (global, per value, or a line palette), or a stored Line slot
 * that deviates from its default (another variable, a palette, a rule, a
 * single color off the theme default). */
const lineColorChosen = (configs: ChannelConfigs, theme: Theme): boolean => {
	const c = configs.connection
	if (c?.strokeColor != null) return true
	if (Object.keys(c?.lineColors ?? {}).length > 0) return true
	if ((c?.linePalette?.length ?? 0) > 0 || c?.linePaletteId != null) return true
	return colorSlotEdited("line", configs.colorSlots?.line, configs, theme)
}

/** The Color mapping before a pick: its variable and the configs it drew
 * with (before the pick re-seeded the Color channel). */
export type PreviousColor = { hueField: string | null; configs: ChannelConfigs }

/** The Line slot still FOLLOWS the previous Color variable: it varies by it
 * with only the seeded state (`lineSlotFollowsHue` against the configs the
 * previous Color mapping drew with), so a new Color variable moves it along. */
const followedPreviousColor = (
	slot: ColorSlotConfig | undefined,
	hueField: string,
	previous: PreviousColor | undefined
): slot is ColorSlotConfig =>
	!!slot &&
	!!previous?.hueField &&
	previous.hueField !== hueField &&
	lineSlotFollowsHue(slot, previous.configs, previous.hueField)

/** The configs after a pick that maps Color, or maps Connection while Color
 * is mapped: on a line chart whose lines are still the theme's single line
 * color, or still follow the PREVIOUS Color variable (`previous`, when Color
 * moved from one variable to another), the Line slot varies by the Color
 * variable. Unchanged (same object) otherwise: no Color variable, not a line
 * chart, the slot already varies by that variable, or a line color someone
 * chose (another variable, a palette, a rule, a single color, per-value
 * colors). Unmapping Color leaves the slot as it is; the caller only runs
 * this on a mapping pick. */
export const withLineFollowingColor = (
	configs: ChannelConfigs,
	encodings: LineChartEncodings & Pick<Encodings, "hue">,
	hueType: FieldType | null | undefined,
	theme: Theme,
	previous?: PreviousColor
): ChannelConfigs => {
	const hueField = encodings.hue?.field ?? null
	if (!hueField || !hueType || !isLineChart(encodings)) return configs
	const slot = configs.colorSlots?.line
	if (slot?.field === hueField) return configs
	const follows = followedPreviousColor(slot, hueField, previous)
	if (!follows && lineColorChosen(configs, theme)) return configs
	// Re-seeding drops the old variable's seeded scale; only the single
	// color carries over.
	const from: ChannelConfigs = follows
		? {
				...configs,
				colorSlots: { ...configs.colorSlots, line: { field: null, singleColor: slot.singleColor } },
			}
		: configs
	return {
		...configs,
		colorSlots: {
			...configs.colorSlots,
			line: lineSlotFollowingHue(hueField, hueType, from, theme),
		},
	}
}

/** The configs after a change to the Color mapping's own settings (its
 * palette, its gradient): a Line slot that FOLLOWED Color before the change
 * (`lineSlotFollowsHue` against `prev`) is re-seeded so it still follows
 * Color after it, so the lines keep their points' colors. Unchanged (same
 * object) when: no Color variable or type, the slot was a person's own pick,
 * or the change itself rewrote the Line slot. */
export const keepLineFollowingColor = (
	prev: ChannelConfigs,
	next: ChannelConfigs,
	hueField: string | null | undefined,
	hueType: FieldType | null | undefined,
	theme: Theme
): ChannelConfigs => {
	if (!hueField || !hueType || next === prev) return next
	const slot = prev.colorSlots?.line
	if (!slot || !deepEqual(next.colorSlots?.line, slot)) return next
	if (!lineSlotFollowsHue(slot, prev, hueField)) return next
	if (lineSlotFollowsHue(slot, next, hueField)) return next
	const from: ChannelConfigs = {
		...next,
		colorSlots: { ...next.colorSlots, line: { field: null, singleColor: slot.singleColor } },
	}
	return {
		...next,
		colorSlots: {
			...next.colorSlots,
			line: lineSlotFollowingHue(hueField, hueType, from, theme),
		},
	}
}

/** The note a program gets when its lines took the Color variable. */
export const lineFollowsColorNote = (hueField: string): string =>
	`the lines take their color from "${hueField}" too, like the points (Color > Line > Vary by; settings channelConfigs.colorSlots.line changes it)`
