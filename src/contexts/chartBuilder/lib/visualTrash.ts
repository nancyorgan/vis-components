import { nameCollides } from "./nameUniqueness"
import type { Folder, Visual } from "./types"

/** A visual is in the Trash when it carries a `deletedAt` stamp. */
export const isTrashed = (v: Visual): boolean => v.deletedAt !== undefined

/** Move the given visuals to the Trash: stamp `deletedAt`, keep everything
 * else (folder, thumbnail, embeds, data set) so Restore can put them back
 * exactly. Already-trashed visuals keep their original stamp. */
export const trashVisuals = (
	visuals: Visual[],
	ids: Iterable<string>,
	now = Date.now()
): Visual[] => {
	const set = new Set(ids)
	return visuals.map((v) =>
		set.has(v.id) && !isTrashed(v) ? { ...v, deletedAt: now } : v
	)
}

/** Bring trashed visuals back. Two repairs, both against the state the
 * library is in NOW rather than when the visual was trashed:
 *  - a folder deleted in the meantime → the visual lands at the root;
 *  - a live visual that has since taken the name → "Name (restored)", so
 *    the library's name-uniqueness rule still holds. */
export const restoreVisuals = (
	visuals: Visual[],
	ids: Iterable<string>,
	folders: readonly Folder[]
): Visual[] => {
	const set = new Set(ids)
	const folderIds = new Set(folders.map((f) => f.id))
	// Live names are checked against the list as it grows, so restoring two
	// trashed visuals that share a name gives the second its own suffix.
	const live = visuals.filter((v) => !isTrashed(v))
	return visuals.map((v) => {
		if (!set.has(v.id) || !isTrashed(v)) return v
		const { deletedAt: _deletedAt, ...rest } = v
		const folderId =
			rest.folderId !== null && !folderIds.has(rest.folderId)
				? null
				: rest.folderId
		let name = rest.name
		while (nameCollides(name, live, v.id)) name = `${name} (restored)`
		const restored: Visual = { ...rest, folderId, name }
		live.push(restored)
		return restored
	})
}
