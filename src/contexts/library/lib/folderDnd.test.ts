import { describe, expect, it } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import { emptyEncodings } from "../../chartBuilder/lib/types"
import {
	canDropFolderOn,
	decodeFolderDrag,
	decodeVisualsDrag,
	encodeFolderDrag,
	encodeVisualsDrag,
	rangeBetween,
	visibleVisualOrder,
} from "./folderDnd"

const mkFolder = (
	id: string,
	parentId: string | null,
	name = id
): Folder => ({ id, name, parentId, createdAt: 1 })

const mkVisual = (
	id: string,
	folderId: string | null,
	name = id
): Visual => ({
	id,
	name,
	folderId,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
})

// Tree used throughout:
//   A            (root)
//   ├── B        (child of A)
//   │   └── C    (child of B)
//   └── vis-a2, vis-a1   (visuals in A)
//   D            (root)
//   vis-root     (no folder)
const FOLDERS = [
	mkFolder("A", null),
	mkFolder("B", "A"),
	mkFolder("C", "B"),
	mkFolder("D", null),
]
const VISUALS = [
	mkVisual("vis-a1", "A", "zebra"),
	mkVisual("vis-a2", "A", "aardvark"),
	mkVisual("vis-b1", "B"),
	mkVisual("vis-root", null),
]

describe("canDropFolderOn", () => {
	it("allows a root folder into a sibling", () => {
		expect(canDropFolderOn(FOLDERS, "D", "A")).toBe(true)
	})
	it("allows a nested folder back to root (null target)", () => {
		expect(canDropFolderOn(FOLDERS, "C", null)).toBe(true)
	})
	it("rejects dropping a folder onto itself", () => {
		expect(canDropFolderOn(FOLDERS, "A", "A")).toBe(false)
	})
	it("rejects the current parent (no-op move)", () => {
		expect(canDropFolderOn(FOLDERS, "B", "A")).toBe(false)
		expect(canDropFolderOn(FOLDERS, "A", null)).toBe(false)
	})
	it("rejects a direct child (cycle)", () => {
		expect(canDropFolderOn(FOLDERS, "A", "B")).toBe(false)
	})
	it("rejects a deep descendant (cycle)", () => {
		expect(canDropFolderOn(FOLDERS, "A", "C")).toBe(false)
	})
	it("rejects an unknown drag id", () => {
		expect(canDropFolderOn(FOLDERS, "nope", "A")).toBe(false)
	})
})

describe("visibleVisualOrder", () => {
	it("matches render order: depth-first folders (name-sorted), subfolder subtrees before own visuals, root visuals last", () => {
		expect(visibleVisualOrder(FOLDERS, VISUALS, new Set())).toEqual([
			// inside A: subtree of B first, then A's own visuals name-sorted
			"vis-b1",
			"vis-a2", // "aardvark" sorts before "zebra"
			"vis-a1",
			// D has no visuals; unfoldered visuals last
			"vis-root",
		])
	})
	it("skips the contents of collapsed folders", () => {
		expect(visibleVisualOrder(FOLDERS, VISUALS, new Set(["B"]))).toEqual([
			"vis-a2",
			"vis-a1",
			"vis-root",
		])
		expect(visibleVisualOrder(FOLDERS, VISUALS, new Set(["A"]))).toEqual([
			"vis-root",
		])
	})
})

describe("rangeBetween", () => {
	const order = ["a", "b", "c", "d"]
	it("selects an inclusive range downward", () => {
		expect(rangeBetween(order, "a", "c")).toEqual(["a", "b", "c"])
	})
	it("selects an inclusive range upward", () => {
		expect(rangeBetween(order, "c", "a")).toEqual(["a", "b", "c"])
	})
	it("falls back to just the clicked id when the anchor is missing", () => {
		expect(rangeBetween(order, null, "b")).toEqual(["b"])
		expect(rangeBetween(order, "gone", "b")).toEqual(["b"])
	})
})

describe("drag payload round-trip", () => {
	it("round-trips a visuals payload", () => {
		expect(decodeVisualsDrag(encodeVisualsDrag(["v1", "v2"]))).toEqual({
			visualIds: ["v1", "v2"],
		})
	})
	it("round-trips a folder payload", () => {
		expect(decodeFolderDrag(encodeFolderDrag("f1"))).toEqual({
			folderId: "f1",
		})
	})
	it("returns null on garbage", () => {
		expect(decodeVisualsDrag("not json")).toBeNull()
		expect(decodeVisualsDrag('{"wrong": true}')).toBeNull()
		expect(decodeFolderDrag("")).toBeNull()
	})
})
