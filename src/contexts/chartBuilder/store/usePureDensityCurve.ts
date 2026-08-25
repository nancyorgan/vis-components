import { useAtomValue } from "jotai"
import { effectiveType } from "../lib/fieldType"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
} from "./atoms"
import { useChartModeDef } from "./useChartModeDef"
import { useCurrentDatasetView } from "./useCurrentDatasetView"

/** True when the chart is a PURE density curve — the standalone "Density"
 * distribution display on a lone quantitative position axis (mirrors
 * ScatterPlot's single-variable-distribution detection, incl. the field-type
 * check). The renderer suppresses the scatter marks while the standalone curve
 * is on, so the mark-level Fill / Outline groups in the Color and Opacity
 * menus have nothing to style and are hidden — the Density Curve slots take
 * over. A histogram WITH a density overlay is different: its bars still
 * render, so those groups stay. A stale `showDensityCurve` flag with both
 * position axes mapped also keeps them (the points render again there). */
export const usePureDensityCurve = (): boolean => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const mode = useChartModeDef().id
	const loneQuantCurve = (axis: "x" | "y") => {
		const field = encodings[axis]?.field ?? null
		const other = encodings[axis === "x" ? "y" : "x"]?.field ?? null
		return (
			!!field &&
			!other &&
			!!dataset &&
			effectiveType(dataset, field, overrides) === "quantitative" &&
			configs[axis]?.distributionOverlay?.showDensityCurve === true
		)
	}
	return mode === "scatter" && (loneQuantCurve("x") || loneQuantCurve("y"))
}
