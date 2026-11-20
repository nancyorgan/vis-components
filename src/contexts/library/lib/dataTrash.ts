import type { Folder } from "../../chartBuilder/lib/types"
import { folderByDataset, moveDatasetsToFolder } from "./dataLineage"

/** The Data tab's Trash. A data set moved to the trash leaves the list and
 *  the rail and waits here until it is restored or deleted for good — the
 *  same two-step delete visuals get.
 *
 *  The trash is a stored data folder with a reserved id, holding the
 *  trashed ids like any folder holds its members. That keeps trashing a
 *  data set as cheap as filing one (nothing rewrites its rows), and makes
 *  "in the trash" and "in a folder" exclusive for free: a trashed data set
 *  is in no other folder. The trash remembers the folder each one came
 *  from (`Folder.trashedFrom`), and Restore puts it back there. Nothing
 *  ever SHOWS this folder — `useDataFoldersView` leaves it out. Only a data
 *  set no visualization uses can be trashed, so a trashed data set is one
 *  nothing draws from. */
export const DATA_TRASH_FOLDER_ID = "data-trash"

export const isDataTrashFolder = (folder: Pick<Folder, "id">): boolean =>
	folder.id === DATA_TRASH_FOLDER_ID

export const trashedDatasetIds = (folders: readonly Folder[]): string[] =>
	folders.find(isDataTrashFolder)?.datasetIds ?? []

/** Move data sets to the trash, out of whatever folder they were in —
 *  which the trash notes, for {@link restoreDatasets}. */
export const trashDatasets = (
	folders: Folder[],
	datasetIds: readonly string[]
): Folder[] => {
	if (datasetIds.length === 0) return folders
	const withTrash = folders.some(isDataTrashFolder)
		? folders
		: [
				...folders,
				{
					id: DATA_TRASH_FOLDER_ID,
					name: "Trash",
					parentId: null,
					createdAt: 0,
					kind: "data" as const,
					datasetIds: [],
				},
			]
	const homes = folderByDataset(folders.filter((f) => !isDataTrashFolder(f)))
	return moveDatasetsToFolder(withTrash, datasetIds, DATA_TRASH_FOLDER_ID).map(
		(f) => {
			if (!isDataTrashFolder(f)) return f
			const trashedFrom = { ...f.trashedFrom }
			for (const id of datasetIds) {
				const home = homes.get(id)
				if (home) trashedFrom[id] = home.id
			}
			return { ...f, trashedFrom }
		}
	)
}

/** Put trashed data sets back where they were: the folder each came from,
 *  or no folder when it came from none or that folder has since been
 *  deleted. `restoredTo` says where each one landed (null = no folder) and
 *  `folderGone` lists the ones whose folder was gone, so the caller can
 *  tell the user. */
export const restoreDatasets = (
	folders: Folder[],
	datasetIds: readonly string[]
): {
	folders: Folder[]
	restoredTo: Map<string, Folder | null>
	folderGone: string[]
} => {
	const from = folders.find(isDataTrashFolder)?.trashedFrom ?? {}
	const restoredTo = new Map<string, Folder | null>()
	const folderGone: string[] = []
	let next = untrashDatasets(folders, datasetIds)
	for (const id of datasetIds) {
		const homeId = from[id]
		const home =
			homeId === undefined
				? undefined
				: folders.find((f) => f.id === homeId && !isDataTrashFolder(f))
		if (homeId !== undefined && !home) folderGone.push(id)
		restoredTo.set(id, home ?? null)
		if (home) next = moveDatasetsToFolder(next, [id], home.id)
	}
	return { folders: next, restoredTo, folderGone }
}

/** Take data sets out of the trash, into no folder, and forget where they
 *  came from — for one being deleted for good ({@link restoreDatasets}
 *  restores). */
export const untrashDatasets = (
	folders: Folder[],
	datasetIds: readonly string[]
): Folder[] => {
	const leaving = new Set(datasetIds)
	return folders.map((f) =>
		isDataTrashFolder(f) && f.datasetIds?.some((id) => leaving.has(id))
			? {
					...f,
					datasetIds: f.datasetIds.filter((id) => !leaving.has(id)),
					trashedFrom: Object.fromEntries(
						Object.entries(f.trashedFrom ?? {}).filter(
							([id]) => !leaving.has(id)
						)
					),
				}
			: f
	)
}
