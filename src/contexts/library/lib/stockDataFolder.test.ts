import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	clearStockFolders,
	setStockFolders,
} from "../../chartBuilder/lib/stockFolders"
import type { Folder } from "../../chartBuilder/lib/types"
import {
	STOCK_DATA_FOLDER_ID,
	stockDatasetIds,
	stockIdsIn,
	withStockDataFolder,
} from "./stockDataFolder"

const folder = (id: string, over: Partial<Folder> = {}): Folder => ({
	id,
	name: id,
	parentId: null,
	createdAt: 1,
	...over,
})

const visualFolders = [
	folder("fl-stock"),
	folder("fl-stock-sub", { parentId: "fl-stock" }),
	folder("fl-mine"),
]

beforeEach(() => setStockFolders([folder("fl-stock")]))
afterEach(clearStockFolders)

describe("stockDatasetIds", () => {
	it("takes the data sets the stock examples draw from, subfolders included", () => {
		expect(
			stockDatasetIds(
				["a", "b", "c", "d"],
				[
					{ datasetId: "a", folderId: "fl-stock" },
					{ datasetId: "b", folderId: "fl-stock-sub" },
					{ datasetId: "c", folderId: "fl-mine" },
					{ datasetId: "d", folderId: null },
					{ datasetId: null, folderId: "fl-stock" },
				],
				visualFolders
			)
		).toEqual(["a", "b"])
	})
})

describe("withStockDataFolder", () => {
	const mine = folder("fl-data", { kind: "data", datasetIds: ["b"] })

	it("adds the shelf last, and keeps stock data on it whatever a folder lists", () => {
		const shown = withStockDataFolder(
			[{ ...mine, datasetIds: ["b", "own"] }],
			["a", "b"]
		)
		expect(shown.map((f) => [f.id, f.datasetIds])).toEqual([
			["fl-data", ["own"]],
			[STOCK_DATA_FOLDER_ID, ["a", "b"]],
		])
		expect([...stockIdsIn(shown)]).toEqual(["a", "b"])
	})

	it("is left out when the library holds no stock data", () => {
		const folders = [mine]
		expect(withStockDataFolder(folders, [])).toBe(folders)
		expect(stockIdsIn(folders).size).toBe(0)
	})
})
