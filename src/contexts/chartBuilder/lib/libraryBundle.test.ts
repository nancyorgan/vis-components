import { afterEach, describe, expect, it, vi } from "vitest"
import { stringifyJsonDangerous } from "../../../lib/json"
import { createHttpStorageAdapter } from "./storage/httpAdapter"
import type { SeedBundle } from "./exampleSeed"
import {
	buildBundleFromSource,
	mergeBundleIntoLibrary,
	parseLibraryBundle,
	type BundleSource,
	type LibraryCollections,
} from "./libraryBundle"
import type { Dataset, Folder, SavedTheme, Visual } from "./types"

/* --------------------------------- fixtures ------------------------------ */

const vis = (over: Partial<Visual> & { id: string }): Visual =>
	({
		name: `Visual ${over.id}`,
		folderId: null,
		datasetId: null,
		createdAtVersionId: null,
		thumbnail: null,
		createdAt: 1,
		updatedAt: 1,
		...over,
	}) as unknown as Visual

const folder = (id: string, name: string, parentId: string | null): Folder => ({
	id,
	name,
	parentId,
	createdAt: 1,
})

const ds = (over: Partial<Dataset> & { id: string }): Dataset => ({
	name: "iris",
	fields: [{ name: "a", inferredType: "quantitative" }],
	versions: [
		{ id: "dv-1", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 1 },
	],
	latestVersionId: "dv-1",
	createdAt: 1,
	...over,
})

const theme = (id: string, isSystem = false): SavedTheme =>
	({ id, name: `Theme ${id}`, isSystem }) as unknown as SavedTheme

/** A theme whose NAME is what matters — the merge matches on it, so ids
 *  deliberately differ between the two sides. */
const named = (id: string, name: string, isSystem = false): SavedTheme =>
	({ id, name, isSystem }) as unknown as SavedTheme

const bundle = (over: Partial<SeedBundle> = {}): SeedBundle => ({
	exportedAt: "2026-08-24T00:00:00.000Z",
	visuals: [],
	folders: [],
	datasets: {},
	themes: [],
	userDefaultThemeId: null,
	...over,
})

const library = (over: Partial<LibraryCollections> = {}): LibraryCollections => ({
	visuals: [],
	folders: [],
	datasets: {},
	themes: [],
	userDefaultThemeId: null,
	...over,
})

/** Deterministic id minting so assertions can name the generated ids. */
const counter = () => {
	let n = 0
	return (prefix: string) => `${prefix}-new-${++n}`
}

const merge = (b: SeedBundle, existing: LibraryCollections) =>
	mergeBundleIntoLibrary(b, existing, { newId: counter(), now: 500 })

/* --------------------------------- parsing ------------------------------- */

describe("parseLibraryBundle", () => {
	it("rejects text that isn't JSON", () => {
		const result = parseLibraryBundle("not json {")
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error).toMatch(/valid JSON/)
	})

	it("rejects a JSON value that isn't an object", () => {
		expect(parseLibraryBundle("[1,2,3]").ok).toBe(false)
		expect(parseLibraryBundle('"hello"').ok).toBe(false)
		expect(parseLibraryBundle("null").ok).toBe(false)
	})

	it("rejects a malformed visual rather than importing it", () => {
		const result = parseLibraryBundle(
			stringifyJsonDangerous({ visuals: [{ id: "v1", name: "ok" }, { name: "no id" }] })
		)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error).toMatch(/#2/)
	})

	it("rejects a malformed folder", () => {
		const result = parseLibraryBundle(
			stringifyJsonDangerous({
				visuals: [{ id: "v1", name: "ok" }],
				folders: [{ id: "f1", name: "A", parentId: 7 }],
			})
		)
		expect(result.ok).toBe(false)
	})

	it("rejects a data set missing its versions", () => {
		const result = parseLibraryBundle(
			stringifyJsonDangerous({
				visuals: [{ id: "v1", name: "ok" }],
				datasets: { "ds-1": { id: "ds-1", name: "iris", fields: [] } },
			})
		)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error).toMatch(/ds-1/)
	})

	it("rejects a bundle with nothing in it", () => {
		expect(parseLibraryBundle(stringifyJsonDangerous({ visuals: [] })).ok).toBe(
			false
		)
	})

	it("accepts a well-formed bundle and defaults the optional keys", () => {
		const result = parseLibraryBundle(
			stringifyJsonDangerous({ visuals: [{ id: "v1", name: "ok" }] })
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.bundle.visuals).toHaveLength(1)
		expect(result.bundle.folders).toEqual([])
		expect(result.bundle.datasets).toEqual({})
		expect(result.bundle.themes).toEqual([])
		expect(result.bundle.exportedAt).toBeNull()
		expect(result.bundle.userDefaultThemeId).toBeNull()
	})

	it("round-trips a bundle produced by the exporter", () => {
		const source = bundle({ visuals: [vis({ id: "v1" })] })
		const result = parseLibraryBundle(stringifyJsonDangerous(source as never))
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.bundle.exportedAt).toBe(source.exportedAt)
	})
})

/* --------------------------------- folders ------------------------------- */

describe("mergeBundleIntoLibrary — folders", () => {
	it("reuses an existing folder with the same path and creates the missing child", () => {
		const existing = library({ folders: [folder("fl-a", "Work", null)] })
		const result = merge(
			bundle({
				folders: [
					folder("in-1", "Work", null),
					folder("in-2", "2026", "in-1"),
				],
				visuals: [vis({ id: "v1", folderId: "in-2" })],
			}),
			existing
		)
		expect(result.added.folders).toBe(1)
		// "Work" matched the local folder; only "2026" was created, under it.
		const created = result.folders.find((f) => f.name === "2026")
		expect(created?.id).toBe("fl-new-1")
		expect(created?.parentId).toBe("fl-a")
		expect(result.visuals[0]?.folderId).toBe("fl-new-1")
	})

	it("recreates a whole nested chain when nothing matches", () => {
		const result = merge(
			bundle({
				folders: [
					folder("in-2", "Drafts", "in-1"),
					folder("in-1", "Q3", null),
				],
				visuals: [vis({ id: "v1", folderId: "in-2" })],
			}),
			library()
		)
		expect(result.added.folders).toBe(2)
		const q3 = result.folders.find((f) => f.name === "Q3")
		const drafts = result.folders.find((f) => f.name === "Drafts")
		expect(q3?.parentId).toBeNull()
		expect(drafts?.parentId).toBe(q3?.id)
		expect(result.visuals[0]?.folderId).toBe(drafts?.id)
	})

	it("does not confuse same-named folders at different depths", () => {
		const existing = library({
			folders: [folder("fl-a", "Charts", null)],
		})
		const result = merge(
			bundle({
				folders: [
					folder("in-1", "Work", null),
					folder("in-2", "Charts", "in-1"),
				],
				visuals: [vis({ id: "v1", folderId: "in-2" })],
			}),
			existing
		)
		// The nested "Work ▸ Charts" is NOT the root-level "Charts".
		expect(result.added.folders).toBe(2)
		expect(result.visuals[0]?.folderId).not.toBe("fl-a")
	})

	it("drops a visual to the root when its folder reference is dangling", () => {
		const result = merge(
			bundle({ visuals: [vis({ id: "v1", folderId: "nope" })] }),
			library()
		)
		expect(result.visuals[0]?.folderId).toBeNull()
	})

	it("survives a cyclic folder chain without hanging", () => {
		const result = merge(
			bundle({
				folders: [folder("a", "A", "b"), folder("b", "B", "a")],
				visuals: [vis({ id: "v1", folderId: "a" })],
			}),
			library()
		)
		expect(result.added.folders).toBe(0)
		expect(result.visuals[0]?.folderId).toBeNull()
	})
})

/* --------------------------------- visuals ------------------------------- */

describe("mergeBundleIntoLibrary — visuals", () => {
	it("adds without touching existing work and keeps free incoming ids", () => {
		const mine = vis({ id: "v-mine", name: "Mine" })
		const result = merge(bundle({ visuals: [vis({ id: "v1" })] }), library({ visuals: [mine] }))
		expect(result.visuals).toHaveLength(2)
		expect(result.visuals[0]).toBe(mine)
		expect(result.visuals[1]?.id).toBe("v1")
		expect(result.added.visuals).toBe(1)
	})

	it("mints a fresh id when the incoming id is already taken", () => {
		const mine = vis({ id: "v1", name: "Mine" })
		const result = merge(
			bundle({ visuals: [vis({ id: "v1", name: "Theirs" })] }),
			library({ visuals: [mine] })
		)
		expect(result.visuals[0]?.name).toBe("Mine")
		expect(result.visuals[1]?.id).toBe("vs-new-1")
		expect(result.visuals[1]?.name).toBe("Theirs")
	})

	it("re-keys duplicate ids inside the bundle itself", () => {
		const result = merge(
			bundle({ visuals: [vis({ id: "v1" }), vis({ id: "v1" })] }),
			library()
		)
		expect(result.visuals.map((v) => v.id)).toEqual(["v1", "vs-new-1"])
	})

	it("nulls a datasetId the bundle doesn't carry", () => {
		const result = merge(
			bundle({ visuals: [vis({ id: "v1", datasetId: "ds-elsewhere" })] }),
			library({ datasets: { "ds-elsewhere": ds({ id: "ds-elsewhere" }) } })
		)
		expect(result.visuals[0]?.datasetId).toBeNull()
		expect(result.visuals[0]?.createdAtVersionId).toBeNull()
	})
})

/* -------------------------------- data sets ------------------------------ */

describe("mergeBundleIntoLibrary — data sets", () => {
	it("dedupes byte-identical data and repoints the visual, versions included", () => {
		const existing = library({ datasets: { "ds-mine": ds({ id: "ds-mine" }) } })
		const incoming = ds({
			id: "ds-theirs",
			versions: [
				{ id: "dv-theirs", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 9 },
			],
			latestVersionId: "dv-theirs",
		})
		const result = merge(
			bundle({
				datasets: { "ds-theirs": incoming },
				visuals: [
					vis({ id: "v1", datasetId: "ds-theirs", createdAtVersionId: "dv-theirs" }),
				],
			}),
			existing
		)
		expect(Object.keys(result.datasets)).toEqual(["ds-mine"])
		expect(result.added.datasets).toBe(0)
		expect(result.visuals[0]?.datasetId).toBe("ds-mine")
		expect(result.visuals[0]?.createdAtVersionId).toBe("dv-1")
	})

	it("adds a genuinely new data set under its own id", () => {
		const result = merge(
			bundle({
				datasets: { "ds-2": ds({ id: "ds-2", name: "cars" }) },
				visuals: [vis({ id: "v1", datasetId: "ds-2" })],
			}),
			library({ datasets: { "ds-1": ds({ id: "ds-1" }) } })
		)
		expect(Object.keys(result.datasets).sort()).toEqual(["ds-1", "ds-2"])
		expect(result.added.datasets).toBe(1)
		expect(result.visuals[0]?.datasetId).toBe("ds-2")
	})

	it("mints a fresh id when the same id holds different data", () => {
		const result = merge(
			bundle({
				datasets: { "ds-1": ds({ id: "ds-1", name: "cars" }) },
				visuals: [vis({ id: "v1", datasetId: "ds-1" })],
			}),
			library({ datasets: { "ds-1": ds({ id: "ds-1", name: "iris" }) } })
		)
		expect(result.datasets["ds-1"]?.name).toBe("iris")
		expect(result.datasets["ds-new-1"]?.name).toBe("cars")
		expect(result.visuals[0]?.datasetId).toBe("ds-new-1")
	})

	it("importing the same bundle twice duplicates visuals but not data", () => {
		const b = bundle({
			datasets: { "ds-1": ds({ id: "ds-1" }) },
			visuals: [vis({ id: "v1", datasetId: "ds-1" })],
			folders: [],
		})
		const once = merge(b, library())
		const twice = merge(b, once)
		expect(Object.keys(twice.datasets)).toEqual(["ds-1"])
		expect(twice.added.datasets).toBe(0)
		expect(twice.visuals).toHaveLength(2)
		// Both copies still point at the one stored data set.
		expect(twice.visuals.map((v) => v.datasetId)).toEqual(["ds-1", "ds-1"])
	})
})

/* --------------------------------- themes -------------------------------- */

describe("mergeBundleIntoLibrary — themes", () => {
	it("skips ids that already exist locally and ignores system themes", () => {
		const mine = theme("th-1")
		const system = theme("system-light", true)
		const result = merge(
			bundle({
				themes: [
					theme("th-1"), // same id as a local theme — must not overwrite
					theme("system-light", true),
					theme("th-2"),
				],
			}),
			library({ themes: [system, mine] })
		)
		expect(result.themes.slice(0, 2)).toEqual([system, mine])
		expect(result.themes).toHaveLength(3)
		expect(result.themes[2]?.id).toBe("th-2")
		expect(result.themes[2]?.isSystem).toBe(false)
		expect(result.added.themes).toBe(1)
		expect(result.reusedThemes).toBe(1)
	})

	it("reuses a same-named theme instead of importing a second copy", () => {
		const result = merge(
			bundle({
				visuals: [vis({ id: "v1", themeId: "th-theirs" })],
				themes: [named("th-theirs", " brand  ")],
				userDefaultThemeId: "th-theirs",
			}),
			library({ themes: [named("th-mine", "Brand")], userDefaultThemeId: null })
		)
		// One "Brand" in the library, and the imported visual points at it.
		expect(result.themes.map((t) => t.id)).toEqual(["th-mine"])
		expect(result.added.themes).toBe(0)
		expect(result.reusedThemes).toBe(1)
		expect(result.visuals[0]?.themeId).toBe("th-mine")
		// The default-theme pointer follows the same remap.
		expect(result.userDefaultThemeId).toBe("th-mine")
	})

	it("still imports a user theme that shares a system theme's name", () => {
		const result = merge(
			bundle({ themes: [named("th-1", "Light")] }),
			library({ themes: [named("system-light", "Light", true)] })
		)
		expect(result.themes.map((t) => t.id)).toEqual(["system-light", "th-1"])
		expect(result.added.themes).toBe(1)
		expect(result.reusedThemes).toBe(0)
	})

	it("collapses same-named themes carried twice inside one bundle", () => {
		const result = merge(
			bundle({
				visuals: [vis({ id: "v1", themeId: "th-b" })],
				themes: [named("th-a", "Brand"), named("th-b", "brand")],
			}),
			library()
		)
		expect(result.themes.map((t) => t.id)).toEqual(["th-a"])
		expect(result.reusedThemes).toBe(1)
		expect(result.visuals[0]?.themeId).toBe("th-a")
	})

	it("leaves a themeId alone when its theme didn't travel with the bundle", () => {
		const result = merge(
			bundle({ visuals: [vis({ id: "v1", themeId: "system-dark" })] }),
			library()
		)
		expect(result.visuals[0]?.themeId).toBe("system-dark")
	})

	it("keeps a local default-theme pick and only adopts one when there is none", () => {
		const kept = merge(
			bundle({ themes: [theme("th-2")], userDefaultThemeId: "th-2" }),
			library({ themes: [theme("th-1")], userDefaultThemeId: "th-1" })
		)
		expect(kept.userDefaultThemeId).toBe("th-1")

		const adopted = merge(
			bundle({ themes: [theme("th-2")], userDefaultThemeId: "th-2" }),
			library({ userDefaultThemeId: null })
		)
		expect(adopted.userDefaultThemeId).toBe("th-2")
	})

	it("never adopts a default pointing at a theme that didn't come along", () => {
		const result = merge(
			bundle({ visuals: [vis({ id: "v1" })], userDefaultThemeId: "th-gone" }),
			library({ userDefaultThemeId: null })
		)
		expect(result.userDefaultThemeId).toBeNull()
	})
})

/* ------------------------------ subset export ---------------------------- */

const source = (over: Partial<BundleSource> = {}): BundleSource => ({
	visuals: [],
	folders: [],
	datasets: {},
	themes: [],
	userDefaultThemeId: null,
	thumbnails: {},
	...over,
})

describe("buildBundleFromSource", () => {
	it("keeps only the asked-for visuals plus what they need", () => {
		const result = buildBundleFromSource(
			source({
				visuals: [
					vis({ id: "v1", datasetId: "ds-1", folderId: "fl-child", themeId: "th-1" }),
					vis({ id: "v2", datasetId: "ds-2", folderId: "fl-other" }),
				],
				folders: [
					folder("fl-root", "Work", null),
					folder("fl-child", "2026", "fl-root"),
					folder("fl-other", "Elsewhere", null),
				],
				datasets: { "ds-1": ds({ id: "ds-1" }), "ds-2": ds({ id: "ds-2" }) },
				themes: [theme("th-1"), theme("th-2"), theme("system-light", true)],
				thumbnails: { v1: "data:image/png;base64,AAA", v2: "data:x" },
			}),
			["v1"],
			"stamp"
		)
		expect(result.visuals.map((v) => v.id)).toEqual(["v1"])
		expect(result.visuals[0]?.thumbnail).toBe("data:image/png;base64,AAA")
		expect(Object.keys(result.datasets)).toEqual(["ds-1"])
		// The whole ancestry chain travels, so nesting survives the import.
		expect(result.folders.map((f) => f.id)).toEqual(["fl-root", "fl-child"])
		expect(result.themes.map((t) => t.id)).toEqual(["th-1"])
		expect(result.exportedAt).toBe("stamp")
	})

	it("carries no themes when the visuals reference none", () => {
		const result = buildBundleFromSource(
			source({ visuals: [vis({ id: "v1" })], themes: [theme("th-1")] }),
			["v1"]
		)
		expect(result.themes).toEqual([])
		expect(result.folders).toEqual([])
		expect(result.userDefaultThemeId).toBeNull()
	})

	it("only carries the default-theme pointer when that theme is included", () => {
		const included = buildBundleFromSource(
			source({
				visuals: [vis({ id: "v1", themeId: "th-1" })],
				themes: [theme("th-1")],
				userDefaultThemeId: "th-1",
			}),
			["v1"]
		)
		expect(included.userDefaultThemeId).toBe("th-1")

		const excluded = buildBundleFromSource(
			source({
				visuals: [vis({ id: "v1" })],
				themes: [theme("th-1")],
				userDefaultThemeId: "th-1",
			}),
			["v1"]
		)
		expect(excluded.userDefaultThemeId).toBeNull()
	})

	it("ignores ids that aren't in the library", () => {
		const result = buildBundleFromSource(
			source({ visuals: [vis({ id: "v1" })] }),
			["v1", "ghost"]
		)
		expect(result.visuals.map((v) => v.id)).toEqual(["v1"])
	})
})

/* --------------------------- export → import loop ------------------------ */

describe("export then import", () => {
	it("lands a subset bundle in a fresh library with its folder nesting intact", () => {
		const exported = buildBundleFromSource(
			source({
				visuals: [vis({ id: "v1", datasetId: "ds-1", folderId: "fl-child" })],
				folders: [
					folder("fl-root", "Work", null),
					folder("fl-child", "2026", "fl-root"),
				],
				datasets: { "ds-1": ds({ id: "ds-1" }) },
				thumbnails: { v1: "data:png" },
			}),
			["v1"]
		)
		const parsed = parseLibraryBundle(stringifyJsonDangerous(exported as never))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		const result = merge(parsed.bundle, library())
		expect(result.added).toEqual({
			visuals: 1,
			datasets: 1,
			folders: 2,
			themes: 0,
		})
		const child = result.folders.find((f) => f.name === "2026")
		const root = result.folders.find((f) => f.name === "Work")
		expect(child?.parentId).toBe(root?.id)
		expect(result.visuals[0]?.folderId).toBe(child?.id)
		expect(result.visuals[0]?.thumbnail).toBe("data:png")
	})
})

/* ------------------------------ server mode ------------------------------ */

describe("server mode", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("saving the merged collections transmits ONLY the imported items", async () => {
		const mine = vis({ id: "v-mine", folderId: "fl-mine" })
		const myFolder = folder("fl-mine", "Work", null)
		const serverState: Record<string, unknown> = {
			"/api/visuals": [mine],
			"/api/folders": [myFolder],
		}
		const fetchMock = vi.fn(async (path: string, init?: RequestInit) =>
			init?.method
				? ({ ok: true, status: 204 } as unknown as Response)
				: ({
						ok: true,
						status: 200,
						json: async () => serverState[path] ?? [],
					} as unknown as Response)
		)
		vi.stubGlobal("fetch", fetchMock)

		const adapter = createHttpStorageAdapter()
		const existing = library({
			visuals: await adapter.loadVisuals(),
			folders: await adapter.loadFolders(),
		})

		const merged = merge(
			bundle({
				folders: [folder("in-1", "Work", null), folder("in-2", "Q3", "in-1")],
				visuals: [vis({ id: "v-theirs", folderId: "in-2" })],
			}),
			existing
		)

		fetchMock.mockClear()
		await adapter.saveFolders(merged.folders)
		await adapter.saveVisuals(merged.visuals)
		const requests = fetchMock.mock.calls.map(
			([path, init]) => `${(init as RequestInit | undefined)?.method} ${path}`
		)
		// The recipient's own visual and folder are untouched (no PUT, no
		// DELETE); "Work" matched theirs, so only "Q3" and the new visual go.
		expect(requests.sort()).toEqual([
			"PUT /api/folders/fl-new-1",
			"PUT /api/visuals/v-theirs",
		])
	})
})
