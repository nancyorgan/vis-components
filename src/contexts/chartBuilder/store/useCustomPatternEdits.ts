import { useAtom, useSetAtom } from "jotai"

import type { CustomPattern } from "../lib/channelConfig"
import {
	insertCustomPattern,
	removeCustomPattern,
	removeCustomPatternFromMap,
} from "../lib/customPatternSlots"
import { patternConfigFromTheme } from "../lib/themeConfig"
import { currentChannelConfigsAtom, currentMapConfigAtom } from "./atoms"
import { useCurrentTheme } from "./useCurrentTheme"

/** The chart's custom (uploaded) fill patterns and the two edits every
 *  picker with a "+" chip makes: store an upload, and delete one. Shared by
 *  the Pattern menu's fill rows and the Maps section's no-data pattern row,
 *  because the list is one per chart (`pattern.customPatterns`): a pattern
 *  uploaded from either is selectable from both, and a delete from either
 *  drops every pick of it — the Pattern menu's (`removeCustomPattern`) and
 *  the map's no-data pick (`removeCustomPatternFromMap`), the same pair a
 *  settings patch runs (`settingEffects`). */
export const useCustomPatternEdits = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const setMapConfig = useSetAtom(currentMapConfigAtom)
	const theme = useCurrentTheme()
	const customPatterns = configs.pattern?.customPatterns ?? []
	/** Store an upload in the first free slot, then select it through the
	 *  row's own setter (every target writes its own pick field). Untouched
	 *  pattern fields seed from the THEME's pattern config, as the Pattern
	 *  menu's writes do, so the stored slice keeps matching the changed
	 *  dot's baseline. */
	const addCustomPattern = (p: CustomPattern, select: (idx: number) => void) => {
		const { list, idx } = insertCustomPattern(customPatterns, p)
		setConfigs((prev) => ({
			...prev,
			pattern: {
				...patternConfigFromTheme(theme),
				...prev.pattern,
				customPatterns: list,
			},
		}))
		select(idx)
	}
	const deleteCustomPattern = (slot: number) => {
		setConfigs((prev) => removeCustomPattern(prev, slot))
		setMapConfig((prev) => removeCustomPatternFromMap(prev, slot))
	}
	return { customPatterns, addCustomPattern, deleteCustomPattern }
}
