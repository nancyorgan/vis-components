import { isEphemeralSeedId } from "../../chartBuilder/lib/exampleOverlay"
import { isStockFolderId } from "../../chartBuilder/lib/stockFolders"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import { folderAncestors } from "./folderSubtree"

/** The Data tab's stock shelf: the data sets the stock example visuals are
 *  drawn from, as a folder of their own so they don't sit among the user's
 *  unfiled data.
 *
 *  It is NOT stored. It is worked out on every read from what is in the
 *  library — so it needs no seeding or migration, follows the examples as
 *  they ship, and is absent when the library holds none. Like the visuals'
 *  stock shelf (`isStockFolder`, lib/folderOrder.ts) the app owns it: pinned
 *  last, no rename, delete, subfolder or drop. A stock data set opens,
 *  edits into a copy and starts a visualization like any other, but it
 *  STAYS on the shelf: it can't be filed in a folder of the user's (a bulk
 *  move or a drag skips it), so sorting one's own data never empties the
 *  shelf. The copy an edit makes is the user's, and files anywhere. */
export const STOCK_DATA_FOLDER_ID = "stock-data"

export const STOCK_DATA_FOLDER_NAME = "Stock Data Sets"

export const isStockDataFolder = (folder: Pick<Folder, "id">): boolean =>
	folder.id === STOCK_DATA_FOLDER_ID

/** Ids of the stock data sets among `datasetIds`: one a visual in the stock
 *  examples folder (or a folder under it) draws from — Trash included, a
 *  trashed example still owns its data — or one the shipped examples
 *  brought themselves, which stays stock even after its example is moved
 *  out or deleted. In `datasetIds` order. */
export const stockDatasetIds = (
	datasetIds: readonly string[],
	visuals: readonly Pick<Visual, "datasetId" | "folderId">[],
	visualFolders: readonly Folder[]
): string[] => {
	const usedByStock = new Set<string>()
	for (const v of visuals) {
		if (
			v.datasetId &&
			folderAncestors(visualFolders, v.folderId).some((f) => isStockFolderId(f.id))
		)
			usedByStock.add(v.datasetId)
	}
	return datasetIds.filter((id) => usedByStock.has(id) || isEphemeralSeedId(id))
}

/** The user's data folders plus the stock shelf, for everything that READS
 *  folders (the rail, the list's Folder column, the folder filter). The
 *  shelf holds every stock data set and comes last; a stock id a stored
 *  folder lists (filed before the shelf kept its own) is read out of that
 *  folder here. With no stock data `dataFolders` comes back as it is.
 *  Writes go to the stored folders only — never hand this list to
 *  `dataFoldersAtom`. */
export const withStockDataFolder = (
	dataFolders: Folder[],
	stockIds: readonly string[]
): Folder[] => {
	if (stockIds.length === 0) return dataFolders
	const stock = new Set(stockIds)
	return [
		...dataFolders.map((f) =>
			f.datasetIds?.some((id) => stock.has(id))
				? { ...f, datasetIds: f.datasetIds.filter((id) => !stock.has(id)) }
				: f
		),
		{
			id: STOCK_DATA_FOLDER_ID,
			name: STOCK_DATA_FOLDER_NAME,
			parentId: null,
			createdAt: 0,
			kind: "data",
			datasetIds: [...stockIds],
		},
	]
}

/** The stock data sets, read back off a folder list that carries the shelf
 *  (`withStockDataFolder`). They are the ones a move must leave alone. */
export const stockIdsIn = (folders: readonly Folder[]): ReadonlySet<string> =>
	new Set(folders.find(isStockDataFolder)?.datasetIds ?? [])
