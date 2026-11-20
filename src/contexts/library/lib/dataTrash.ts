import type { Folder } from "../../chartBuilder/lib/types"
import { moveDatasetsToFolder } from "./dataLineage"

/** The Data tab's Trash. A data set moved to the trash leaves the list and
 *  the rail and waits here until it is restored or deleted for good — the
 *  same two-step delete visuals get.
 *
 *  The trash is a stored data folder with a reserved id, holding the
 *  trashed ids like any folder holds its members. That keeps trashing a
 *  data set as cheap as filing one (nothing rewrites its rows), and makes
 *  "in the trash" and "in a folder" exclusive for free: a trashed data set
 *  is in no other folder, and a restored one comes back unfiled. Nothing
 *  ever SHOWS this folder — `useDataFoldersView` leaves it out. Only a data
 *  set no visualization uses can be trashed, so a trashed data set is one
 *  nothing draws from. */
export const DATA_TRASH_FOLDER_ID = "data-trash"

export const isDataTrashFolder = (folder: Pick<Folder, "id">): boolean =>
	folder.id === DATA_TRASH_FOLDER_ID

export const trashedDatasetIds = (folders: readonly Folder[]): string[] =>
	folders.find(isDataTrashFolder)?.datasetIds ?? []

/** Move data sets to the trash, out of whatever folder they were in. */
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
	return moveDatasetsToFolder(withTrash, datasetIds, DATA_TRASH_FOLDER_ID)
}

/** Take data sets out of the trash — to restore them (they come back in no
 *  folder) or because they are being deleted for good. */
export const untrashDatasets = (
	folders: Folder[],
	datasetIds: readonly string[]
): Folder[] => {
	const leaving = new Set(datasetIds)
	return folders.map((f) =>
		isDataTrashFolder(f) && f.datasetIds?.some((id) => leaving.has(id))
			? { ...f, datasetIds: f.datasetIds.filter((id) => !leaving.has(id)) }
			: f
	)
}
