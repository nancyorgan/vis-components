import { useMemo } from "react"
import { useAtomValue } from "jotai"

import { drawnParts, type DrawnParts, type PartsContext } from "../lib/markParts"
import { currentChannelConfigsAtom, currentEncodingsAtom } from "./atoms"
import { useChartModeDef } from "./useChartModeDef"
import { usePureDensityCurve } from "./usePureDensityCurve"

/** The chart being edited, as the mark-parts rules see it (`lib/markParts`):
 *  what every options panel and the "edited" dots ask their questions of. */
export const usePartsContext = (): PartsContext => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const modeDef = useChartModeDef()
	const pureDensityCurve = usePureDensityCurve()
	return useMemo(
		() => ({ modeDef, encodings, configs, pureDensityCurve }),
		[modeDef, encodings, configs, pureDensityCurve]
	)
}

/** Which of the marks' parts the chart being edited draws now. A panel
 *  shows a control only when the part it styles is among them. */
export const useDrawnParts = (): DrawnParts => {
	const ctx = usePartsContext()
	return useMemo(() => drawnParts(ctx), [ctx])
}
