import type { ChannelConfigs } from "./channelConfig"
import { getChartMode } from "./chartMode"
import type { Encodings, FieldType } from "./types"

/** The active-histogram facts the Fill color / opacity panels (and the legend)
 *  need to offer "vary by Count/Density": which position channel carries the
 *  binned quantitative field, that field's name, and the current measure mode
 *  (`histogram.mode`). Only ONE of Count/Density is ever offered — the one
 *  matching `mode` — so the dropdown can't disagree with the measure axis. */
export type HistogramMeasure = {
	/** Position channel carrying the binned quantitative field ("x" → vertical
	 *  bars, "y" → horizontal bars). */
	categoryChannel: "x" | "y"
	/** The binned quantitative field's name. */
	categoryField: string
	/** Whether the bars (and so the encodable measure) are raw counts or each
	 *  bin's share of the total. */
	mode: "count" | "density"
}

/** Reserved `<select>` option values for the Count / Density "vary by" choices.
 *  The reserved `__hist_measure__` prefix keeps them from colliding with a
 *  dataset column name, letting the panels tell "the user picked the measure"
 *  apart from "the user picked a field that happens to be named count".
 *  onChange handlers must compare against these BEFORE treating the value as a
 *  field name. */
export const MEASURE_OPTION_VALUE: Record<"count" | "density", string> = {
	count: "__hist_measure__count",
	density: "__hist_measure__density",
}

/** Resolve the active histogram measure for the current chart, or `null` when
 *  the chart isn't an active histogram. Mirrors `BarPlot`'s own detection
 *  (`getChartMode` → bars-x/bars-y, quantitative category field, the category
 *  channel's `histogram.enabled`) so the sidebar offers Count/Density exactly
 *  when the renderer would draw a histogram. */
export const resolveHistogramMeasure = (
	encodings: Encodings,
	getType: (name: string) => FieldType,
	channelConfigs: ChannelConfigs
): HistogramMeasure | null => {
	const mode = getChartMode(encodings, getType, channelConfigs)
	if (mode !== "bars-x" && mode !== "bars-y") return null
	const categoryChannel = mode === "bars-x" ? "x" : "y"
	const categoryField = encodings[categoryChannel].field
	if (!categoryField) return null
	if (getType(categoryField) !== "quantitative") return null
	const hist = channelConfigs[categoryChannel]?.histogram
	if (hist?.enabled !== true) return null
	return { categoryChannel, categoryField, mode: hist.mode ?? "count" }
}
