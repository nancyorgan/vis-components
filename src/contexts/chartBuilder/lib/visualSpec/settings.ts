/** Chart settings by the names the editor stores them under, for what
 *  the spec has no key of its own: `{"channelConfigs": {"connection":
 *  {"thickness": 2}}}`. A settings patch is deep-merged into the visual
 *  (lists replace), and checked against the visual it lands on and the
 *  config types (see settingsProblems). */

import type { Visual } from "../types"
import { named, pathOf, type SpecProblem } from "./chartSpec"
import { SETTING_CATALOG, type SettingKind, type SettingType } from "./settingCatalog"
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
	[/^channelConfigs\.pattern\.(scales|polygonScales)$/, "number"],
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

/** Settings the renderer no longer reads, with what to use instead. */
const IGNORED: Readonly<Record<string, string>> = {
	"legendConfig.enabled": `the legend ignores this; hide it per encoding with {"legendConfig": {"hidden": {"hue": true}}}`,
}

const openMapType = (path: string) => OPEN_MAPS.find(([re]) => re.test(path))?.[1]

const TYPES = SETTING_CATALOG.types

/** Whole-number settings that size loops in the renderer. */
const COUNTS: Readonly<Record<string, [number, number]>> = {
	tickCount: [0, 1000],
	binCount: [1, 1000],
	count: [0, 1000],
	categoricalTickStride: [1, 1000],
	labelEvery: [1, 1000],
	tickLabelEvery: [1, 1000],
	pointEveryN: [1, 1000],
	cols: [1, 100],
	columns: [1, 100],
	rows: [1, 100],
	decimals: [0, 20],
	degree: [0, 10],
	wrapMaxChars: [0, 10_000],
}
const SIZE = /(width|thickness|size|radius|length|padding|pad[xy]|gap|gappx|height)$/i
const OPACITY = /opacity$/i
const COLOR_NAME = /colou?r$/i
const COLOR_MAP = /(colou?rs|colou?roverrides|inkcolors)$/i
const CSS_COLOR =
	/^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent|none|currentcolor|white|black|gray|grey|silver|red|maroon|orange|yellow|olive|lime|green|teal|aqua|cyan|blue|navy|purple|fuchsia|magenta|pink|brown)$/i

/** A problem with a value the setting's type allows, judged by its name:
 *  counts within bounds, sizes not negative, opacities within 0 to 1,
 *  colors CSS colors, field settings a field of the data. */
const valueProblem = (value: unknown, name: string, fields: readonly string[] | undefined): string | undefined => {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return "must be a finite number"
		const count = Object.hasOwn(COUNTS, name) ? COUNTS[name] : undefined
		if (count && !(Number.isInteger(value) && value >= count[0] && value <= count[1])) {
			return `must be a whole number from ${count[0]} to ${count[1]}`
		}
		if (OPACITY.test(name) && !(value >= 0 && value <= 1)) return "must be from 0 to 1"
		if (SIZE.test(name) && !(value >= 0 && value <= 10_000)) return "must be from 0 to 10000"
	}
	if (typeof value === "string" && value !== "") {
		if (COLOR_NAME.test(name) && !CSS_COLOR.test(value.trim())) return `"${named(value)}" isn't a color; use a hex color like "#1f77b4"`
		if (/Field$/.test(name) && fields && !fields.includes(value)) {
			return `no field "${named(value)}" in the data${didYouMean(value, fields)}`
		}
	}
	return undefined
}

const a = (kind: string): string => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`)

const kindsText = (t: SettingType): string => {
	const kinds = t.kinds
	return kinds.length === 1 ? (kinds[0] ?? "") : `${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}`
}

/** Problems with `value` against a declared type; list elements too. */
const typeProblems = (value: unknown, t: SettingType, path: string, name = "", fields?: readonly string[]): SpecProblem[] => {
	const kind = kindOf(value) as SettingKind
	if (!t.kinds.includes(kind)) {
		return [
			{
				path,
				message:
					kind === "null" ? `this setting can't be null; it is ${a(kindsText(t))}` : `this setting is ${a(kindsText(t))}, not ${a(kind)}`,
			},
		]
	}
	if (kind === "string" && t.values && !t.values.includes(value as string)) {
		return [{ path, message: `must be one of ${t.values.map((o) => `"${o}"`).join(", ")}${didYouMean(value as string, t.values)}` }]
	}
	if (kind === "list" && t.items) {
		const items = t.items
		return (value as unknown[]).flatMap((v, i) => typeProblems(v, items, `${path}[${i}]`, name, fields))
	}
	const problem = valueProblem(value, name, fields)
	return problem === undefined ? [] : [{ path, message: problem }]
}

/** Problems with a patch against the visual it would change: every key
 *  must be a setting the visual or the config types have, and every value
 *  the declared type (the stored value's, for a setting the types don't
 *  describe), and a sensible value for its kind (valueProblem). `fallback`
 *  (a new visual's draft) supplies settings a stored visual predates;
 *  `fields`, the data's field names, checks settings naming a field. */
export const settingsProblems = (
	patch: unknown,
	visual: Visual,
	fallback?: Visual,
	fields?: readonly string[]
): SpecProblem[] => {
	const problems: SpecProblem[] = []
	if (!isRecord(patch)) {
		return [{ path: "settings", message: `"settings" must be an object of ${SETTINGS_SLICES.join(", ")}` }]
	}
	const keyProblem = (k: string, at: string): boolean => {
		if (k === "__proto__" || k === "constructor" || k === "prototype") {
			problems.push({ path: at, message: `"${k}" can't be used as a key` })
			return true
		}
		return false
	}
	/** The object elements of a list replace the stored ones, so each is
	 *  checked against the declared element fields. */
	const listItems = (value: unknown[], path: string, bare: string) => {
		const fields = Object.keys(TYPES)
			.filter((p) => p.startsWith(`${bare}[].`))
			.map((p) => p.slice(bare.length + 3))
		if (fields.length === 0) return
		value.forEach((item, i) => {
			if (!isRecord(item)) return
			for (const [k, v] of Object.entries(item)) {
				const at = join(`${path}[${i}]`, k)
				if (keyProblem(k, at)) continue
				const t = TYPES[`${bare}[].${k}`]
				if (t === undefined) problems.push({ path: at, message: `no field "${named(k)}" here${didYouMean(k, fields)}` })
				else problems.push(...typeProblems(v, t, at, k, fields))
			}
		})
	}
	const walk = (value: unknown, ref: unknown, alt: unknown, path: string, bare: string) => {
		const known = ref !== undefined ? ref : alt
		if (Object.hasOwn(IGNORED, bare)) {
			problems.push({ path, message: IGNORED[bare] ?? "" })
			return
		}
		const declared = TYPES[bare]
		if (declared !== undefined) {
			const found = typeProblems(value, declared, path, bare.slice(bare.lastIndexOf(".") + 1), fields)
			if (found.length > 0) {
				problems.push(...found)
				return
			}
		} else if (known === null) {
			if (isRecord(value) || Array.isArray(value)) {
				problems.push({ path, message: `this setting takes a single value, not ${a(kindOf(value))}` })
			}
			return
		} else if (value === null) {
			problems.push({ path, message: `this setting can't be null; it is ${a(kindOf(known))}` })
			return
		} else if (kindOf(value) !== kindOf(known)) {
			problems.push({ path, message: `this setting is ${a(kindOf(known))}, not ${a(kindOf(value))}` })
			return
		}
		if (Array.isArray(value)) {
			listItems(value, path, bare)
			return
		}
		if (!isRecord(value)) return
		const open = openMapType(bare)
		const own = isRecord(ref) ? ref : {}
		const other = isRecord(alt) ? alt : {}
		const childPrefix = `${bare}.`
		const declaredChildren = Object.keys(TYPES)
			.filter((p) => p.startsWith(childPrefix) && !p.slice(childPrefix.length).includes(".") && !p.includes("[]"))
			.map((p) => p.slice(childPrefix.length))
		for (const [k, v] of Object.entries(value)) {
			const at = join(path, k)
			if (keyProblem(k, at)) continue
			if (/^channelConfigs\.[xy]$/.test(bare) && (k === "min" || k === "max")) {
				problems.push({ path: at, message: `set axis bounds with the spec's "axes" key, e.g. {"axes": {"${bare.slice(-1)}": {"${k}": 0}}}` })
			} else if (open !== undefined) {
				const ok = Array.isArray(open) ? typeof v === "string" && open.includes(v) : typeof v === open
				const colorMap = typeof v === "string" && COLOR_MAP.test(bare) && v !== "" && !CSS_COLOR.test(v.trim())
				if (colorMap) {
					problems.push({ path: at, message: `"${named(v)}" isn't a color; use a hex color like "#1f77b4"` })
				} else if (!ok) {
					problems.push({
						path: at,
						message: Array.isArray(open)
							? `must be one of ${open.map((o) => `"${o}"`).join(", ")}`
							: `this setting is ${a(String(open))}, not ${a(kindOf(v))}`,
					})
				}
			} else if (Object.hasOwn(own, k) || Object.hasOwn(other, k) || declaredChildren.includes(k)) {
				walk(v, own[k], other[k], at, join(bare, k))
			} else {
				const names = [...new Set([...Object.keys(own), ...Object.keys(other), ...declaredChildren])]
				problems.push({ path: at, message: `no setting "${named(k)}" here${didYouMean(k, names)}` })
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

export type SettingRow = { path: string; type: string; value: unknown; unset?: true }

/** Every leaf setting of the settings slices, as `channelConfigs.x.tickCount`
 *  with its type and value: what a settings patch can name. */
export const flattenSettings = (visual: Visual): SettingRow[] => {
	const rows: SettingRow[] = []
	const walk = (value: unknown, path: string) => {
		if (value === undefined || Object.hasOwn(IGNORED, path)) return
		if (isRecord(value) && Object.keys(value).length > 0 && !openMapType(path)) {
			for (const [k, v] of Object.entries(value)) walk(v, join(path, k))
			return
		}
		rows.push({ path, type: openMapType(path) ? "map" : kindOf(value), value })
	}
	for (const slice of SETTINGS_SLICES) walk(visual[slice], slice)
	return rows
}

/** The settings the config types declare that `visual` doesn't store,
 *  as rows with a null value marked `unset`: a patch can still name them. */
export const unsetSettings = (visual: Visual): SettingRow[] => {
	const stored = flattenSettings(visual).map((r) => r.path)
	const has = (path: string) => stored.some((p) => p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[`))
	const covered = (path: string) => stored.some((p) => path.startsWith(`${p}.`))
	const paths = Object.keys(TYPES).filter((p) => !p.includes("[]"))
	const parents = new Set(paths.map((p) => p.slice(0, p.lastIndexOf("."))))
	return paths
		.filter((p) => !parents.has(p) || openMapType(p) !== undefined)
		.filter((p) => !has(p) && !covered(p) && !Object.hasOwn(IGNORED, p))
		.map((p) => ({ path: p, type: openMapType(p) ? "map" : (TYPES[p]?.kinds.filter((k) => k !== "null").join(" or ") ?? ""), value: null, unset: true as const }))
}
