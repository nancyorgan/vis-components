/** Folders, data sets and themes by the names people use for them. Pure:
 *  the handlers fetch the lists and pass them in. A miss is refused with
 *  the choices, so the model can ask or pick without another call. */

import { editDistance } from "../../src/contexts/chartBuilder/lib/didYouMean"
import type { DatasetMeta, Folder, SavedTheme } from "../../src/contexts/chartBuilder/lib/types"
import { folderPath, treeOrder } from "./library"

export type Resolved<T> = { ok: true; value: T } | { ok: false; message: string }

const fold = (s: string) => s.trim().toLowerCase()

/** Every folder by path and id, in the library tree's order. */
const folderChoices = (folders: readonly Folder[]): string =>
	folders.length === 0
		? "There are no folders; leave folder out to save at the library root."
		: `Folders: ${treeOrder(folders)
				.map((folder) => `"${folderPath(folders, folder.id)}" (${folder.id})`)
				.join(", ")}. Give one's name or id.`

/** A folder by id, by its own name in any case, or by its path; `null` /
 *  absent is the library root (`value: null`). Near misses are refused:
 *  folder names are exact. */
export const resolveFolder = (
	wanted: unknown,
	folders: readonly Folder[],
	key = "folder"
): Resolved<Folder | null> => {
	if (wanted === undefined || wanted === null) return { ok: true, value: null }
	if (typeof wanted !== "string" || wanted.trim() === "")
		return { ok: false, message: `${key} must be a folder's name or id, or null for the library root.` }
	const byId = folders.find((f) => f.id === wanted.trim())
	if (byId) return { ok: true, value: byId }
	const w = fold(wanted)
	let hits = folders.filter((f) => fold(f.name) === w)
	if (hits.length === 0) hits = folders.filter((f) => fold(folderPath(folders, f.id)) === w)
	if (hits.length === 1) return { ok: true, value: hits[0] }
	if (hits.length > 1)
		return {
			ok: false,
			message: `${hits.length} folders are named "${wanted.trim()}"; give the id. ${folderChoices(folders)}`,
		}
	return { ok: false, message: `No folder is named "${wanted.trim()}". ${folderChoices(folders)}` }
}

/** A data set's row count at its latest version. */
export const rowCountOf = (meta: DatasetMeta): number =>
	meta.versions.find((v) => v.id === meta.latestVersionId)?.rowCount ?? 0

/** Up to five stored names nearest `wanted`: names containing it or
 *  contained in it first, then by edit distance. */
export const closestNames = (wanted: string, names: readonly string[], limit = 5): string[] => {
	const w = fold(wanted)
	const ranked = [...new Set(names)].map((name) => {
		const n = fold(name)
		return { name, near: n.includes(w) || w.includes(n), dist: editDistance(w, n) }
	})
	ranked.sort((a, b) => Number(b.near) - Number(a.near) || a.dist - b.dist || a.name.localeCompare(b.name))
	return ranked.slice(0, limit).map((r) => r.name)
}

/** A data set by id, or by name in any case with outer spaces ignored. */
export const resolveDataset = (
	wanted: unknown,
	index: Readonly<Record<string, DatasetMeta>>
): Resolved<DatasetMeta> => {
	if (typeof wanted !== "string" || wanted.trim() === "")
		return {
			ok: false,
			message:
				"Give the data set's name or id as dataset. For rows the person attached or pasted, store them with create_dataset and use the id it returns.",
		}
	const metas = Object.values(index)
	const byId = index[wanted.trim()] ?? metas.find((m) => m.id === wanted.trim())
	if (byId) return { ok: true, value: byId }
	const hits = metas.filter((m) => fold(m.name) === fold(wanted))
	if (hits.length === 1) return { ok: true, value: hits[0] }
	if (hits.length > 1)
		return {
			ok: false,
			message: `${hits.length} data sets are named "${wanted.trim()}": ${hits
				.map((m) => `${m.id} (${rowCountOf(m)} rows)`)
				.join(", ")}. Ask the person which one, then give its id.`,
		}
	if (metas.length === 0)
		return {
			ok: false,
			message: `No data set is named "${wanted.trim()}", and none are stored. Store the rows with create_dataset, then make the chart.`,
		}
	const near = closestNames(
		wanted,
		metas.map((m) => m.name)
	)
	return {
		ok: false,
		message: `No data set is named "${wanted.trim()}". Closest: ${near
			.map((n) => `"${n}"`)
			.join(", ")}. Give one of these names or an id, or store new rows with create_dataset.`,
	}
}

/** A theme name with case, spaces and punctuation taken out. */
const themeKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

/** A theme by id or by name (any case); absent or null is `value: null`
 *  (the caller's default). */
export const resolveThemeName = (
	wanted: unknown,
	themes: readonly SavedTheme[]
): Resolved<SavedTheme | null> => {
	if (wanted === undefined || wanted === null) return { ok: true, value: null }
	const choices = `Themes: ${themes.map((t) => `"${t.name}" (${t.id})`).join(", ")}.`
	if (typeof wanted !== "string" || wanted.trim() === "")
		return { ok: false, message: `themeId must be a theme's name or id. ${choices}` }
	const byId = themes.find((t) => t.id === wanted.trim())
	if (byId) return { ok: true, value: byId }
	const hits = themes.filter((t) => themeKey(t.name) === themeKey(wanted))
	if (hits.length === 1) return { ok: true, value: hits[0] }
	return {
		ok: false,
		message:
			hits.length > 1
				? `${hits.length} themes are named "${wanted.trim()}"; give the id. ${choices}`
				: `No theme is named "${wanted.trim()}". ${choices} Give one's name or id, or leave themeId out for the default theme.`,
	}
}
