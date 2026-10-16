/** Finding settings by everyday words. Each word is tried, in order,
 *  against the setting's path tokens (split from dots and camelCase: whole
 *  token, then token prefix), the concept words it stands for ("margin"
 *  for padding, offset, gap and inset), its singular, a substring starting
 *  at a token boundary, and last the setting's doc comment. A substring
 *  starting mid-token ("round" in "background") never matches. Toggle
 *  words ("off", "remove", "hide") are optional: they rank a setting that
 *  switches something on or off, but never rule a setting out. When no
 *  setting matches every word, the settings matching the most words are
 *  returned with the words they missed. No query, or no match, returns a
 *  census: how many settings each group holds, and how to narrow.
 *
 *  Docs come from the setting catalog (settingCatalog.ts). A
 *  setting without its own doc comment is searched by its nearest
 *  documented ancestor's; entries of data-keyed maps have none. */

import { stringifyJsonDangerous } from "../../../../lib/json"
import { CHANNELS } from "../channels"
import type { SettingRow } from "./settings"
import { nearestName } from "./suggest"
import { SETTING_CATALOG } from "./settingCatalog"

const SPACE = ["pad", "offset", "inset", "gap"]
const COLOR = ["color"]
const SIZE = ["size", "fontsize", "width", "radius", "thickness"]
const TOGGLE = ["enabled", "hidden", "show"]
const RADIUS = ["radius"]
const TOGGLE_WORDS = ["hide", "show", "off", "on", "no", "none", "remove", "disable", "without"]

/** Everyday words and the setting-name words they stand for, likeliest first. */
export const CONCEPTS: ReadonlyMap<string, readonly string[]> = new Map([
	["margin", SPACE],
	["margins", SPACE],
	["spacing", SPACE],
	["space", SPACE],
	["size", SIZE],
	["bigger", SIZE],
	["larger", SIZE],
	["smaller", SIZE],
	["thicker", ["thickness", "width"]],
	["thinner", ["thickness", "width"]],
	["colour", COLOR],
	["line", ["line", "stroke", "connection"]],
	["lines", ["line", "stroke", "connection"]],
	["grid", ["gridlines"]],
	["round", RADIUS],
	["rounded", RADIUS],
	["corner", RADIUS],
	["corners", RADIUS],
	["bold", ["weight"]],
	["by", ["field"]],
	...TOGGLE_WORDS.map((w): [string, readonly string[]] => [w, TOGGLE]),
	...["white", "black", "gray", "grey", "red", "orange", "yellow", "green", "blue", "purple", "pink", "brown"].map(
		(c): [string, readonly string[]] => [c, COLOR]
	),
])

/** Words that only rank: a setting need not match them. */
const OPTIONAL: ReadonlySet<string> = new Set([...TOGGLE_WORDS, "by"])

/** Words a request carries that name no setting. */
const STOPWORDS = new Set(
	"a an the to of in for and or my this that it its make set change put turn between from with be is are all each every".split(" ")
)

/** Words naming the x, y and r axes as a group. */
const AXIS_WORDS = new Set(["axis", "axes"])
const AXIS_GROUPS = new Set(["x", "y", "r"])

const CHANNEL_NAMES: ReadonlySet<string> = new Set(Object.keys(CHANNELS))

/** Rows past this many characters of JSON are left for the next page. */
export const SETTINGS_BUDGET = 40_000

const docs = SETTING_CATALOG.docs

/** The path without bracketed map keys, as the catalog keys it. */
const plainPath = (path: string): string => path.replace(/\[[^\]]*\]/g, "")

/** The setting's own doc comment. */
export const settingDoc = (path: string): string | undefined => {
	const key = plainPath(path)
	return Object.hasOwn(docs, key) ? docs[key] : undefined
}

/** Its own doc, else the nearest documented ancestor's. */
const searchableDoc = (path: string): string | undefined => {
	const parts = plainPath(path).split(".")
	for (let n = parts.length; n > 0; n--) {
		const doc = settingDoc(parts.slice(0, n).join("."))
		if (doc !== undefined) return doc
	}
	return undefined
}

const splitCamel = (part: string): string[] =>
	part
		.split(/(?<=[a-z0-9])(?=[A-Z])|[^A-Za-z0-9]+/)
		.map((t) => t.toLowerCase())
		.filter(Boolean)

/** `channelConfigs.x.tickLabelAngle` → channel, configs, x, tick, label, angle. */
export const pathTokens = (path: string): string[] => path.split(/[.[\]"]+/).flatMap(splitCamel)

/** channelConfigs.x, otherwise the slice: what a census counts by. */
export const settingGroup = (path: string): string => {
	const parts = plainPath(path).split(".")
	return parts[0] === "channelConfigs" && parts.length > 2 && CHANNEL_NAMES.has(parts[1] ?? "")
		? parts.slice(0, 2).join(".")
		: (parts[0] ?? path)
}

/** What one setting offers a word to match. */
type Target = {
	path: string
	lower: string
	tokens: readonly string[]
	/** Tokens of the last path segment. */
	leaf: ReadonlySet<string>
	/** The channel (x) or slice word (legend) the setting belongs to. */
	group: ReadonlySet<string>
	/** Offsets in `lower` where a token starts. */
	starts: ReadonlySet<number>
	doc: string | undefined
}

const targetOf = (path: string): Target => {
	const parts = plainPath(path).split(".")
	const group =
		parts[0] === "channelConfigs" && CHANNEL_NAMES.has(parts[1] ?? "")
			? [(parts[1] ?? "").toLowerCase()]
			: splitCamel(parts[0] ?? "").filter((t) => t !== "config" && t !== "configs")
	const starts = new Set<number>([0])
	for (let i = 1; i < path.length; i++) {
		const prev = path[i - 1] ?? ""
		const ch = path[i] ?? ""
		if (/[.[\]"]/.test(prev) || (/[a-z0-9]/.test(prev) && /[A-Z]/.test(ch))) starts.add(i)
	}
	return {
		path,
		lower: path.toLowerCase(),
		tokens: pathTokens(path),
		leaf: new Set(splitCamel(parts[parts.length - 1] ?? "")),
		group: new Set(group),
		starts,
		doc: searchableDoc(path),
	}
}

/** One query word, with its description test built once. */
type Word = { word: string; stem: string | undefined; optional: boolean; docTest: RegExp }

const escape = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const wordOf = (word: string): Word => {
	const stem = word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : undefined
	return {
		word,
		stem,
		optional: OPTIONAL.has(word),
		docTest: new RegExp(`\\b${escape(stem ?? word)}`, "i"),
	}
}

type Match = { score: number; via?: string }

/** A whole token, else a token prefix, plus a bonus for the group or leaf token. */
const tokenMatch = (w: string, t: Target, exact: number, prefix: number): Match | undefined => {
	const bonus = (token: string) => (t.group.has(token) ? 0.75 : t.leaf.has(token) ? 0.5 : 0)
	const whole = t.tokens.filter((tok) => tok === w)
	if (whole.length > 0) return { score: exact + Math.max(...whole.map(bonus)) }
	const pre = t.tokens.filter((tok) => tok.startsWith(w))
	if (pre.length > 0) return { score: prefix + Math.max(...pre.map(bonus)) }
	return undefined
}

/** `w` found in the path starting at a token boundary. */
const atBoundary = (w: string, t: Target): boolean => {
	for (let at = t.lower.indexOf(w); at >= 0; at = t.lower.indexOf(w, at + 1)) {
		if (t.starts.has(at)) return true
	}
	return false
}

const matchWord = (w: Word, t: Target): Match | undefined => {
	if (w.word.includes(".")) return atBoundary(w.word, t) ? { score: 3 } : undefined
	const direct = tokenMatch(w.word, t, 3, 2)
	if (direct) return direct
	if (AXIS_WORDS.has(w.word) && [...t.group].some((g) => AXIS_GROUPS.has(g))) {
		return { score: 3.75, via: `${w.word} → ${settingGroup(t.path)}` }
	}
	for (const [rank, alias] of (CONCEPTS.get(w.word) ?? []).entries()) {
		if (t.tokens.some((tok) => tok.startsWith(alias)) || atBoundary(alias, t)) {
			return { score: 1.25 - rank * 0.05, via: `${w.word} → ${alias}` }
		}
	}
	if (w.stem !== undefined) {
		const stemmed = tokenMatch(w.stem, t, 2.9, 1.9)
		if (stemmed) return stemmed
	}
	if (atBoundary(w.word, t)) return { score: 1 }
	if (t.doc !== undefined && w.docTest.test(t.doc)) return { score: 0.5, via: `${w.word} → description` }
	return undefined
}

export type SettingHit = SettingRow & {
	/** Present when a concept word or the description matched. */
	matchedVia?: string[]
	/** Query words this setting did not match, when no setting matched them all. */
	missed?: string[]
	description?: string
	/** The value was too large to send; read it from the chart's stored JSON. */
	valueOmitted?: true
}

export type SettingSearch = {
	scope: "census" | "rows"
	/** Settings matched (a census: settings in all). */
	count: number
	settings: SettingHit[]
	groups?: Array<{ group: string; count: number }>
	returned: number
	truncated: boolean
	nextOffset?: number
	/** What to call next to narrow or continue. */
	next: string
	/** Why a query came back as a census, or only partly matched. */
	message?: string
	/** Query words no setting matched. */
	unmatched?: string[]
	/** Setting words close to the unmatched words. */
	closest?: string[]
}

export type SearchOptions = {
	includeDescriptions?: boolean
	offset?: number
	limit?: number
	budget?: number
}

const census = (rows: readonly SettingRow[]): Array<{ group: string; count: number }> => {
	const counts = new Map<string, number>()
	for (const r of rows) counts.set(settingGroup(r.path), (counts.get(settingGroup(r.path)) ?? 0) + 1)
	return [...counts].map(([group, count]) => ({ group, count }))
}

const CENSUS_NEXT = 'search with words, e.g. "legend position", "gridlines", "font size", or a group name such as "channelConfigs.x"'

/** An empty object names nothing a settings patch can change. */
const isEmptyObject = (r: SettingRow): boolean =>
	r.type === "object" && typeof r.value === "object" && r.value !== null && Object.keys(r.value).length === 0

type Scored = { row: SettingRow; score: number; via: string[]; missed: string[]; i: number }

export const searchSettings = (allRows: readonly SettingRow[], query: string, opts: SearchOptions = {}): SettingSearch => {
	const rows = allRows.filter((r) => !isEmptyObject(r))
	const words = [
		...new Set(
			query
				.toLowerCase()
				.split(/\s+/)
				.filter((w) => w !== "" && !STOPWORDS.has(w) && !/^[\d.%#-]+$/.test(w))
		),
	].map(wordOf)
	const empty = { settings: [], returned: 0, truncated: false }
	if (words.length === 0) {
		return { scope: "census", count: rows.length, groups: census(rows), next: CENSUS_NEXT, ...empty }
	}
	const required = words.filter((w) => !w.optional)
	// A query of toggle words alone is asking for a toggle.
	const must = new Set((required.length > 0 ? required : words).map((w) => w.word))

	const scored: Scored[] = rows.map((row, i) => {
		const t = targetOf(row.path)
		let score = 0
		const via: string[] = []
		const missed: string[] = []
		for (const w of words) {
			const m = matchWord(w, t)
			if (!m) {
				if (must.has(w.word)) missed.push(w.word)
				continue
			}
			score += m.score
			if (m.via) via.push(m.via)
		}
		return { row, score, via, missed, i }
	})
	const unmatched = [...must].filter((w) => scored.every((s) => s.missed.includes(w)))
	const fewest = Math.min(...scored.map((s) => s.missed.length))

	if (fewest === must.size) {
		const vocabulary = [...new Set(rows.flatMap((r) => pathTokens(r.path)))]
		const closest = [
			...new Set(
				unmatched
					.map((w) => nearestName(w, vocabulary))
					.filter((c): c is string => c !== null && !unmatched.includes(c))
			),
		]
		return {
			scope: "census",
			count: rows.length,
			groups: census(rows),
			message: `no setting matches "${query.trim()}"`,
			unmatched,
			...(closest.length > 0 ? { closest } : {}),
			next: closest.length > 0 ? `try "${closest.join(" ")}", or ${CENSUS_NEXT}` : CENSUS_NEXT,
			...empty,
		}
	}

	const partial = fewest > 0
	const hits = scored.filter((s) => s.missed.length === fewest).sort((a, b) => b.score - a.score || a.i - b.i)
	const offset = opts.offset ?? 0
	const limit = opts.limit ?? Number.POSITIVE_INFINITY
	const budget = opts.budget ?? SETTINGS_BUDGET
	const settings: SettingHit[] = []
	let size = 0
	for (const h of hits.slice(offset)) {
		if (settings.length >= limit) break
		const description = opts.includeDescriptions ? settingDoc(h.row.path) : undefined
		let hit: SettingHit = {
			...h.row,
			...(h.via.length > 0 ? { matchedVia: h.via } : {}),
			...(partial ? { missed: h.missed } : {}),
			...(description !== undefined ? { description } : {}),
		}
		let length = stringifyJsonDangerous(hit as never).length
		if (length > budget) {
			hit = { ...hit, value: null, valueOmitted: true }
			length = stringifyJsonDangerous(hit as never).length
		}
		size += length
		if (size > budget && settings.length > 0) break
		settings.push(hit)
	}
	const end = offset + settings.length
	const truncated = end < hits.length
	const done = opts.includeDescriptions
		? "set one with a settings patch"
		: "set one with a settings patch; ask with descriptions to tell similar settings apart"
	return {
		scope: "rows",
		count: hits.length,
		settings,
		returned: settings.length,
		truncated,
		...(truncated ? { nextOffset: end } : {}),
		...(partial
			? {
					message: `no setting matches every word; these match ${must.size - fewest} of ${must.size}`,
					...(unmatched.length > 0 ? { unmatched } : {}),
				}
			: {}),
		next:
			offset >= hits.length
				? `offset ${offset} is past the last result (count ${hits.length}); call again without offset`
				: truncated
					? `call again with offset ${end} for the next page, or add words to narrow`
					: done,
	}
}
