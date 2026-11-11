/** Settings search for list_settings: everyday words over the setting
 * catalog (`settingCatalog.json`), ranked and paged so one call stays small.
 * Pure: no I/O.
 *
 * A path and its doc are split into word tokens (dots, brackets, `*`,
 * camelCase), each folded to a singular and through a small synonym table,
 * so "colours" meets `color` and "average" meets `markMean`. Every query
 * word is required (in any order) except the toggle words ("show", "turn
 * on", "the", …), which only rank. A word matches a whole token, or the
 * start of one when it is four letters or more; never the middle ("round"
 * never finds "background"). */

import { SETTING_CATALOG, type SettingEntry } from "../../src/contexts/chartBuilder/lib/applySettings"
import { didYouMean } from "../../src/contexts/chartBuilder/lib/didYouMean"
import type { Visual } from "../../src/contexts/chartBuilder/lib/types"

export type SettingSearchOptions = {
	/** Everyday words. */
	query?: string
	/** Page start, default 0. */
	offset?: number
	/** Full doc text instead of the 100-character cut. */
	descriptions?: boolean
	/** A chart: each row carries its current value. */
	visual?: Visual
}

export type SettingSearchRow = {
	path: string
	type: string
	values?: string[]
	doc?: string
	value?: unknown
	valueOmitted?: true
}

export type SettingSearchResult = {
	/** Rows matching (all pages). */
	total: number
	offset: number
	/** Offset of the next page, null on the last. */
	next: number | null
	rows: SettingSearchRow[]
	/** Query words no returned row matched (partial matches). */
	missed?: string[]
	/** When nothing matched at all: the nearest vocabulary word. */
	closest?: string
	/** Only when no query: no rows, a census of groups. */
	census?: Array<{ group: string; count: number }>
}

export const SETTINGS_PAGE_SIZE = 12
/** Enums with at most this many options list them on the row. */
const SHORT_ENUM = 8
const DOC_CUT = 100
/** A current value whose JSON is longer than this is left out. */
const VALUE_CAP = 300
/** Slices with more paths than this split one level deeper in the census. */
const CENSUS_SPLIT = 400
/** Second-level groups smaller than this fold into their slice's rest. */
const CENSUS_MIN = 10
/** Score lost per `*` (a per-key map): its keys must be known first. */
const STAR_COST = 6
/** Score lost by a setting its doc calls retired: nothing reads it. */
const RETIRED_COST = 40

/** Words that say what to do with a setting, not which: they rank, never
 *  exclude. */
const TOGGLE_WORDS = new Set([
	"show", "hide", "on", "off", "enable", "disable", "turn", "display", "add", "remove",
	"set", "change", "make", "the", "a", "an", "of", "to", "in", "for", "with", "and", "my", "is",
])

/** Spellings folded to one token on BOTH sides (query and index). */
const ALIASES: Record<string, string> = {
	colour: "color",
	grey: "gray",
	centre: "center",
	average: "mean",
	avg: "mean",
	axe: "axis",
	axes: "axis",
	opaque: "opacity",
	transparency: "opacity",
	transparent: "opacity",
	percentage: "percent",
	heading: "title",
	headline: "title",
	hover: "tooltip",
	popup: "tooltip",
	bg: "background",
	marker: "point",
	dot: "point",
	rotate: "angle",
	rotation: "angle",
	placement: "position",
	location: "position",
	visible: "visibility",
	gridline: "grid",
}

/** A query word also accepts these tokens (scored a little below the word
 *  itself). Index tokens are not expanded. */
const EXPANSIONS: Record<string, string[]> = {
	text: ["font"],
	font: ["text"],
	axis: ["x", "y", "r"],
	color: ["hue"],
	border: ["outline", "stroke"],
	outline: ["border", "stroke"],
	stroke: ["outline", "border"],
	thickness: ["width"],
	spacing: ["gap", "padding"],
	gap: ["spacing", "padding"],
	decimal: ["format"],
	dashed: ["dash"],
	dotted: ["dash"],
	visibility: ["enabled", "show", "hidden"],
	bold: ["weight"],
	size: ["width", "radius"],
	value: ["label"],
}

/** Toggle words rank a setting that switches something on or off. */
const SWITCH_TOKENS = ["enabled", "show", "hidden", "visibility"]
const SWITCH_WORDS = new Set(["show", "hide", "enable", "disable", "display", "turn", "on", "off"])

const singular = (w: string): string => {
	if (w.length <= 3) return w
	if (w === "series" || w === "species") return w
	if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`
	if (/(?:sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2)
	if (/(?:ss|is|us|as)$/.test(w)) return w
	return w.endsWith("s") ? w.slice(0, -1) : w
}

/** One word as the index stores it: lowercase, singular, aliased. */
const normalize = (w: string): string => {
	const lower = w.toLowerCase()
	const direct = ALIASES[lower]
	if (direct) return direct
	const one = singular(lower)
	return ALIASES[one] ?? one
}

/** Raw word tokens of a path or prose, camelCase split, lowercase. */
const rawTokens = (text: string): string[] =>
	text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t !== "")

type Indexed = {
	path: string
	entry: SettingEntry
	pathTokens: Set<string>
	docTokens: Set<string>
	depth: number
	/** Score lost: per `*` segment, and for a retired setting. */
	cost: number
}

let index: Indexed[] | null = null
let vocabulary: string[] | null = null

const buildIndex = (): Indexed[] => {
	if (index) return index
	const vocab = new Set<string>(Object.keys(ALIASES))
	index = Object.entries(SETTING_CATALOG.paths).map(([path, entry]) => {
		const raw = rawTokens(path)
		for (const t of raw) vocab.add(t)
		return {
			path,
			entry,
			pathTokens: new Set(raw.map(normalize)),
			docTokens: new Set(rawTokens(entry.doc ?? "").map(normalize)),
			depth: path.split(/\.|\[\]/).filter((s) => s !== "").length,
			cost:
				STAR_COST * (path.split("*").length - 1) +
				(/^(?:Retired|Deprecated|Legacy)\b/i.test(entry.doc ?? "") ? RETIRED_COST : 0),
		}
	})
	vocabulary = [...vocab].filter((t) => t.length > 1 && !/^\d+$/.test(t))
	return index
}

/** How well `word` (with its expansions) hits one row; 0 = not at all. */
const hitScore = (word: string, row: Indexed): { score: number; inPath: boolean } => {
	const alts = EXPANSIONS[word] ?? []
	if (row.pathTokens.has(word)) return { score: 100, inPath: true }
	if (alts.some((a) => row.pathTokens.has(a))) return { score: 90, inPath: true }
	const prefixOk = word.length >= 4
	if (prefixOk) for (const t of row.pathTokens) if (t.startsWith(word)) return { score: 55, inPath: true }
	if (row.docTokens.has(word)) return { score: 20, inPath: false }
	if (alts.some((a) => row.docTokens.has(a))) return { score: 18, inPath: false }
	if (prefixOk) for (const t of row.docTokens) if (t.startsWith(word)) return { score: 10, inPath: false }
	return { score: 0, inPath: false }
}

/** The first sentence, cut to `DOC_CUT` characters at a word boundary. */
const shortDoc = (doc: string): string => {
	const flat = doc.replace(/\s+/g, " ").trim()
	const end = flat.search(/[.!?](?=\s+[A-Z(`"]|$)/)
	const sentence = end === -1 ? flat : flat.slice(0, end + 1)
	if (sentence.length <= DOC_CUT) return sentence
	const room = sentence.slice(0, DOC_CUT - 1)
	const space = room.lastIndexOf(" ")
	return `${(space > 40 ? room.slice(0, space) : room).replace(/[\s,;:(]+$/, "")}…`
}

const scalarType = (t: SettingEntry, kind: string): string => {
	if (kind !== "string") return kind
	if (t.color) return "color"
	if (t.format) return "format"
	if (t.values) return t.values.length > SHORT_ENUM ? `enum(${t.values.length})` : "enum"
	return "string"
}

/** A compact kind: "number|null", "color", "enum", "string[]", … */
const typeString = (entry: SettingEntry): string => {
	const kinds = entry.kinds ?? []
	if (kinds.length === 0) return "any"
	const parts = kinds
		.filter((k) => k !== "null")
		.map((k) => {
			if (k !== "list") return scalarType(entry, k)
			const items = entry.items
			const inner = items?.kinds?.filter((ik) => ik !== "null").map((ik) => scalarType(items, ik)) ?? []
			return inner.length === 1 ? `${inner[0]}[]` : "list"
		})
	if (kinds.includes("null")) parts.push("null")
	return parts.join("|")
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

/** The value at `segments` under `at`; a `[]` segment maps over the list. */
const walk = (at: unknown, segments: string[]): unknown => {
	if (segments.length === 0) return at
	const [head, ...rest] = segments
	if (head === "[]") return Array.isArray(at) ? at.map((item) => walk(item, rest)) : undefined
	return isObj(at) ? walk(at[head], rest) : undefined
}

/** The chart's current value at a catalog path. A `*` path gives the map
 *  above its first `*`; a `[]` path, one entry per list item. */
const valueAt = (visual: Visual, path: string): unknown => {
	const star = path.indexOf("*")
	const upTo = star === -1 ? path : path.slice(0, star).replace(/\.$/, "")
	const segments = upTo.replace(/\[\]/g, ".[]").split(".").filter((s) => s !== "")
	return walk(visual, segments)
}

const toRow = (item: Indexed, opts: SettingSearchOptions): SettingSearchRow => {
	const { entry } = item
	const row: SettingSearchRow = { path: item.path, type: typeString(entry) }
	if (entry.values && (opts.descriptions || entry.values.length <= SHORT_ENUM)) row.values = entry.values
	if (entry.doc) row.doc = opts.descriptions ? entry.doc : shortDoc(entry.doc)
	if (opts.visual) {
		const value = valueAt(opts.visual, item.path)
		if (value !== undefined) {
			const json = JSON.stringify(value)
			if (json !== undefined && json.length > VALUE_CAP) row.valueOmitted = true
			else row.value = value
		}
	}
	return row
}

/** Group → path count: slices, and the big ones one level deeper. */
const censusOf = (): Array<{ group: string; count: number }> => {
	const bySlice = new Map<string, string[]>()
	for (const path of Object.keys(SETTING_CATALOG.paths)) {
		const slice = path.split(/[.[]/)[0]
		const list = bySlice.get(slice) ?? []
		list.push(path)
		bySlice.set(slice, list)
	}
	const out: Array<{ group: string; count: number }> = []
	for (const slice of SETTING_CATALOG.slices) {
		const paths = bySlice.get(slice) ?? []
		if (paths.length <= CENSUS_SPLIT) {
			out.push({ group: slice, count: paths.length })
			continue
		}
		const sub = new Map<string, number>()
		for (const p of paths) {
			const second = p.split(/[.[]/)[1]
			if (second !== undefined) sub.set(second, (sub.get(second) ?? 0) + 1)
		}
		let rest = paths.length
		for (const [name, count] of [...sub].sort((a, b) => b[1] - a[1])) {
			if (count < CENSUS_MIN) continue
			out.push({ group: `${slice}.${name}`, count })
			rest -= count
		}
		if (rest > 0) out.push({ group: `${slice} (rest)`, count: rest })
	}
	return out
}

/** The nearest vocabulary word to `word`, if any is close. */
const closestWord = (word: string): string | undefined => {
	buildIndex()
	const hint = didYouMean(word, vocabulary ?? [])
	return /"(.*)"/.exec(hint)?.[1]
}

/** One page of `rows`. */
const pageOf = (rows: Indexed[], offset: number, opts: SettingSearchOptions): SettingSearchResult => {
	const page = rows.slice(offset, offset + SETTINGS_PAGE_SIZE)
	const end = offset + page.length
	return {
		total: rows.length,
		offset,
		next: end < rows.length ? end : null,
		rows: page.map((row) => toRow(row, opts)),
	}
}

export const searchSettings = (opts: SettingSearchOptions): SettingSearchResult => {
	const offset = Math.max(0, Math.floor(opts.offset ?? 0))
	const words = (opts.query ?? "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w !== "")
	if (words.length === 0)
		return { total: Object.keys(SETTING_CATALOG.paths).length, offset: 0, next: null, rows: [], census: censusOf() }

	// A catalog path or group (`legendConfig`, `channelConfigs.x`): the rows
	// under it, shallowest first.
	const asPath = (opts.query ?? "").trim()
	if (/^[A-Za-z][\w.:*[\]-]*$/.test(asPath) && /[A-Z.]/.test(asPath)) {
		const under = buildIndex()
			.filter((r) => r.path === asPath || r.path.startsWith(`${asPath}.`) || r.path.startsWith(`${asPath}[`))
			.sort((a, b) => a.depth - b.depth || a.path.length - b.path.length || (a.path < b.path ? -1 : 1))
		if (under.length > 0) return pageOf(under, offset, opts)
	}

	// Required words (deduped, normalized), keeping the user's spelling for
	// `missed`; with nothing but toggle words, those are the query.
	const toggles = words.filter((w) => TOGGLE_WORDS.has(w))
	const plain = words.filter((w) => !TOGGLE_WORDS.has(w))
	const spoken = new Map<string, string>()
	for (const w of plain.length > 0 ? plain : toggles) if (!spoken.has(normalize(w))) spoken.set(normalize(w), w)
	const required = [...spoken.keys()]
	const optional = plain.length > 0 ? [...new Set(toggles.map(normalize))] : []

	const scored = buildIndex().map((row) => {
		let score = 0
		let pathHits = 0
		const hit: boolean[] = []
		for (const w of required) {
			const h = hitScore(w, row)
			hit.push(h.score > 0)
			score += h.score
			if (h.inPath) pathHits++
		}
		for (const w of optional) {
			const h = hitScore(w, row)
			const switches = SWITCH_WORDS.has(w) && SWITCH_TOKENS.some((t) => row.pathTokens.has(t))
			score += h.inPath || switches ? 6 : h.score > 0 ? 2 : 0
			// The plain on/off switch outranks hiding one part.
			if (SWITCH_WORDS.has(w) && row.pathTokens.has("enabled")) score += 1
		}
		score -= row.cost
		return { row, score, pathHits, hit, count: hit.filter(Boolean).length }
	})

	let best = 0
	for (const s of scored) if (s.count > best) best = s.count
	if (best === 0) {
		const unknown = required.find((w) => !scored.some((s) => s.hit[required.indexOf(w)]))
		const closest = closestWord(spoken.get(unknown ?? required[0]) ?? required[0])
		return { total: 0, offset, next: null, rows: [], ...(closest ? { closest } : {}) }
	}

	const matched = scored
		.filter((s) => s.count === best)
		.sort(
			(a, b) =>
				b.pathHits - a.pathHits ||
				b.score - a.score ||
				a.row.depth - b.row.depth ||
				a.row.path.length - b.row.path.length ||
				(a.row.path < b.row.path ? -1 : a.row.path > b.row.path ? 1 : 0)
		)
	const result = pageOf(
		matched.map((s) => s.row),
		offset,
		opts
	)
	if (best < required.length)
		result.missed = required
			.filter((_, i) => !matched.some((s) => s.hit[i]))
			.map((w) => spoken.get(w) ?? w)
	return result
}
