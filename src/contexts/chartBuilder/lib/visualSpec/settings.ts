/** Chart settings by the names the editor stores them under, for what
 *  the spec has no key of its own: `{"channelConfigs": {"connection":
 *  {"thickness": 2}}}`. A settings patch is deep-merged into the visual
 *  (lists replace), and checked against the visual it lands on: every
 *  key must already exist there, and every value must have the type the
 *  stored one has. */

import type { Visual } from "../types"
import { named, pathOf, type SpecProblem } from "./chartSpec"
import { didYouMean } from "./suggest"

/** The slices a settings patch may touch. Encodings, annotations, level
 *  orders, reshape and derived variables have spec keys of their own. */
export const SETTINGS_SLICES = [
	"channelConfigs",
	"labelsConfig",
	"legendConfig",
	"tooltipConfig",
	"dataLabelsConfig",
	"captionConfig",
	"mapConfig",
] as const

export type SettingsSlice = (typeof SETTINGS_SLICES)[number]

export type SettingsPatch = Partial<Record<SettingsSlice, Record<string, unknown>>>

const join = (path: string, key: string): string =>
	/^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}["${key.replace(/["\\]/g, "\\$&")}"]`

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const kindOf = (v: unknown): string =>
	v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "object" ? "object" : typeof v

/** An object whose keys are data (a level, a field, a channel) rather
 *  than setting names: the empty maps a new visual starts with, such as
 *  `hue.colors` or `fieldFormats`. Any key may be added to one. */
const isOpenMap = (v: Record<string, unknown>): boolean => Object.keys(v).length === 0

/** Problems with a patch against the visual it would change. */
export const settingsProblems = (patch: unknown, visual: Visual): SpecProblem[] => {
	const problems: SpecProblem[] = []
	if (!isRecord(patch)) {
		return [{ path: "settings", message: `"settings" must be an object of ${SETTINGS_SLICES.join(", ")}` }]
	}
	const walk = (value: unknown, ref: unknown, path: string) => {
		if (ref === null) return
		if (value === null) {
			problems.push({ path, message: `this setting can't be null; it is a ${kindOf(ref)}` })
			return
		}
		if (kindOf(value) !== kindOf(ref)) {
			problems.push({ path, message: `this setting is a ${kindOf(ref)}, not a ${kindOf(value)}` })
			return
		}
		if (!isRecord(value) || !isRecord(ref)) return
		const open = isOpenMap(ref)
		for (const [k, v] of Object.entries(value)) {
			const at = join(path, k)
			if (k === "__proto__") {
				problems.push({ path: at, message: `"__proto__" can't be used as a key` })
			} else if (Object.hasOwn(ref, k)) {
				walk(v, ref[k], at)
			} else if (!open) {
				problems.push({ path: at, message: `no setting "${named(k)}" here${didYouMean(k, Object.keys(ref))}` })
			}
		}
	}
	for (const [slice, value] of Object.entries(patch)) {
		if (!(SETTINGS_SLICES as readonly string[]).includes(slice)) {
			problems.push({
				path: pathOf("settings", slice),
				message: `"${named(slice)}" isn't a settings slice; use ${SETTINGS_SLICES.join(", ")}, or the spec's own keys for encodings, annotations and orders`,
			})
			continue
		}
		if (!isRecord(value)) {
			problems.push({ path: pathOf("settings", slice), message: `"${slice}" must be an object` })
			continue
		}
		walk(value, visual[slice as SettingsSlice], join("settings", slice))
	}
	return problems
}

const deepMerge = (base: unknown, patch: unknown): unknown => {
	if (!isRecord(base) || !isRecord(patch)) return patch
	const out: Record<string, unknown> = { ...base }
	for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v)
	return out
}

/** The visual with a checked patch merged in. */
export const applySettings = (visual: Visual, patch: SettingsPatch): Visual => {
	const out = { ...visual } as Record<string, unknown>
	for (const [slice, value] of Object.entries(patch)) out[slice] = deepMerge(out[slice], value)
	return out as Visual
}

export type SettingRow = { path: string; type: string; value: unknown }

/** Every leaf setting of the settings slices, as `channelConfigs.x.tickCount`
 *  with its type and value: what a settings patch can name. */
export const flattenSettings = (visual: Visual): SettingRow[] => {
	const rows: SettingRow[] = []
	const walk = (value: unknown, path: string) => {
		if (isRecord(value) && Object.keys(value).length > 0) {
			for (const [k, v] of Object.entries(value)) walk(v, join(path, k))
			return
		}
		rows.push({ path, type: kindOf(value), value })
	}
	for (const slice of SETTINGS_SLICES) walk(visual[slice], slice)
	return rows
}
