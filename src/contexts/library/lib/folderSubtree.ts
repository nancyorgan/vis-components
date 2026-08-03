import type { Folder } from "../../chartBuilder/lib/types"

/** The folder plus all of its descendants. Selecting a folder in the
 *  sidebar filters to its whole subtree's visuals, not just direct
 *  children. The seen-check doubles as a guard against corrupt data
 *  with a parentId cycle. */
export const folderSubtreeIds = (
	folders: Folder[],
	folderId: string
): Set<string> => {
	const ids = new Set<string>()
	const collect = (id: string) => {
		if (ids.has(id)) return
		ids.add(id)
		for (const f of folders) {
			if (f.parentId === id) collect(f.id)
		}
	}
	collect(folderId)
	return ids
}
