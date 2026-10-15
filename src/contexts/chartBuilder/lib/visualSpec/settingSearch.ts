/** Finding settings by everyday words. Each word must match a setting's
 *  path (a substring, or a token split from dots and camelCase), a
 *  concept word standing for one ("margin" for padding, offset, gap and
 *  inset), or the setting's doc comment. No query, or no match, returns a
 *  census: how many settings each group holds, and how to narrow.
 *
 *  Docs come from settingDocs.json (tooling/extract-setting-docs.js). A
 *  setting without its own doc comment is searched by its nearest
 *  documented ancestor's; entries of data-keyed maps have none. */

import { stringifyJsonDangerous } from "../../../../lib/json"
import type { SettingRow } from "./settings"
import { nearestName } from "./suggest"
import SETTING_DOCS from "./settingDocs.json"

const SPACE = ["pad", "offset", "gap", "inset"]
const COLOR = ["color"]

/** Everyday words and the setting-name words they stand for. */
export const CONCEPTS: Readonly<Record<string, readonly string[]>> = {
	margin: SPACE,
	margins: SPACE,
	spacing: SPACE,
	space: SPACE,
	size: ["size", "fontsize", "width", "radius", "thickness"],
	colour: ["color"],
	line: ["stroke", "line", "connection"],
	lines: ["stroke", "line", "connection"],
	grid: ["gridlines"],
	hide: ["enabled", "hidden", "show"],
	show: ["enabled", "hidden", "show"],
	bold: ["weight"],
	...Object.fromEntries(
		["white", "black", "gray", "grey", "red", "orange", "yellow", "green", "blue", "purple", "pink", "brown"].map((c) => [c, COLOR])
	),
}

/** Words a request carries that name no setting. */
const STOPWORDS = new Set(
	"a an the to of on in for and or my this that it its make set change put turn between from by with be is are all each every".split(" ")
)

/** Rows past this many characters of JSON are left for the next page. */
export const SETTINGS_BUDGET = 40_000

const docs = SETTING_DOCS as Record<string, string>

/** The path without bracketed map keys, as settingDocs.json keys it. */
const plainPath = (path: string): string => path.replace(/\[[^\]]*\]/g, "")

/** The setting's own doc comment. */
export const settingDoc = (path: string): string | undefined => docs[plainPath(path)]

/** Its own doc, else the nearest documented ancestor's. */
const searchableDoc = (path: string): string | undefined => {
	const parts = plainPath(path).split(".")
	for (let n = parts.length; n > 0; n--) {
		const doc = docs[parts.slice(0, n).join(".")]
		if (doc !== undefined) return doc
	}
	return undefined
}

/** `channelConfigs.x.tickLabelAngle` → channelconfigs, x, tick, label, angle. */
export const pathTokens = (path: string): string[] =>
	path
		.split(/[.[\]"]+/)
		.flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])|[^A-Za-z0-9]+/))
		.map((t) => t.toLowerCase())
		.filter(Boolean)

/** channelConfigs.x, otherwise the slice: what a census counts by. */
export const settingGroup = (path: string): string => {
	const parts = plainPath(path).split(".")
	return parts[0] === "channelConfigs" && parts.length > 2 ? parts.slice(0, 2).join(".") : (parts[0] ?? path)
}

type Match = { score: number; via?: string }

const matchWord = (word: string, path: string, tokens: readonly string[], doc: string | undefined): Match | undefined => {
	const lower = path.toLowerCase()
	if (tokens.includes(word)) return { score: 3 }
	if (tokens.some((t) => t.startsWith(word))) return { score: 2 }
	if (lower.includes(word)) return { score: 1.5 }
	for (const alias of CONCEPTS[word] ?? []) {
		if (tokens.some((t) => t.startsWith(alias)) || lower.includes(alias)) return { score: 1.25, via: `${word} → ${alias}` }
	}
	if (doc !== undefined && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(doc)) {
		return { score: 0.5, via: `${word} → description` }
	}
	return undefined
}

export type SettingHit = SettingRow & { matchedVia?: string[]; description?: string }

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
	/** Why a query came back as a census. */
	message?: string
	/** Setting words close to the query's unmatched words. */
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

export const searchSettings = (rows: readonly SettingRow[], query: string, opts: SearchOptions = {}): SettingSearch => {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w !== "" && !STOPWORDS.has(w) && !/^[\d.%#-]+$/.test(w))
	const empty = { settings: [], returned: 0, truncated: false }
	if (words.length === 0) {
		return { scope: "census", count: rows.length, groups: census(rows), next: CENSUS_NEXT, ...empty }
	}
	const hits: Array<{ row: SettingRow; score: number; via: string[]; i: number }> = []
	rows.forEach((row, i) => {
		const tokens = pathTokens(row.path)
		const doc = searchableDoc(row.path)
		let score = 0
		const via: string[] = []
		for (const w of words) {
			const m =
				matchWord(w, row.path, tokens, doc) ??
				(w.length > 3 && w.endsWith("s") ? matchWord(w.slice(0, -1), row.path, tokens, doc) : undefined)
			if (!m) return
			score += m.score
			if (m.via) via.push(m.via)
		}
		hits.push({ row, score, via, i })
	})
	if (hits.length === 0) {
		const vocabulary = [...new Set(rows.flatMap((r) => pathTokens(r.path)))]
		const closest = [...new Set(words.map((w) => nearestName(w, vocabulary)).filter((t): t is string => t !== null))]
		return {
			scope: "census",
			count: rows.length,
			groups: census(rows),
			message: `no setting matches "${query.trim()}"`,
			...(closest.length > 0 ? { closest } : {}),
			next: closest.length > 0 ? `try "${closest.join(" ")}", or ${CENSUS_NEXT}` : CENSUS_NEXT,
			...empty,
		}
	}
	hits.sort((a, b) => b.score - a.score || a.i - b.i)
	const offset = Math.max(0, opts.offset ?? 0)
	const limit = opts.limit !== undefined && opts.limit > 0 ? opts.limit : Number.POSITIVE_INFINITY
	const budget = opts.budget ?? SETTINGS_BUDGET
	const settings: SettingHit[] = []
	let size = 0
	for (const h of hits.slice(offset)) {
		if (settings.length >= limit) break
		const description = opts.includeDescriptions ? settingDoc(h.row.path) : undefined
		const hit: SettingHit = {
			...h.row,
			...(h.via.length > 0 ? { matchedVia: h.via } : {}),
			...(description !== undefined ? { description } : {}),
		}
		size += stringifyJsonDangerous(hit as never).length
		if (size > budget && settings.length > 0) break
		settings.push(hit)
	}
	const end = offset + settings.length
	const truncated = end < hits.length
	return {
		scope: "rows",
		count: hits.length,
		settings,
		returned: settings.length,
		truncated,
		...(truncated ? { nextOffset: end } : {}),
		next: truncated
			? `call again with offset ${end} for the next page, or add words to narrow`
			: opts.includeDescriptions
				? "set one with a settings patch"
				: "set one with a settings patch; ask with descriptions to tell similar settings apart",
	}
}
