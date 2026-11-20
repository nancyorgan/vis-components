import { describe, expect, it } from "vitest"
import type { Folder } from "../../chartBuilder/lib/types"
import {
	DATA_TRASH_FOLDER_ID,
	trashDatasets,
	trashedDatasetIds,
	untrashDatasets,
} from "./dataTrash"

const mine: Folder = {
	id: "fl-data",
	name: "Mine",
	parentId: null,
	createdAt: 1,
	kind: "data",
	datasetIds: ["a", "b"],
}

describe("the data trash", () => {
	it("takes a data set out of its folder, and gives it back unfiled", () => {
		const trashed = trashDatasets([mine], ["a"])
		expect(trashed.map((f) => [f.id, f.datasetIds])).toEqual([
			["fl-data", ["b"]],
			[DATA_TRASH_FOLDER_ID, ["a"]],
		])
		expect(trashedDatasetIds(trashed)).toEqual(["a"])
		// A second trip reuses the one trash.
		const more = trashDatasets(trashed, ["b"])
		expect(more).toHaveLength(2)
		expect(trashedDatasetIds(more)).toEqual(["a", "b"])
		const restored = untrashDatasets(more, ["a"])
		expect(trashedDatasetIds(restored)).toEqual(["b"])
		expect(restored[0].datasetIds).toEqual([])
	})

	it("does nothing with nothing to trash", () => {
		const folders = [mine]
		expect(trashDatasets(folders, [])).toBe(folders)
		expect(trashedDatasetIds(folders)).toEqual([])
	})
})
