import { describe, expect, it } from "vitest"
import type { Folder } from "../../chartBuilder/lib/types"
import {
	DATA_TRASH_FOLDER_ID,
	restoreDatasets,
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
	it("restores a data set to the folder it came from, or to none when that is gone", () => {
		const other: Folder = { ...mine, id: "fl-other", datasetIds: ["c"] }
		const trashed = trashDatasets([mine, other], ["a", "c", "loose"])
		const back = restoreDatasets(trashed, ["a", "loose"])
		expect(back.folders[0].datasetIds).toEqual(["b", "a"])
		expect(back.restoredTo.get("a")?.id).toBe("fl-data")
		expect(back.restoredTo.get("loose")).toBeNull()
		expect(back.folderGone).toEqual([])
		expect(trashedDatasetIds(back.folders)).toEqual(["c"])
		// Its folder deleted while it sat in the trash.
		const gone = restoreDatasets(
			back.folders.filter((f) => f.id !== "fl-other"),
			["c"]
		)
		expect(gone.restoredTo.get("c")).toBeNull()
		expect(gone.folderGone).toEqual(["c"])
		expect(trashedDatasetIds(gone.folders)).toEqual([])
	})

	it("takes a data set out of its folder, and out of the trash again", () => {
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
