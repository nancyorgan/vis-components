/** What changed between two copies of one chart, as setting paths, for the
 *  edit and undo merge (spec 03 SAFE-*, 04 UNDO-*). Pure.
 *
 *  A path is an ARRAY of keys, never dot-joined (a level named
 *  "North.East" is one key, apart from "North"); dotted text is for display
 *  only (`pathText`). Both copies go through the editor's own intake and
 *  default-fill first (`normalizeVisual`), so a default the editor fills in
 *  when it opens or saves a chart never reads as a change. Bookkeeping
 *  (save times, saver, preview) is never a setting. Plain objects are
 *  compared key by key, a key absent on one side read as an empty object
 *  when the other side holds one; a list is ONE path, compared whole, as a
 *  patch replaces it whole. */

import { foldFlowNodeTitles } from "../../src/contexts/chartBuilder/lib/foldFlowNodeTitles"
import { structureVisualKeys } from "../../src/contexts/chartBuilder/lib/savedKeyStructure"
import type { Visual } from "../../src/contexts/chartBuilder/lib/types"
import { hydrateVisual } from "../../src/contexts/chartBuilder/lib/visualDefaults"

export type SettingPath = readonly string[]

/** Top-level keys that record a save, not a setting. */
const BOOKKEEPING = new Set(["updatedAt", "updatedBy", "thumbnail", "thumbnailAt", "createdAt"])

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

/** A JSON copy: undefined members dropped, as a save would drop them. */
const jsonCopy = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : jsonCopy(v)))
	if (!isObj(value)) return value
	const out: Obj = {}
	for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = jsonCopy(v)
	return out
}

/** A stored chart as the editor holds it once opened: keys structured,
 *  defaults filled, an empty column order dropped (as a save drops it),
 *  bookkeeping left out. */
export const normalizeVisual = (visual: Visual): Obj => {
	const stored = foldFlowNodeTitles(structureVisualKeys(visual))
	const full: Obj = { ...stored, ...hydrateVisual(stored) }
	if (Array.isArray(full.fieldOrder) && full.fieldOrder.length === 0) delete full.fieldOrder
	for (const key of BOOKKEEPING) delete full[key]
	return jsonCopy(full) as Obj
}

export const deepEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
		return a.every((v, i) => deepEqual(v, b[i]))
	}
	if (!isObj(a) || !isObj(b)) return false
	const keys = new Set(Object.keys(a).concat(Object.keys(b)))
	for (const k of keys) if (!deepEqual(a[k], b[k])) return false
	return true
}

/** Every path whose value differs between two normalized copies. */
export const changedPaths = (from: unknown, to: unknown): SettingPath[] => {
	const out: SettingPath[] = []
	const walk = (a: unknown, b: unknown, path: string[]) => {
		const objA = isObj(a) || (a === undefined && isObj(b))
		const objB = isObj(b) || (b === undefined && isObj(a))
		if (objA && objB) {
			const left = (a ?? {}) as Obj
			const right = (b ?? {}) as Obj
			const keys = new Set(Object.keys(left).concat(Object.keys(right)))
			for (const k of keys) walk(left[k], right[k], path.concat(k))
			return
		}
		if (!deepEqual(a, b)) out.push(path)
	}
	walk(from, to, [])
	return out
}

/** One path holds the other (or they are the same path). */
export const overlaps = (a: SettingPath, b: SettingPath): boolean => {
	const n = Math.min(a.length, b.length)
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false
	return true
}

/** The paths of `mine` that some path of `theirs` overlaps. */
export const conflictsOf = (mine: readonly SettingPath[], theirs: readonly SettingPath[]): SettingPath[] =>
	mine.filter((m) => theirs.some((t) => overlaps(m, t)))

/** Of each overlapping pair, the shorter path: setting it covers both. */
export const conflictRoots = (mine: readonly SettingPath[], theirs: readonly SettingPath[]): SettingPath[] => {
	const roots: SettingPath[] = []
	for (const m of mine)
		for (const t of theirs) {
			if (!overlaps(m, t)) continue
			const root = m.length <= t.length ? m : t
			if (!roots.some((r) => r.length === root.length && overlaps(r, root))) roots.push(root)
		}
	return roots
}

/** The value at `path`; undefined when any step is missing. */
export const valueAt = (value: unknown, path: SettingPath): unknown => {
	let at = value
	for (const key of path) {
		if (!isObj(at)) return undefined
		at = at[key]
	}
	return at
}

/** Set `target` at `path` to `source`'s value there (a deep copy), making
 *  the objects on the way. Where `source` has nothing, the key goes, and so
 *  does each parent left empty that `source` doesn't hold either. */
export const restoreAt = (target: Obj, source: unknown, path: SettingPath): void => {
	if (path.length === 0) return
	const wanted = valueAt(source, path)
	if (wanted === undefined) {
		const chain: Obj[] = [target]
		for (const key of path.slice(0, -1)) {
			const next = chain[chain.length - 1][key]
			if (!isObj(next)) return
			chain.push(next)
		}
		delete chain[chain.length - 1][path[path.length - 1]]
		for (let depth = path.length - 1; depth > 0; depth--) {
			const parent = chain[depth - 1]
			const key = path[depth - 1]
			const node = chain[depth]
			if (Object.keys(node).length > 0 || valueAt(source, path.slice(0, depth)) !== undefined) break
			delete parent[key]
		}
		return
	}
	let at = target
	for (const key of path.slice(0, -1)) {
		if (!isObj(at[key])) at[key] = {}
		at = at[key] as Obj
	}
	at[path[path.length - 1]] = jsonCopy(wanted)
}

/** A path as text: plain keys dotted, any other key quoted in brackets. */
export const pathText = (path: SettingPath): string =>
	path
		.map((key, i) =>
			/^[A-Za-z_$][\w$]*$/.test(key) ? (i === 0 ? key : `.${key}`) : `[${JSON.stringify(key)}]`
		)
		.join("")

const SHORT = 80

/** A value as short JSON, cut past SHORT characters; "(unset)" for none. */
export const shortValue = (value: unknown): string => {
	if (value === undefined) return "(unset)"
	const text = JSON.stringify(value)
	return text.length <= SHORT ? text : `${text.slice(0, SHORT - 3)}...`
}

/** Each path as `path: from -> to`. */
export const describeChanges = (paths: readonly SettingPath[], from: unknown, to: unknown): string[] =>
	paths.map((p) => `${pathText(p)}: ${shortValue(valueAt(from, p))} -> ${shortValue(valueAt(to, p))}`)
