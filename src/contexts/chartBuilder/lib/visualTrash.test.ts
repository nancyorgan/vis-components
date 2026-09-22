import { describe, expect, it } from "vitest"
import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { SYSTEM_LIGHT_THEME } from "./systemThemes"
import { labelsFromTheme } from "./themeConfig"
import { emptyEncodings, type Folder, type Visual } from "./types"
import { isTrashed, restoreVisuals, trashVisuals } from "./visualTrash"

const visual = (id: string, over: Partial<Visual> = {}): Visual => ({
	id,
	name: id,
	folderId: null,
	datasetId: "ds",
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: labelsFromTheme(SYSTEM_LIGHT_THEME),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...over,
})

const folder = (id: string): Folder => ({
	id,
	name: id,
	parentId: null,
	createdAt: 1,
})

describe("trashVisuals", () => {
	it("stamps deletedAt on the named visuals and leaves the rest alone", () => {
		const out = trashVisuals([visual("a"), visual("b")], ["a"], 1000)
		expect(out[0].deletedAt).toBe(1000)
		expect(isTrashed(out[0])).toBe(true)
		expect(out[1].deletedAt).toBeUndefined()
		expect(isTrashed(out[1])).toBe(false)
	})

	it("keeps the original stamp on an already-trashed visual", () => {
		const out = trashVisuals([visual("a", { deletedAt: 5 })], ["a"], 1000)
		expect(out[0].deletedAt).toBe(5)
	})

	it("keeps folder, thumbnail and data set so Restore can put it back", () => {
		const out = trashVisuals(
			[visual("a", { folderId: "f", thumbnail: "data:x", datasetId: "d" })],
			["a"],
			1
		)
		expect(out[0]).toMatchObject({
			folderId: "f",
			thumbnail: "data:x",
			datasetId: "d",
		})
	})
})

describe("restoreVisuals", () => {
	it("drops deletedAt and leaves untargeted visuals alone", () => {
		const out = restoreVisuals(
			[visual("a", { deletedAt: 5 }), visual("b", { deletedAt: 6 })],
			["a"],
			[]
		)
		expect("deletedAt" in out[0]).toBe(false)
		expect(out[1].deletedAt).toBe(6)
	})

	it("moves a visual to the root when its folder is gone", () => {
		const out = restoreVisuals(
			[
				visual("a", { deletedAt: 5, folderId: "gone" }),
				visual("b", { deletedAt: 5, folderId: "kept" }),
			],
			["a", "b"],
			[folder("kept")]
		)
		expect(out[0].folderId).toBeNull()
		expect(out[1].folderId).toBe("kept")
	})

	it("suffixes the name when a live visual has taken it", () => {
		const out = restoreVisuals(
			[visual("live", { name: "Sales" }), visual("t", { name: "sales ", deletedAt: 5 })],
			["t"],
			[]
		)
		expect(out[1].name).toBe("sales  (restored)")
	})

	it("gives two same-named restores distinct names", () => {
		const out = restoreVisuals(
			[
				visual("t1", { name: "Sales", deletedAt: 5 }),
				visual("t2", { name: "Sales", deletedAt: 6 }),
			],
			["t1", "t2"],
			[]
		)
		expect(out[0].name).toBe("Sales")
		expect(out[1].name).toBe("Sales (restored)")
	})

	it("does not touch a live visual named in the ids", () => {
		const live = visual("a")
		const out = restoreVisuals([live], ["a"], [])
		expect(out[0]).toBe(live)
	})
})
