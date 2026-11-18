import type { ChannelConfigs, CustomPattern, PatternConfig } from "./channelConfig"
import type { MapConfig } from "./mapConfig"

/**
 * The custom-pattern SLOTS and the picks that point into them — the pure
 * half of `lib/customPatterns` (no React, no DOM), so the settings patch
 * (`settingEffects`) and a program outside the editor can apply the same edits the
 * sidebar does.
 *
 * Pattern references stay numeric palette indices tool-wide; an index
 * `i >= CUSTOM_PATTERN_BASE` refers to the chart's
 * `PatternConfig.customPatterns[i - CUSTOM_PATTERN_BASE]`. Every fill
 * pick can hold one: the Pattern menu's per-category and default picks
 * (point, polygon, violin / box, area-point fills) and the map's no-data
 * pattern (`MapConfig.noDataPattern`). The list is one per chart, so a
 * pattern uploaded from any of those pickers is selectable from all.
 */

/** First pattern index that refers into `customPatterns`. A fixed constant
 * far past the built-in palette, so appending a built-in pattern never
 * shifts saved custom references. */
export const CUSTOM_PATTERN_BASE = 1000

export const isCustomPatternIdx = (idx: number): boolean =>
	idx >= CUSTOM_PATTERN_BASE

/** Store `pattern` in the first tombstoned slot (else append) and return the
 * palette index it's now referenced by. Pure — the caller writes `list`
 * back to `PatternConfig.customPatterns`. */
export const insertCustomPattern = (
	existing: ReadonlyArray<CustomPattern | null> | undefined,
	pattern: CustomPattern
): { list: Array<CustomPattern | null>; idx: number } => {
	const list = [...(existing ?? [])]
	let slot = list.indexOf(null)
	if (slot === -1) {
		slot = list.length
		list.push(pattern)
	} else {
		list[slot] = pattern
	}
	return { list, idx: CUSTOM_PATTERN_BASE + slot }
}

/** The per-category pick maps and the no-variable default picks that can
 * reference a custom pattern. */
const PICK_MAP_KEYS = [
	"overrides",
	"polygonOverrides",
	"violinOverrides",
	"areaPointOverrides",
] as const
const PICK_DEFAULT_KEYS = [
	"defaultPolygonPattern",
	"defaultViolinPattern",
	"defaultAreaPointPattern",
] as const

/** Delete the custom pattern in `slot`: tombstone it (never splice, so the
 * other slots' indices stay stable) and drop every pick that pointed at it
 * — those categories / defaults go back to their un-picked state (the
 * auto-cycled or "none" pattern) rather than silently showing something
 * else. The map's no-data pick lives in `MapConfig`: pair this with
 * `removeCustomPatternFromMap`. */
export const removeCustomPattern = (
	configs: ChannelConfigs,
	slot: number
): ChannelConfigs => {
	const pattern = configs.pattern
	if (!pattern?.customPatterns) return configs
	const idx = CUSTOM_PATTERN_BASE + slot
	const next: PatternConfig = {
		...pattern,
		customPatterns: pattern.customPatterns.map((p, i) => (i === slot ? null : p)),
	}
	for (const key of PICK_MAP_KEYS) {
		const map = pattern[key]
		if (!map) continue
		next[key] = Object.fromEntries(
			Object.entries(map).filter(([, v]) => v !== idx)
		) as PatternConfig[typeof key] & {}
	}
	for (const key of PICK_DEFAULT_KEYS) {
		if (pattern[key] === idx) next[key] = null
	}
	return {
		...configs,
		pattern: next,
		...(configs.defaultPattern === idx ? { defaultPattern: null } : {}),
	}
}

/** The map's half of deleting the custom pattern in `slot`: a no-data
 * pattern that pointed at it goes back to none (the solid no-data fill),
 * like the Pattern menu's picks in `removeCustomPattern`. Returns the input
 * when the no-data pick is anything else. */
export const removeCustomPatternFromMap = <M extends Pick<MapConfig, "noDataPattern">>(
	mapConfig: M,
	slot: number
): M =>
	mapConfig.noDataPattern === CUSTOM_PATTERN_BASE + slot
		? { ...mapConfig, noDataPattern: null }
		: mapConfig

/** The slots `before` held a pattern in that `after` no longer does
 * (tombstoned, or cut off the end of the list) — the custom patterns a
 * whole-list write deleted. */
export const deletedCustomPatternSlots = (
	before: ReadonlyArray<CustomPattern | null> | undefined,
	after: ReadonlyArray<CustomPattern | null> | undefined
): number[] => {
	const slots: number[] = []
	;(before ?? []).forEach((p, slot) => {
		if (p && !after?.[slot]) slots.push(slot)
	})
	return slots
}
