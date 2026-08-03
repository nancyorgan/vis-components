import { useAtomValue } from "jotai"
import { getChartModeDef } from "../lib/chartMode"
import { effectiveType } from "../lib/fieldType"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentMapConfigAtom,
} from "./atoms"
import { useCurrentDatasetView } from "./useCurrentDatasetView"

/**
 * Resolve the current chart's ChartModeDef the same way the render path does —
 * passing field-type lookup AND channel configs into detection. Sidebar panels
 * MUST use this rather than calling `getChartModeDef(encodings)` directly:
 * config-gated modes (notably histograms, which key off `channelConfigs.x/y
 * .histogram.enabled`) only resolve when the configs are supplied, so a bare
 * call misclassifies them as `scatter` and the panel shows the wrong controls.
 */
export const useChartModeDef = () => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	const dataset = useCurrentDatasetView()
	const getType = dataset
		? (name: string) => effectiveType(dataset, name, overrides)
		: undefined
	return getChartModeDef(encodings, getType, channelConfigs, mapConfig)
}
