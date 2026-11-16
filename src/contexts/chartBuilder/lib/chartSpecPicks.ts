/** What a chart spec's encoding picks also do once everything else has
 * landed (`composeVisual` / `editVisual` run this after the `settings`), the
 * same lib calls the editor makes at the pick, with the notes a program
 * reads in `warnings`. Pure. */

import { withAreaFillFollowingColor } from "./connectionEdits"
import { barLabelPositionNote, barValueAxis } from "./dataLabelsPosition"
import {
	keepLineFollowingColor,
	lineFollowsColorNote,
	type PreviousColor,
	withLineFollowingColor,
} from "./lineFollowsColor"
import type { FieldType, Theme, Visual } from "./types"

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

export type SpecPickOptions = {
	theme: Theme
	typeOf: (field: string) => FieldType | undefined
	/** The spec maps Color (`hue`) or Connection: the picks lines follow. */
	mapsColorOrSeries: boolean
	/** An edit's stored Color mapping before the edit (variable + configs),
	 * so lines that followed it move to a new Color variable. */
	previousColor?: PreviousColor
	/** The spec's `settings`, to tell a label position the request set from
	 * one the bar seeding set. */
	settings: unknown
}

/** `visual` with the lines following Color when the spec mapped Color or
 * Connection on a line chart (`withLineFollowingColor`, after the settings so
 * a line color they choose is kept), and a filled area's bodies taking the
 * theme's fill palette when Color is mapped on it afterwards
 * (`withAreaFillFollowingColor`), plus a note for each pick effect: the
 * lines' color, and bar labels positioned on the Length variable (that seed
 * runs in `settingEffects`). */
export const withSpecPickEffects = (
	visual: Visual,
	opts: SpecPickOptions,
	warnings: string[]
): Visual => {
	let out = visual
	if (opts.mapsColorOrSeries) {
		const hueField = visual.encodings.hue?.field ?? null
		const hueType = hueField ? opts.typeOf(hueField) : null
		const configs = withLineFollowingColor(
			visual.channelConfigs,
			visual.encodings,
			hueType,
			opts.theme,
			opts.previousColor
		)
		if (configs !== visual.channelConfigs && hueField) {
			out = { ...visual, channelConfigs: configs }
			warnings.push(lineFollowsColorNote(hueField))
		}
		// The same call the encoding shelf makes at the pick: an area that was
		// filled before it had a Color variable gets the palettes it would
		// have had with one. Picks already made are kept.
		const filled = withAreaFillFollowingColor(
			out.channelConfigs,
			out.encodings,
			hueType,
			opts.theme,
			opts.typeOf
		)
		if (filled !== out.channelConfigs) out = { ...out, channelConfigs: filled }
	} else if (opts.previousColor) {
		// An edit that keeps the Color variable but changes its palette or
		// gradient (through `settings`): lines that followed Color keep
		// following it, as the Color panel's palette pick does.
		const hueField = visual.encodings.hue?.field ?? null
		if (hueField && hueField === opts.previousColor.hueField) {
			const configs = keepLineFollowingColor(
				opts.previousColor.configs,
				visual.channelConfigs,
				hueField,
				opts.typeOf(hueField),
				opts.theme
			)
			if (configs !== visual.channelConfigs) out = { ...visual, channelConfigs: configs }
		}
	}
	const labelsSent = isObj(opts.settings) ? opts.settings.dataLabelsEncodings : undefined
	const axis = barValueAxis(visual.encodings)
	const lengthField = visual.encodings.length?.field
	if (
		axis &&
		lengthField &&
		isObj(labelsSent) &&
		labelsSent.value !== undefined &&
		labelsSent[axis] === undefined &&
		visual.dataLabelsEncodings?.[axis]?.field === lengthField
	)
		warnings.push(
			barLabelPositionNote(axis, lengthField, visual.dataLabelsConfig?.barLabelPosition ?? "center")
		)
	return out
}
