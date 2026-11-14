import { useAtomValue } from "jotai"
import { effectiveType } from "../lib/fieldType"
import { isPureDensityCurve } from "../lib/markParts"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
} from "./atoms"
import { useChartModeDef } from "./useChartModeDef"
import { useCurrentDatasetView } from "./useCurrentDatasetView"

/** True when the chart is a PURE density curve — the standalone "Density"
 * distribution display on a lone quantitative position axis, where the
 * renderer suppresses the scatter marks. The rule itself is
 * `isPureDensityCurve` (lib/markParts), shared with everything that asks
 * which parts a chart draws; this hook feeds it the editor's state. */
export const usePureDensityCurve = (): boolean => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	const modeDef = useChartModeDef()
	return isPureDensityCurve(
		modeDef,
		encodings,
		configs,
		dataset ? (name) => effectiveType(dataset, name, overrides) : undefined
	)
}
