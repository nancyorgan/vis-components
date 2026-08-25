import type { Folder } from "../../chartBuilder/lib/types"

/** Display order for one sibling group: hand-placed folders first by
 *  `sortIndex` ascending, then never-placed folders alphabetically. Every
 *  folder list in the app orders through this so a hand-placed order shows
 *  up identically in the sidebar tree and in the Move pickers. */
export const orderedSiblings = (
	folders: readonly Folder[],
	parentId: string | null
): Folder[] =>
	folders
		.filter((f) => f.parentId === parentId)
		.sort((a, b) => {
			const ai = a.sortIndex
			const bi = b.sortIndex
			if (ai !== undefined && bi !== undefined) return ai - bi
			// A placed folder always outranks an unplaced one, so appending a
			// new folder to an ordered group can't push it above the others.
			if (ai !== undefined) return -1
			if (bi !== undefined) return 1
			return a.name.localeCompare(b.name)
		})

/** Every folder depth-first in the tree's display order — a parent
 *  immediately followed by its subtree. `depth` is the nesting level (0 =
 *  root) so flat pick lists can indent without re-walking the tree. */
export const folderTreeOrder = (
	folders: readonly Folder[]
): { folder: Folder; depth: number }[] => {
	const out: { folder: Folder; depth: number }[] = []
	const seen = new Set<string>()
	const walk = (parentId: string | null, depth: number) => {
		// Depth cap + visited set keep corrupt data (a parentId cycle) from
		// hanging the render, the same way canDropFolderOn guards its walk.
		if (depth > 32) return
		for (const folder of orderedSiblings(folders, parentId)) {
			if (seen.has(folder.id)) continue
			seen.add(folder.id)
			out.push({ folder, depth })
			walk(folder.id, depth + 1)
		}
	}
	walk(null, 0)
	return out
}

/** Whether `dragFolderId` may be placed into the sibling group of
 *  `parentId` (null = root). Unlike `canDropFolderOn` this ALLOWS the
 *  folder's current parent — that's the ordinary reorder-in-place case,
 *  which the re-parent guard rejects as a no-op. */
export const canReorderFolderInto = (
	folders: readonly Folder[],
	dragFolderId: string,
	parentId: string | null
): boolean => {
	if (!folders.some((f) => f.id === dragFolderId)) return false
	if (parentId === dragFolderId) return false
	const visited = new Set<string>()
	let cursor = parentId
	while (cursor !== null && !visited.has(cursor)) {
		if (cursor === dragFolderId) return false
		visited.add(cursor)
		cursor = folders.find((f) => f.id === cursor)?.parentId ?? null
	}
	return true
}

/** Drop `sortIndex` — the folder falls back to alphabetical among the
 *  unplaced siblings of wherever it lands. Used by every plain re-parent
 *  (nest-inside drop, "All visualizations" drop, Move pickers) so a
 *  position from the old group can't leak into the new one. */
export const clearSortIndex = (folder: Folder): Folder => {
	// Rebuilt rather than assigned `undefined`: the value is persisted as
	// JSON, and an absent key is what "unplaced" means on the way back in.
	const { sortIndex: _dropped, ...rest } = folder
	return rest
}

/** `sortIndex` for a folder appended to `parentId`'s group: one past the
 *  last placed sibling, or absent when the group has never been ordered
 *  (leaving it alphabetical, as before manual ordering existed). */
export const nextSortIndex = (
	folders: readonly Folder[],
	parentId: string | null
): number | undefined => {
	const placed = folders
		.filter((f) => f.parentId === parentId && f.sortIndex !== undefined)
		.map((f) => f.sortIndex as number)
	return placed.length === 0 ? undefined : Math.max(...placed) + 1
}

/** Translate a before/after drop on the `anchor` row into the insertion
 *  point `reorderFolder` takes. "after" resolves to "before the row that
 *  follows the anchor" — computed with the dragged folder already lifted
 *  out, so dropping a folder just below where it already sits is a no-op
 *  rather than an off-by-one. */
export const insertionPointFor = (
	folders: readonly Folder[],
	dragFolderId: string,
	anchor: Folder,
	zone: "before" | "after"
): { parentId: string | null; beforeId: string | null } => {
	if (zone === "before") {
		return { parentId: anchor.parentId, beforeId: anchor.id }
	}
	const siblings = orderedSiblings(folders, anchor.parentId).filter(
		(f) => f.id !== dragFolderId
	)
	const idx = siblings.findIndex((f) => f.id === anchor.id)
	return {
		parentId: anchor.parentId,
		beforeId: idx === -1 ? null : (siblings[idx + 1]?.id ?? null),
	}
}

/** Move `dragFolderId` into `parentId`'s sibling group at an explicit
 *  position: immediately before `beforeId`, or last when it's null.
 *
 *  The whole target group is (re)stamped 0..n-1 in its resulting display
 *  order — so the FIRST hand placement in a never-ordered group freezes
 *  the alphabetical order everyone was already looking at and moves only
 *  the dragged folder, instead of scrambling its siblings.
 *
 *  Returns the input array unchanged when the move is illegal (unknown
 *  folder, into itself, into its own subtree) or a no-op. */
export const reorderFolder = (
	folders: readonly Folder[],
	dragFolderId: string,
	parentId: string | null,
	beforeId: string | null
): Folder[] => {
	if (!canReorderFolderInto(folders, dragFolderId, parentId)) return [...folders]
	if (beforeId === dragFolderId) return [...folders]

	const group = orderedSiblings(folders, parentId).filter(
		(f) => f.id !== dragFolderId
	)
	const dragged = folders.find((f) => f.id === dragFolderId)
	if (!dragged) return [...folders]

	const at = beforeId === null ? group.length : group.findIndex((f) => f.id === beforeId)
	// An unknown anchor (its row was removed mid-drag) appends rather than
	// silently dropping the folder at the top.
	const insertAt = at === -1 ? group.length : at
	const placed = [
		...group.slice(0, insertAt),
		{ ...dragged, parentId },
		...group.slice(insertAt),
	]

	const indexById = new Map(placed.map((f, i) => [f.id, i]))
	return folders.map((f) => {
		const idx = indexById.get(f.id)
		if (idx === undefined) return f
		return { ...f, parentId, sortIndex: idx }
	})
}
