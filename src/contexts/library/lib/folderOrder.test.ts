import { describe, expect, it } from "vitest"

import type { Folder } from "../../chartBuilder/lib/types"
import {
	canReorderFolderInto,
	clearSortIndex,
	folderTreeOrder,
	insertionPointFor,
	nextSortIndex,
	orderedSiblings,
	reorderFolder,
} from "./folderOrder"

const mkFolder = (
	id: string,
	parentId: string | null,
	name = id,
	sortIndex?: number
): Folder => ({
	id,
	name,
	parentId,
	createdAt: 1,
	...(sortIndex === undefined ? {} : { sortIndex }),
})

const names = (folders: readonly Folder[]) => folders.map((f) => f.name)

describe("orderedSiblings", () => {
	it("is alphabetical when nothing has been hand-placed", () => {
		const folders = [
			mkFolder("c", null, "Charlie"),
			mkFolder("a", null, "Alpha"),
			mkFolder("b", null, "Bravo"),
		]
		expect(names(orderedSiblings(folders, null))).toEqual([
			"Alpha",
			"Bravo",
			"Charlie",
		])
	})

	it("honors sortIndex over the name", () => {
		const folders = [
			mkFolder("a", null, "Alpha", 2),
			mkFolder("b", null, "Bravo", 0),
			mkFolder("c", null, "Charlie", 1),
		]
		expect(names(orderedSiblings(folders, null))).toEqual([
			"Bravo",
			"Charlie",
			"Alpha",
		])
	})

	it("puts hand-placed folders above never-placed ones", () => {
		const folders = [
			mkFolder("a", null, "Alpha"),
			mkFolder("z", null, "Zulu", 0),
			mkFolder("b", null, "Bravo"),
		]
		expect(names(orderedSiblings(folders, null))).toEqual([
			"Zulu",
			"Alpha",
			"Bravo",
		])
	})

	it("scopes to one sibling group", () => {
		const folders = [
			mkFolder("a", null, "Alpha"),
			mkFolder("a1", "a", "Child"),
			mkFolder("b", null, "Bravo"),
		]
		expect(names(orderedSiblings(folders, "a"))).toEqual(["Child"])
	})

	it("does not mutate the input array", () => {
		const folders = [mkFolder("b", null, "Bravo"), mkFolder("a", null, "Alpha")]
		orderedSiblings(folders, null)
		expect(names(folders)).toEqual(["Bravo", "Alpha"])
	})
})

describe("folderTreeOrder", () => {
	it("walks depth-first, each parent followed by its subtree", () => {
		const folders = [
			mkFolder("b", null, "Bravo"),
			mkFolder("a", null, "Alpha"),
			mkFolder("a2", "a", "A-two"),
			mkFolder("a1", "a", "A-one"),
			mkFolder("a1a", "a1", "Deep"),
		]
		expect(folderTreeOrder(folders).map(({ folder, depth }) => [
			folder.name,
			depth,
		])).toEqual([
			["Alpha", 0],
			["A-one", 1],
			["Deep", 2],
			["A-two", 1],
			["Bravo", 0],
		])
	})

	it("follows hand-placed order at every level", () => {
		const folders = [
			mkFolder("a", null, "Alpha", 1),
			mkFolder("b", null, "Bravo", 0),
			mkFolder("b1", "b", "Later", 1),
			mkFolder("b2", "b", "Earlier", 0),
		]
		expect(folderTreeOrder(folders).map((r) => r.folder.name)).toEqual([
			"Bravo",
			"Earlier",
			"Later",
			"Alpha",
		])
	})

	it("drops folders orphaned by a missing parent rather than looping", () => {
		const folders = [mkFolder("a", null, "Alpha"), mkFolder("x", "gone", "Lost")]
		expect(folderTreeOrder(folders).map((r) => r.folder.name)).toEqual(["Alpha"])
	})
})

describe("canReorderFolderInto", () => {
	const folders = [
		mkFolder("a", null),
		mkFolder("a1", "a"),
		mkFolder("a1a", "a1"),
		mkFolder("b", null),
	]

	it("allows the folder's own current group (a plain reorder)", () => {
		expect(canReorderFolderInto(folders, "a1", "a")).toBe(true)
	})

	it("allows moving into another group", () => {
		expect(canReorderFolderInto(folders, "a1", "b")).toBe(true)
		expect(canReorderFolderInto(folders, "a1", null)).toBe(true)
	})

	it("rejects itself, its own subtree, and unknown folders", () => {
		expect(canReorderFolderInto(folders, "a", "a")).toBe(false)
		expect(canReorderFolderInto(folders, "a", "a1a")).toBe(false)
		expect(canReorderFolderInto(folders, "nope", null)).toBe(false)
	})
})

describe("reorderFolder", () => {
	const unordered = [
		mkFolder("a", null, "Alpha"),
		mkFolder("b", null, "Bravo"),
		mkFolder("c", null, "Charlie"),
	]

	it("materializes the whole group on the first hand placement", () => {
		// Charlie to the top: everyone gets an index, and Alpha/Bravo keep
		// the relative order the user was already looking at.
		const next = reorderFolder(unordered, "c", null, "a")
		expect(names(orderedSiblings(next, null))).toEqual([
			"Charlie",
			"Alpha",
			"Bravo",
		])
		expect(next.map((f) => f.sortIndex).every((i) => i !== undefined)).toBe(true)
	})

	it("appends when there is no anchor", () => {
		const next = reorderFolder(unordered, "a", null, null)
		expect(names(orderedSiblings(next, null))).toEqual([
			"Bravo",
			"Charlie",
			"Alpha",
		])
	})

	it("re-orders within an already-ordered group", () => {
		const ordered = [
			mkFolder("a", null, "Alpha", 0),
			mkFolder("b", null, "Bravo", 1),
			mkFolder("c", null, "Charlie", 2),
		]
		const next = reorderFolder(ordered, "b", null, null)
		expect(names(orderedSiblings(next, null))).toEqual([
			"Alpha",
			"Charlie",
			"Bravo",
		])
	})

	it("re-parents and positions in one move", () => {
		const folders = [
			mkFolder("p", null, "Parent"),
			mkFolder("p1", "p", "First"),
			mkFolder("p2", "p", "Second"),
			mkFolder("loose", null, "Loose"),
		]
		const next = reorderFolder(folders, "loose", "p", "p2")
		expect(names(orderedSiblings(next, "p"))).toEqual([
			"First",
			"Loose",
			"Second",
		])
		expect(next.find((f) => f.id === "loose")?.parentId).toBe("p")
		expect(orderedSiblings(next, null).map((f) => f.id)).toEqual(["p"])
	})

	it("leaves other groups untouched", () => {
		const folders = [
			mkFolder("a", null, "Alpha"),
			mkFolder("b", null, "Bravo"),
			mkFolder("x", "a", "Child"),
		]
		const next = reorderFolder(folders, "b", null, "a")
		expect(next.find((f) => f.id === "x")?.sortIndex).toBeUndefined()
	})

	it("is a no-op for an illegal or self-referential move", () => {
		const folders = [mkFolder("a", null), mkFolder("a1", "a")]
		expect(reorderFolder(folders, "a", "a1", null)).toEqual(folders)
		expect(reorderFolder(folders, "a1", "a", "a1")).toEqual(folders)
		expect(reorderFolder(folders, "ghost", null, null)).toEqual(folders)
	})
})

describe("insertionPointFor", () => {
	const folders = [
		mkFolder("a", null, "Alpha", 0),
		mkFolder("b", null, "Bravo", 1),
		mkFolder("c", null, "Charlie", 2),
	]

	it("resolves before to the anchor itself", () => {
		expect(insertionPointFor(folders, "c", folders[0]!, "before")).toEqual({
			parentId: null,
			beforeId: "a",
		})
	})

	it("resolves after to the anchor's next sibling", () => {
		expect(insertionPointFor(folders, "c", folders[0]!, "after")).toEqual({
			parentId: null,
			beforeId: "b",
		})
	})

	it("resolves after the last row to the end of the group", () => {
		expect(insertionPointFor(folders, "a", folders[2]!, "after")).toEqual({
			parentId: null,
			beforeId: null,
		})
	})

	it("skips the dragged folder when looking for the next sibling", () => {
		// Dropping Alpha just after Bravo, with Charlie following: the anchor's
		// "next" must be Charlie, not the lifted Alpha.
		const shuffled = [
			mkFolder("b", null, "Bravo", 0),
			mkFolder("a", null, "Alpha", 1),
			mkFolder("c", null, "Charlie", 2),
		]
		expect(insertionPointFor(shuffled, "a", shuffled[0]!, "after")).toEqual({
			parentId: null,
			beforeId: "c",
		})
	})
})

describe("clearSortIndex / nextSortIndex", () => {
	it("drops the key entirely so it serializes as absent", () => {
		const cleared = clearSortIndex(mkFolder("a", null, "Alpha", 3))
		expect("sortIndex" in cleared).toBe(false)
	})

	it("returns undefined for a group nobody has ordered", () => {
		expect(nextSortIndex([mkFolder("a", null)], null)).toBeUndefined()
	})

	it("returns one past the last placed sibling", () => {
		const folders = [
			mkFolder("a", null, "Alpha", 0),
			mkFolder("b", null, "Bravo", 4),
			mkFolder("c", "a", "Child", 9),
		]
		expect(nextSortIndex(folders, null)).toBe(5)
	})
})
