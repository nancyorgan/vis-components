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

const DASHES = ["solid", "dashed", "dotted", "dash-dot", "blank"]

/** Maps whose keys are data (a level, a field, a legend channel) rather
 *  than setting names, by path, with the type every value must have. Any
 *  key may be added to one; anything else a patch names must already be
 *  a setting. Maps of objects are left out: their entries are edited like
 *  any other setting, and new ones come from the editor. */
const OPEN_MAPS: ReadonlyArray<[RegExp, "string" | "number" | "boolean" | readonly string[]]> = [
	[/^channelConfigs\.[A-Za-z]+\.(colors|colorOverrides|fillColorOverrides|fillOverrides|strokeOverrides|customDashOverrides|inkColors|polygonInkColors|lineColors|dashAlternateColors)$/, "string"],
	[/^channelConfigs\.(area|saturation|brightness|shape)\.overrides$/, "number"],
	[/^channelConfigs\.[A-Za-z]+\.(thicknessByValue|panelOrder)$/, "number"],
	[/^channelConfigs\.[A-Za-z]+\.dashPatterns$/, DASHES],
	[/^dataLabelsConfig\.fieldFormats$/, "string"],
	[/^dataLabelsConfig\.fieldSizes$/, "number"],
	[/^dataLabelsConfig\.fieldAlignments$/, ["left", "center", "right"]],
	[/^dataLabelsConfig\.fieldLabelPoints$/, ["all", "first", "last", "first-last"]],
	[/^dataLabelsConfig\.fieldLabelPointsScope$/, ["series", "group", "stack"]],
	[/^labelsConfig\.(facetTitleColors|legendTitles)$/, "string"],
	[/^legendConfig\.hidden$/, "boolean"],
]

const openMapType = (path: string) => OPEN_MAPS.find(([re]) => re.test(path))?.[1]

/** Problems with a patch against the visual it would change. `fallback`
 *  (a new visual's draft) supplies settings a stored visual predates. */
export const settingsProblems = (patch: unknown, visual: Visual, fallback?: Visual): SpecProblem[] => {
	const problems: SpecProblem[] = []
	if (!isRecord(patch)) {
		return [{ path: "settings", message: `"settings" must be an object of ${SETTINGS_SLICES.join(", ")}` }]
	}
	const walk = (value: unknown, ref: unknown, alt: unknown, path: string, bare: string) => {
		const known = ref !== undefined ? ref : alt
		if (known === null) return
		if (value === null) {
			problems.push({ path, message: `this setting can't be null; it is a ${kindOf(known)}` })
			return
		}
		if (kindOf(value) !== kindOf(known)) {
			problems.push({ path, message: `this setting is a ${kindOf(known)}, not a ${kindOf(value)}` })
			return
		}
		if (!isRecord(value) || !isRecord(known)) return
		const open = openMapType(bare)
		const own = isRecord(ref) ? ref : {}
		const other = isRecord(alt) ? alt : {}
		for (const [k, v] of Object.entries(value)) {
			const at = join(path, k)
			if (k === "__proto__" || k === "constructor" || k === "prototype") {
				problems.push({ path: at, message: `"${k}" can't be used as a key` })
			} else if (open !== undefined) {
				const ok = Array.isArray(open) ? typeof v === "string" && open.includes(v) : typeof v === open
				if (!ok) {
					problems.push({
						path: at,
						message: Array.isArray(open)
							? `must be one of ${open.map((o) => `"${o}"`).join(", ")}`
							: `this setting is a ${open}, not a ${kindOf(v)}`,
					})
				}
			} else if (Object.hasOwn(own, k) || Object.hasOwn(other, k)) {
				walk(v, own[k], other[k], at, join(bare, k))
			} else {
				const names = [...new Set([...Object.keys(own), ...Object.keys(other)])]
				const axisBound = /^channelConfigs\.[xy]$/.test(bare) && (k === "min" || k === "max")
				problems.push({
					path: at,
					message: axisBound
						? `set axis bounds with the spec's "axes" key, e.g. {"axes": {"${bare.slice(-1)}": {"${k}": 0}}}`
						: `no setting "${named(k)}" here${didYouMean(k, names)}`,
				})
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
		if (!isRecord(value) || Object.keys(value).length === 0) {
			problems.push({ path: pathOf("settings", slice), message: `"${slice}" must be an object naming at least one setting` })
			continue
		}
		const key = slice as SettingsSlice
		walk(value, visual[key], fallback?.[key], join("settings", slice), slice)
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
		if (value === undefined) return
		if (isRecord(value) && Object.keys(value).length > 0 && !openMapType(path)) {
			for (const [k, v] of Object.entries(value)) walk(v, join(path, k))
			return
		}
		rows.push({ path, type: openMapType(path) ? "map" : kindOf(value), value })
	}
	for (const slice of SETTINGS_SLICES) walk(visual[slice], slice)
	return rows
}
