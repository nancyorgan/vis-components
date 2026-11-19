import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
	type LabelPointsMode,
	type LabelPointsScope,
} from "../../../lib/channelConfig"
import type { DataLabelsChannel } from "./shared"

/** Constants and option lists shared by the Data Labels panel's sections. */

/** Sentinel option value for the Value dropdown's "Multiple variables…"
 *  choice. Distinct from any field name and from "" (— none —) so the
 *  onChange handler can switch the `value` encoding into multi-field mode
 *  (which leaves `value.field` null and drives text off `value.fields`). */
export const DATA_LABELS_MULTI_VALUE = "__multiple__"
// "Characters" (wrap width) default — also its reset target.
export const DEFAULT_WRAP_CHARS = DEFAULT_DATA_LABELS_CONFIG.wrapMaxChars ?? 20

/** "Which labels" choices — shared by the single-field select and the
 *  per-variable selects of multi-field mode. With the scope select showing
 *  beneath ("Of each: Series / Group / Stack") the choices drop their
 *  tail so the two selects read as one sentence ("scope"); elsewhere the
 *  tail says what the ends run over — "per series", or "wedge" on a lone
 *  pie, where the ends always run over each pie's wedges from the arc
 *  start (the renderer pins the scope there; see `buildPieAnchors`). */
export type LabelPointsTail = "scope" | "series" | "wedge"
export const labelPointsOptions = (
	tail: LabelPointsTail
): ReadonlyArray<{ value: LabelPointsMode; label: string }> => {
	const suffix =
		tail === "scope" ? "" : tail === "wedge" ? " wedge" : " per series"
	return [
		{ value: "all", label: "All labels" },
		{ value: "first", label: `First${suffix}` },
		{ value: "last", label: `Last${suffix}` },
		{ value: "first-last", label: `First and last${suffix}` },
	]
}

/** What the series ends run over (`DataLabelsConfig.labelPointsScope`),
 *  worded per chart family. Only the scopes the chart supports are
 *  offered: "Group" needs a group-mode channel (bars only), "Stack" / "Pie"
 *  a layering channel (stack / overlay on bars and areas; the wedge
 *  channel on pies). The stored value is "stack" for pies too — a pie's
 *  wedges are its layers. */
export type ScopeFamily = "bars" | "areas" | "pies"
export const SCOPE_OPTION: Record<ScopeFamily, Record<LabelPointsScope, string>> = {
	bars: { series: "Series", group: "Group", stack: "Stack" },
	areas: { series: "Series", group: "Group", stack: "Stack" },
	pies: { series: "Series", group: "Group", stack: "Pie" },
}
export const SCOPE_HELP: Record<ScopeFamily, Record<LabelPointsScope, string>> = {
	bars: {
		series: "The first and last bar of each series along the axis.",
		group: "The first and last bar inside each group.",
		stack: "The bottom and top layer of each stack.",
	},
	areas: {
		series: "The first and last point of each layer along the axis.",
		group: "",
		stack: "The bottom and top layer at each point.",
	},
	pies: {
		series: "The same wedge on the first and last pie.",
		group: "",
		stack: "The first and last wedge of each pie.",
	},
}

export const CHANNEL_LABEL: Record<DataLabelsChannel, string> = {
	x: "X position",
	y: "Y position",
	angle: "Angle",
	geography: "Geography",
	value: "Value",
	hue: "Color",
	size: "Size",
}

/** Measure-axis placement options ("Vertical" on vertical bars). */
export const BAR_POSITION_OPTIONS: {
	value: NonNullable<DataLabelsConfig["barLabelPosition"]>
	label: string
}[] = [
	{ value: "center", label: "Center of bar (default)" },
	{ value: "inside-base", label: "Inside, near base" },
	{ value: "inside-end", label: "Inside, near end" },
	{ value: "outside-end", label: "Outside the end of the bar" },
]

/** Side options, named by orientation: left / right of a vertical bar,
 *  above / below a horizontal one. */
export const barSideOptions = (
	isVerticalBars: boolean
): { value: NonNullable<DataLabelsConfig["barLabelSide"]>; label: string }[] => [
	{ value: "center", label: "Centered on the bar (default)" },
	{ value: "before", label: isVerticalBars ? "Left of the bar" : "Above the bar" },
	{ value: "after", label: isVerticalBars ? "Right of the bar" : "Below the bar" },
]
