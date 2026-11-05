import type { ReactNode } from "react"
import { atom, useAtomValue } from "jotai"

import { CustomPatternsContext } from "../lib/customPatterns"
import { currentChannelConfigsAtom } from "./atoms"

/** The current chart's custom fill patterns. A derived atom, so the
 *  provider below only re-renders when the list itself changes, not on
 *  every config edit. Read from the STORED configs (not the render-side
 *  atom): no render transform touches the list, and the render atom pulls
 *  in the dataset, which this app-root subscription shouldn't wait on. */
const customPatternsAtom = atom(
	(get) => get(currentChannelConfigsAtom).pattern?.customPatterns
)

/** Hands the chart's custom patterns to every `PatternTile` beneath it
 *  (chart defs, legend swatches, the Pattern menu's chips). Mounted once at
 *  the app root and the embed root. */
export const CustomPatternsProvider = ({ children }: { children: ReactNode }) => {
	const customPatterns = useAtomValue(customPatternsAtom)
	return (
		<CustomPatternsContext.Provider value={customPatterns}>
			{children}
		</CustomPatternsContext.Provider>
	)
}
