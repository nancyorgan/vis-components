import { describe, expect, it } from "vitest"

import type { Folder } from "../../chartBuilder/lib/types"
import { folderSubtreeIds } from "./folderSubtree"

const mkFolder = (id: string, parentId: string | null): Folder => ({
	id,
	name: id,
	parentId,
	createdAt: 1,
})

// A ── B ── C
// └── D          E (unrelated root)
const FOLDERS = [
	mkFolder("A", null),
	mkFolder("B", "A"),
	mkFolder("C", "B"),
	mkFolder("D", "A"),
	mkFolder("E", null),
]

describe("folderSubtreeIds", () => {
	it("collects the folder and all descendants, transitively", () => {
		expect(folderSubtreeIds(FOLDERS, "A")).toEqual(
			new Set(["A", "B", "C", "D"])
		)
	})
	it("collects a mid-tree subtree without ancestors or siblings", () => {
		expect(folderSubtreeIds(FOLDERS, "B")).toEqual(new Set(["B", "C"]))
	})
	it("returns just the folder itself for a leaf", () => {
		expect(folderSubtreeIds(FOLDERS, "C")).toEqual(new Set(["C"]))
	})
	it("still includes an id unknown to the folder list (stale selection)", () => {
		expect(folderSubtreeIds(FOLDERS, "gone")).toEqual(new Set(["gone"]))
	})
	it("terminates on corrupt data containing a parentId cycle", () => {
		const corrupt = [mkFolder("X", "Y"), mkFolder("Y", "X")]
		expect(folderSubtreeIds(corrupt, "X")).toEqual(new Set(["X", "Y"]))
	})
})
