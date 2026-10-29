/** Chart settings by the names the editor stores them under, for what
 *  the spec has no key of its own: `{"channelConfigs": {"connection":
 *  {"thickness": 2}}}`. A settings patch is deep-merged into the visual
 *  (lists replace), and checked against the visual it lands on and the
 *  `Visual` type (see settingsProblems). The slices it may touch are the
 *  keys of `Visual` that aren't the chart's identity or a spec key
 *  (tooling/setting-catalog.js), so a setting Nancy adds is settable with
 *  no list to edit here. */

import { newComposedLabelId } from "../dataLabelsSelection"
import type { Visual } from "../types"
import { named, type SpecProblem } from "./chartSpec"
import { SETTING_CATALOG, type SettingKind, type SettingShape, type SettingType } from "./settingCatalog"
import { didYouMean } from "./suggest"

/** The slices a settings patch may touch. */
export const SETTINGS_SLICES: readonly string[] = SETTING_CATALOG.slices

export type SettingsPatch = Partial<Record<keyof Visual, unknown>>

const TYPES = SETTING_CATALOG.types

/** A path as a problem reports it: identifiers dotted, any other key
 *  bracketed (`labelsConfig.hiddenTitles["legend:hue"]`). The catalog's
 *  own keys are always dot form. */
const join = (path: string, key: string): string =>
	/^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}["${key.replace(/["\\]/g, "\\$&")}"]`

/** Each catalog path's own settings (no `*` or `[]`), by parent path. */
const CHILDREN: ReadonlyMap<string, readonly string[]> = (() => {
	const out = new Map<string, string[]>()
	for (const path of Object.keys(TYPES)) {
		const cut = path.lastIndexOf(".")
		if (cut < 0) continue
		const name = path.slice(cut + 1)
		if (name === "*" || name.endsWith("[]")) continue
		const parent = path.slice(0, cut)
		out.set(parent, [...(out.get(parent) ?? []), name])
	}
	return out
})()

/** Whether `bare` is a map keyed by data: any key, each a `*` entry. */
const isMap = (bare: string): boolean => Object.hasOwn(TYPES, `${bare}.*`)

/** The catalog's key for `key` under `bare`: its own path when the types
 *  declare it, else the map's `*` entry when `bare` is keyed by data. */
const catalogKey = (bare: string, key: string): string => {
	const own = `${bare}.${key}`
	return Object.hasOwn(TYPES, own) || !isMap(bare) ? own : `${bare}.*`
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const sameValue = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
	if (!isRecord(a) || !isRecord(b)) return false
	const keys = Object.keys(a)
	return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]))
}

/** Objects keyed by a channel or a part rather than by what a value
 *  means: three or more settings, all of one type
 *  (`legendConfig.swatchSizes`, keyed hue, opacity, shape...). */
const KEYED_OBJECTS: ReadonlySet<string> = new Set(
	[...CHILDREN].flatMap(([parent, names]) => {
		const first = TYPES[`${parent}.${names[0]}`]
		return names.length >= 3 && names.every((n) => sameValue(TYPES[`${parent}.${n}`], first)) ? [parent] : []
	})
)

/** The name a value is judged by (valueProblem): the last real segment, so
 *  an entry of `colors` is judged as one of the colors, and an entry of an
 *  object keyed by channel by the object's name (the opacity entry of
 *  `swatchSizes` is a size, not an opacity). */
const settingName = (bare: string): string => {
	const parts = bare.split(".")
	const parent = parts.slice(0, -1).join(".")
	const judged = KEYED_OBJECTS.has(parent) ? parts.slice(0, -1) : parts
	return judged.filter((s) => s !== "*").at(-1)?.replace(/\[\]$/, "") ?? ""
}

const kindOf = (v: unknown): string =>
	v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "object" ? "object" : typeof v

/** Settings the renderer no longer reads, with what to use instead. */
const IGNORED: Readonly<Record<string, string>> = {
	"legendConfig.enabled": `the legend ignores this; hide it per encoding with {"legendConfig": {"hidden": {"hue": true}}}`,
}

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
const COLOR = /(colou?r|colou?rs|colou?roverrides|inkcolors)$/i
const CSS_COLOR =
	/^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent|none|currentcolor|white|black|gray|grey|silver|red|maroon|orange|yellow|olive|lime|green|teal|aqua|cyan|blue|navy|purple|fuchsia|magenta|pink|brown)$/i
const FIELD = /(^fields?|Fields?)$/

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
		if (COLOR.test(name) && !CSS_COLOR.test(value.trim())) return `"${named(value)}" isn't a color; use a hex color like "#1f77b4"`
		if (FIELD.test(name) && fields && !fields.includes(value)) {
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

/** Whether a list's entries are keyed by an `id` the editor updates and
 *  removes them by. */
const keyedById = (bare: string): boolean => SETTING_CATALOG.required[bare]?.includes("id") ?? false

const idOf = (entry: unknown): string | undefined =>
	isRecord(entry) && typeof entry.id === "string" ? entry.id : undefined

/** Problems with a patch against the visual it would change: every key
 *  must be a setting the visual or the `Visual` type has, and every value
 *  the declared type (the stored value's, for a setting the type doesn't
 *  describe), and a sensible value for its kind (valueProblem). An entry of
 *  a list keyed by id keeps an id the chart already has (or a field's
 *  name, which the editor's default labels use), once per list; a new
 *  entry leaves `id` out and gets one. `fallback` (a new visual's draft)
 *  supplies settings a stored visual predates; `fields`, the data's field
 *  names, checks settings naming a field. */
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
	/** A list replaces the stored one, so each object entry is checked
	 *  whole: the fields every entry needs, then each field like a
	 *  setting. */
	const listEntries = (value: unknown[], ref: unknown, path: string, bare: string) => {
		const at = `${bare}[]`
		const fieldsOfEntry = CHILDREN.get(at) ?? []
		if (fieldsOfEntry.length === 0) return
		const byId = keyedById(bare)
		const stored = Array.isArray(ref) ? ref : []
		const seen = new Map<string, number>()
		const must = (SETTING_CATALOG.required[bare] ?? []).filter((k) => !(byId && k === "id"))
		value.forEach((entry, i) => {
			if (!isRecord(entry)) return
			const where = `${path}[${i}]`
			const missing = must.filter((k) => !Object.hasOwn(entry, k))
			if (missing.length > 0) {
				problems.push({ path: where, message: `each entry needs ${missing.map((k) => `"${k}"`).join(", ")}` })
			}
			const id = idOf(entry)
			if (byId && id !== undefined) {
				const first = seen.get(id)
				if (first !== undefined) {
					problems.push({ path: join(where, "id"), message: `entry ${first} has this id too; each entry needs its own (leave "id" out of a new one)` })
				} else {
					seen.set(id, i)
				}
				if (!stored.some((e) => idOf(e) === id) && !fields?.includes(id)) {
					problems.push({ path: join(where, "id"), message: `no entry with id "${named(id)}" on this chart; leave "id" out of a new entry and one is made for it` })
				}
			}
			const own = byId && id !== undefined ? stored.find((e) => idOf(e) === id) : undefined
			entryKeys(entry, own, where, at, fieldsOfEntry)
		})
	}
	const entryKeys = (entry: Record<string, unknown>, own: unknown, path: string, bare: string, names: readonly string[]) => {
		for (const [k, v] of Object.entries(entry)) {
			const at = join(path, k)
			if (keyProblem(k, at)) continue
			if (!names.includes(k)) {
				problems.push({ path: at, message: `no field "${named(k)}" here${didYouMean(k, names)}` })
				continue
			}
			walk(v, isRecord(own) ? own[k] : undefined, undefined, at, `${bare}.${k}`)
		}
	}
	const walk = (value: unknown, ref: unknown, alt: unknown, path: string, bare: string) => {
		// What the chart already stores is never refused, so a chart read
		// back and sent whole keeps a field a later data version dropped.
		if (ref !== undefined && sameValue(value, ref)) return
		const known = ref !== undefined ? ref : alt
		if (Object.hasOwn(IGNORED, bare)) {
			problems.push({ path, message: IGNORED[bare] ?? "" })
			return
		}
		const declared = TYPES[bare]
		if (declared !== undefined) {
			const found = typeProblems(value, declared, path, settingName(bare), fields)
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
			listEntries(value, ref, path, bare)
			return
		}
		if (!isRecord(value)) return
		const own = isRecord(ref) ? ref : {}
		const other = isRecord(alt) ? alt : {}
		const declaredChildren = CHILDREN.get(bare) ?? []
		const map = isMap(bare)
		for (const [k, v] of Object.entries(value)) {
			const at = join(path, k)
			if (keyProblem(k, at)) continue
			if (/^channelConfigs\.[xy]$/.test(bare) && (k === "min" || k === "max")) {
				problems.push({ path: at, message: `set axis bounds with the spec's "axes" key, e.g. {"axes": {"${bare.slice(-1)}": {"${k}": 0}}}` })
			} else if (map || Object.hasOwn(own, k) || Object.hasOwn(other, k) || declaredChildren.includes(k)) {
				walk(v, own[k], other[k], at, catalogKey(bare, k))
			} else {
				const names = [...new Set([...Object.keys(own), ...Object.keys(other), ...declaredChildren])]
				problems.push({ path: at, message: `no setting "${named(k)}" here${didYouMean(k, names)}` })
			}
		}
	}
	for (const [slice, value] of Object.entries(patch)) {
		if (!SETTINGS_SLICES.includes(slice)) {
			problems.push({
				path: join("settings", slice),
				message: `"${named(slice)}" isn't a settings slice; use ${SETTINGS_SLICES.join(", ")}, or the spec's own keys for name, folder, encodings, field types and theme`,
			})
			continue
		}
		if (!isRecord(value) || Object.keys(value).length === 0) {
			problems.push({ path: join("settings", slice), message: `"${slice}" must be an object naming at least one setting` })
			continue
		}
		const key = slice as keyof Visual
		walk(value, visual[key], fallback?.[key], join("settings", slice), slice)
	}
	return problems
}

/** The shape `value` best fits at `bare`, with the members it lacks: of
 *  the shapes its tags allow (all of them when none do), the one it lacks
 *  least of. Only an object whose every shape is picked by a tag, as a
 *  hue's `kind` picks its members, is judged: the editor reads an untagged
 *  config over its defaults (`{...DEFAULT_FACET_CONFIG, ...facet}`), so
 *  part of one is whole to it. */
const bestShape = (value: Record<string, unknown>, bare: string): { shape: SettingShape; lacks: string[] } | undefined => {
	const shapes = SETTING_CATALOG.shapes[bare]
	if (!shapes || !shapes.every((s) => Object.keys(s.tags).length > 0)) return undefined
	const tagged = shapes.filter((s) => Object.entries(s.tags).every(([k, v]) => !Object.hasOwn(value, k) || value[k] === v))
	let best: { shape: SettingShape; lacks: string[] } | undefined
	for (const shape of tagged.length > 0 ? tagged : shapes) {
		const lacks = shape.must.filter((k) => !Object.hasOwn(value, k) || value[k] === undefined)
		if (!best || lacks.length < best.lacks.length) best = { shape, lacks }
	}
	return best
}

/** Problems with the objects a patch names, as they stand once it is
 *  merged and completed (`after`): each tagged one must have what the
 *  shape its tags pick needs (a categorical hue needs its colors). A member
 *  the chart's own object (`before`) of that shape lacks too is let be, so
 *  a chart stored before a member was added stays editable. A list entry
 *  is checked whole by settingsProblems; the objects inside it here. */
export const shapeProblems = (patch: SettingsPatch, before: Visual, after: Visual): SpecProblem[] => {
	const problems: SpecProblem[] = []
	const visit = (sent: unknown, was: unknown, now: unknown, path: string, bare: string) => {
		if (Array.isArray(sent)) {
			if (!Array.isArray(now)) return
			const stored = Array.isArray(was) ? was : []
			now.forEach((entry, i) => {
				const id = idOf(entry)
				const own = id === undefined ? undefined : stored.find((e) => idOf(e) === id)
				visit(sent[i], own, entry, `${path}[${i}]`, `${bare}[]`)
			})
			return
		}
		if (!isRecord(sent) || !isRecord(now)) return
		const prior = isRecord(was) ? was : {}
		for (const [k, v] of Object.entries(sent)) visit(v, prior[k], now[k], join(path, k), catalogKey(bare, k))
		if (bare.endsWith("[]")) return
		const best = bestShape(now, bare)
		if (!best) return
		const { shape } = best
		const sameShape = isRecord(was) && Object.entries(shape.tags).every(([k, v]) => was[k] === v)
		const lacks = sameShape ? best.lacks.filter((k) => Object.hasOwn(prior, k)) : best.lacks
		if (lacks.length === 0) return
		const tags = Object.entries(shape.tags).map(([k, v]) => `"${k}" is "${v}"`)
		problems.push({
			path,
			message: `this setting needs ${lacks.map((k) => `"${k}"`).join(", ")}${tags.length > 0 ? ` when ${tags.join(" and ")}` : ""}`,
		})
	}
	for (const [slice, value] of Object.entries(patch)) {
		const key = slice as keyof Visual
		visit(value, before[key], after[key], join("settings", slice), slice)
	}
	return problems
}

/** `visual` with each object a patch names passed through `complete`,
 *  innermost first, with its catalog path. */
export const completeSettings = (
	visual: Visual,
	patch: SettingsPatch,
	complete: (value: Record<string, unknown>, bare: string) => Record<string, unknown>
): Visual => {
	const visit = (sent: unknown, now: unknown, bare: string): unknown => {
		if (Array.isArray(sent) && Array.isArray(now)) return now.map((e, i) => visit(sent[i], e, `${bare}[]`))
		if (!isRecord(sent) || !isRecord(now)) return now
		const out = { ...now }
		for (const k of Object.keys(sent)) {
			if (Object.hasOwn(now, k)) out[k] = visit(sent[k], now[k], catalogKey(bare, k))
		}
		return complete(out, bare)
	}
	const out = { ...visual } as Record<string, unknown>
	for (const [slice, value] of Object.entries(patch)) out[slice] = visit(value, out[slice], slice)
	return out as Visual
}

/** Whether the object at `bare` is a hue config: the shapes the main
 *  Color encoding's `hue` takes. */
export const isHueConfig = (bare: string): boolean =>
	sameValue(SETTING_CATALOG.shapes[bare], SETTING_CATALOG.shapes["channelConfigs.hue"])

/** An id for a new entry of the list at `bare`, made the way the editor
 *  makes one. */
const newEntryId = (bare: string): string =>
	bare === "dataLabelsConfig.composedLabels"
		? newComposedLabelId()
		: `${settingName(bare)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** Makes an id for a new entry of the list at a catalog path, or leaves
 *  it to `newEntryId` (undefined). */
export type NewId = (path: string) => string | undefined

/** `value` with an id given to each new entry (one without an id) of a
 *  list keyed by id, wherever such a list sits in it. */
const withNewIds = (value: unknown, bare: string, newId?: NewId): unknown => {
	if (Array.isArray(value)) {
		if (!keyedById(bare)) return value
		return value.map((e) => (isRecord(e) && e.id === undefined ? { id: newId?.(bare) ?? newEntryId(bare), ...e } : e))
	}
	if (!isRecord(value)) return value
	return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withNewIds(v, catalogKey(bare, k), newId)]))
}

const deepMerge = (base: unknown, patch: unknown): unknown => {
	if (!isRecord(base) || !isRecord(patch)) return patch
	const out: Record<string, unknown> = { ...base }
	for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v)
	return out
}

/** The visual with a checked patch merged in; a new entry of a list keyed
 *  by id gets its id here. */
export const applySettings = (visual: Visual, patch: SettingsPatch, newId?: NewId): Visual => {
	const out = { ...visual } as Record<string, unknown>
	for (const [slice, value] of Object.entries(patch)) out[slice] = deepMerge(out[slice], withNewIds(value, slice, newId))
	return out as Visual
}

/** One setting a patch can name. `path` is dot form in the catalog's
 *  rows, where `*` stands for any key of a map keyed by data and `[]` for
 *  a list's elements; a visual's own entries of such a map get rows of
 *  their own with the concrete path (`channelConfigs.hue.colors.East`)
 *  and the catalog path they fall under as `setting`. `value` is the
 *  visual's, when one was asked for and it stores one. */
export type SettingRow = {
	path: string
	setting?: string
	type: string
	values?: string[]
	doc?: string
	value?: unknown
}

const rowOf = (path: string, setting: string): SettingRow => {
	const t = TYPES[setting]
	const doc = SETTING_CATALOG.docs[setting]
	return {
		path,
		...(setting !== path ? { setting } : {}),
		type: t ? kindsText(t) : "",
		...(t?.values ? { values: t.values } : {}),
		...(doc ? { doc } : {}),
	}
}

/** Every setting a patch can name, from the catalog, with `visual`'s own
 *  values when given: a stored value on its setting's row, and a row per
 *  stored entry of a map keyed by data. */
export const settingRows = (visual?: Visual): SettingRow[] => {
	const rows = new Map<string, SettingRow>()
	for (const path of Object.keys(TYPES)) {
		if (!Object.hasOwn(IGNORED, path)) rows.set(path, rowOf(path, path))
	}
	if (visual) {
		/** A stored value: on its own row when it is a declared setting
		 *  that holds values, its entries walked when it is an object. */
		const visit = (value: unknown, path: string, bare: string) => {
			if (value === undefined || Object.hasOwn(IGNORED, bare)) return
			const kinds = TYPES[bare]?.kinds ?? []
			if (isRecord(value) && (kinds.length === 0 || kinds.includes("object"))) {
				for (const [k, v] of Object.entries(value)) visit(v, join(path, k), catalogKey(bare, k))
				return
			}
			if (!Object.hasOwn(TYPES, bare)) return
			// A declared setting's value goes on its catalog row; an entry of a
			// map keyed by data gets a row of its own.
			const at = bare.includes("*") ? path : bare
			rows.set(at, { ...(rows.get(at) ?? rowOf(at, bare)), value })
		}
		for (const slice of SETTINGS_SLICES) visit(visual[slice as keyof Visual], slice, slice)
	}
	return [...rows.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
}
