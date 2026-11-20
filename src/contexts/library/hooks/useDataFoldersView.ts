import { useMemo } from "react"
import { useAtomValue } from "jotai"
import type { DatasetMeta, Folder } from "../../chartBuilder/lib/types"
import {
	dataFoldersAtom,
	datasetIndexAtom,
	foldersAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"
import { isDataTrashFolder, trashedDatasetIds } from "../lib/dataTrash"
import { stockDatasetIds, withStockDataFolder } from "../lib/stockDataFolder"

/** The Data tab's folders as it SHOWS them: the user's data folders plus
 *  the stock shelf (`lib/stockDataFolder.ts`), minus the trash
 *  (`lib/dataTrash.ts`). Read-only — change folders through
 *  `dataFoldersAtom`, which never holds the shelf. */
export const useDataFoldersView = (): Folder[] => {
	const dataFolders = useAtomValue(dataFoldersAtom)
	const datasets = useAtomValue(datasetIndexAtom)
	const visuals = useAtomValue(visualsAtom)
	const visualFolders = useAtomValue(foldersAtom)
	return useMemo(
		() =>
			withStockDataFolder(
				dataFolders.filter((f) => !isDataTrashFolder(f)),
				stockDatasetIds(Object.keys(datasets), visuals, visualFolders)
			),
		[dataFolders, datasets, visuals, visualFolders]
	)
}

/** The data sets the Data tab lists: every one that isn't in its trash. */
export const useListedDatasets = (): Record<string, DatasetMeta> => {
	const datasets = useAtomValue(datasetIndexAtom)
	const dataFolders = useAtomValue(dataFoldersAtom)
	return useMemo(() => {
		const trashed = new Set(trashedDatasetIds(dataFolders))
		if (trashed.size === 0) return datasets
		return Object.fromEntries(
			Object.entries(datasets).filter(([id]) => !trashed.has(id))
		)
	}, [datasets, dataFolders])
}

/** How many visualizations draw from each data set — the Trash's visuals
 *  included (a trashed visual still owns its data), and the data set bound
 *  in the editor counted once more (an upload not yet saved as a visual is
 *  live work). A data set with no entry is free to trash. */
export const useDatasetUseCounts = (
	editorDatasetId: string | null
): ReadonlyMap<string, number> => {
	const visuals = useAtomValue(visualsAtom)
	return useMemo(() => {
		const counts = new Map<string, number>()
		const bump = (id: string | null) => {
			if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
		}
		for (const v of visuals) bump(v.datasetId)
		bump(editorDatasetId)
		return counts
	}, [visuals, editorDatasetId])
}
