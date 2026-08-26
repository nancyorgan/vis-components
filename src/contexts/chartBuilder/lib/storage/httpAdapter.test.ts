import { afterEach, describe, expect, it, vi } from "vitest"
import { createHttpStorageAdapter } from "./httpAdapter"
import { CONTENT_MIGRATIONS } from "./migrations"

/** The content-version stamps a server written by THIS build carries — i.e.
 *  nothing to migrate. Tests about diffing shouldn't also be tests about
 *  migration, so the default stub serves these. */
const currentVersions = (): Record<string, number> =>
	Object.fromEntries(
		Object.entries(CONTENT_MIGRATIONS).map(([c, spec]) => [
			c,
			spec.currentVersion,
		])
	)

/** Every call fetch received, as "<METHOD> <path>". */
const calls = (mock: ReturnType<typeof vi.fn>): string[] =>
	mock.mock.calls.map(
		([path, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${path}`
	)

const okJson = (body: unknown) =>
	({
		ok: true,
		status: 200,
		json: async () => body,
	}) as unknown as Response

const okEmpty = () => ({ ok: true, status: 204 }) as unknown as Response

const failed = () => ({ ok: false, status: 500 }) as unknown as Response

/** `versions` is what GET /api/content-versions answers; pass a partial
 *  record (or `{}`) to exercise the migration paths. */
const stubFetch = (
	impl: (path: string, init?: RequestInit) => Response | Promise<Response>,
	versions: Record<string, number> = currentVersions()
) => {
	const mock = vi.fn(async (path: string, init?: RequestInit) =>
		path === "/api/content-versions" ? okJson(versions) : impl(path, init)
	)
	vi.stubGlobal("fetch", mock)
	return mock
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("diffing saves", () => {
	it("PUTs only changed/new items and DELETEs removed ones", async () => {
		const v1 = { id: "v1", name: "One", thumbnail: null }
		const v2 = { id: "v2", name: "Two", thumbnail: null }
		const mock = stubFetch((path) =>
			path === "/api/visuals" ? okJson([v1, v2]) : okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		await adapter.loadVisuals()
		expect(calls(mock)).toEqual([
			"GET /api/visuals",
			"GET /api/content-versions",
		])

		// v1 edited, v2 dropped, v3 added — the stale-but-unchanged case is the
		// point: nothing about v2's absence deletes anything another user made.
		mock.mockClear()
		const v3 = { id: "v3", name: "Three", thumbnail: null }
		await adapter.saveVisuals([{ ...v1, name: "One edited" }, v3] as never)
		expect(calls(mock).sort()).toEqual([
			"DELETE /api/visuals/v2",
			"PUT /api/visuals/v1",
			"PUT /api/visuals/v3",
		])

		// Saving the identical list again transmits nothing.
		mock.mockClear()
		await adapter.saveVisuals([{ ...v1, name: "One edited" }, v3] as never)
		expect(calls(mock)).toEqual([])
	})

	it("uses the id-keyed record shape for embed instances", async () => {
		const mock = stubFetch((path) =>
			path === "/api/embed-instances" ? okJson({ "ei-1": { id: "ei-1" } }) : okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		await adapter.loadEmbedInstances()
		mock.mockClear()
		await adapter.saveEmbedInstances({
			"ei-1": { id: "ei-1" },
			"ei-2": { id: "ei-2" },
		} as never)
		expect(calls(mock)).toEqual(["PUT /api/embed-instances/ei-2"])
	})

	it("retries only what failed: a failed PUT stays out of the baseline", async () => {
		let failPuts = true
		const mock = stubFetch((path, init) => {
			if (path === "/api/folders") return okJson([])
			if (init?.method === "PUT" && failPuts) return failed()
			return okEmpty()
		})
		const adapter = createHttpStorageAdapter()
		await adapter.loadFolders()
		await expect(
			adapter.saveFolders([{ id: "f1", name: "A" }] as never)
		).rejects.toThrow(/500/)

		failPuts = false
		mock.mockClear()
		await adapter.saveFolders([{ id: "f1", name: "A" }] as never)
		expect(calls(mock)).toEqual(["PUT /api/folders/f1"])
	})
})

describe("datasets", () => {
	it("diffs the record and sends bodies (identity when CompressionStream is absent)", async () => {
		const ds1 = { id: "ds-1", name: "One" }
		const mock = stubFetch((path) =>
			path === "/api/datasets" ? okJson({ "ds-1": ds1 }) : okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		await adapter.loadDatasets()
		mock.mockClear()
		await adapter.saveDatasets({
			"ds-1": ds1,
			"ds-2": { id: "ds-2", name: "Two" },
		} as never)
		// The unchanged ds-1 is not transmitted at all. The new ds-2 sends its
		// body and then its metadata — the body write clears the server's
		// stored metadata, so the follow-up is what keeps the index current.
		expect(calls(mock)).toEqual([
			"PUT /api/datasets/ds-2",
			"PUT /api/datasets/ds-2/meta",
		])
	})

	it("boots on the metadata index without fetching a single body", async () => {
		const meta = {
			id: "ds-1",
			name: "One",
			fields: [],
			versions: [{ id: "dv-1", filename: "a.csv", createdAt: 0, rowCount: 2 }],
		}
		const mock = stubFetch((path) =>
			path === "/api/datasets?view=index" ? okJson({ "ds-1": meta }) : okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadDatasetIndex()).toEqual({ "ds-1": meta })
		expect(calls(mock)).toEqual(["GET /api/datasets?view=index"])
	})

	it("hydrates a dataset the server has no metadata for, and stores the result", async () => {
		const body = {
			id: "ds-old",
			name: "Legacy",
			fields: [],
			versions: [
				{ id: "dv-1", filename: "a.csv", createdAt: 0, rows: [{ a: "1" }] },
			],
		}
		const mock = stubFetch((path) =>
			path === "/api/datasets?view=index"
				? okJson({ "ds-old": null })
				: path === "/api/datasets/ds-old"
					? okJson(body)
					: okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		const index = await adapter.loadDatasetIndex()

		// A null entry is a dataset awaiting hydration, never a missing one.
		expect(index["ds-old"]).toEqual({
			id: "ds-old",
			name: "Legacy",
			fields: [],
			versions: [
				{ id: "dv-1", filename: "a.csv", createdAt: 0, rowCount: 1 },
			],
		})
		// Derived once and written back, so no later session repeats the read.
		expect(calls(mock)).toEqual([
			"GET /api/datasets?view=index",
			"GET /api/datasets/ds-old",
			"PUT /api/datasets/ds-old/meta",
		])
	})

	it("reads one dataset body by id, and maps a 404 to null", async () => {
		const body = { id: "ds-1", name: "One", fields: [], versions: [] }
		const mock = stubFetch((path) =>
			path === "/api/datasets/ds-1"
				? okJson(body)
				: new Response(null, { status: 404 })
		)
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadDataset("ds-1")).toEqual(body)
		expect(await adapter.loadDataset("ds-gone")).toBeNull()
		expect(calls(mock)).toEqual([
			"GET /api/datasets/ds-1",
			"GET /api/datasets/ds-gone",
		])
	})
})

describe("themes", () => {
	it("maps an empty server to null so local first-run seeding applies", async () => {
		stubFetch(() => okJson([]))
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadThemes()).toBeNull()
	})

	it("returns stored themes as-is", async () => {
		const themes = [{ id: "t1", name: "Custom" }]
		stubFetch(() => okJson(themes))
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadThemes()).toEqual(themes)
	})
})

describe("content migrations", () => {
	// Themes v1 -> v2 backfills the ordinal-palette fields, so a v1-stamped
	// server is a real, shipped migration to assert against.
	const v1Theme = { id: "t1", name: "Custom" }

	it("migrates server data forward and returns the upgraded shape", async () => {
		stubFetch((path) => (path === "/api/themes" ? okJson([v1Theme]) : okEmpty()), {
			themes: 1,
		})
		const themes = await createHttpStorageAdapter().loadThemes()
		const migrated = themes?.[0] as unknown as Record<string, unknown>
		expect(Array.isArray(migrated.ordinalPalettes)).toBe(true)
		expect(typeof migrated.defaultOrdinalPaletteId).toBe("string")
	})

	it("persists the upgrade and the new stamp, so it happens once per server", async () => {
		const mock = stubFetch(
			(path) => (path === "/api/themes" ? okJson([v1Theme]) : okEmpty()),
			{ themes: 1 }
		)
		await createHttpStorageAdapter().loadThemes()
		expect(calls(mock)).toEqual([
			"GET /api/themes",
			"GET /api/content-versions",
			"PUT /api/themes/t1",
			"PUT /api/content-versions/themes",
		])
		const stamp = mock.mock.calls.at(-1)?.[1] as RequestInit
		expect(stamp.body).toBe(`{"v":${CONTENT_MIGRATIONS.themes.currentVersion}}`)
	})

	it("re-reads as a no-op once the server is stamped current", async () => {
		const mock = stubFetch((path) =>
			path === "/api/themes" ? okJson([v1Theme]) : okEmpty()
		)
		await createHttpStorageAdapter().loadThemes()
		expect(calls(mock)).toEqual(["GET /api/themes", "GET /api/content-versions"])
	})

	// An unstamped server can only hold rows written by a build at the current
	// shape (the stamp shipped with the first server that could outlive an app
	// update). Reading that as v0 would re-run every migration over
	// already-current data, so it must adopt instead — no item writes.
	it("adopts the current version when the server has no stamp", async () => {
		const mock = stubFetch(
			(path) => (path === "/api/themes" ? okJson([v1Theme]) : okEmpty()),
			{}
		)
		const themes = await createHttpStorageAdapter().loadThemes()
		expect(themes).toEqual([v1Theme])
		expect(calls(mock)).toEqual([
			"GET /api/themes",
			"GET /api/content-versions",
			"PUT /api/content-versions/themes",
		])
	})

	it("refuses to load data stamped newer than this build", async () => {
		const ahead = CONTENT_MIGRATIONS.visuals.currentVersion + 1
		stubFetch((path) => (path === "/api/visuals" ? okJson([]) : okEmpty()), {
			visuals: ahead,
		})
		await expect(createHttpStorageAdapter().loadVisuals()).rejects.toThrow(
			/content version/
		)
	})

	it("never writes when it refuses a newer-stamped collection", async () => {
		const mock = stubFetch(
			(path) => (path === "/api/visuals" ? okJson([{ id: "v1" }]) : okEmpty()),
			{ visuals: CONTENT_MIGRATIONS.visuals.currentVersion + 1 }
		)
		await createHttpStorageAdapter().loadVisuals().catch(() => undefined)
		expect(calls(mock).filter((c) => c.startsWith("PUT"))).toEqual([])
	})

	it("refuses rather than persisting a half-migrated collection", async () => {
		// The only unreachable guard otherwise: every shipped migration
		// succeeds on the shapes it's given, so inject one that throws.
		const original = CONTENT_MIGRATIONS.themes
		CONTENT_MIGRATIONS.themes = {
			currentVersion: 2,
			migrations: [
				() => {
					throw new Error("boom")
				},
				(raw) => raw,
			],
		}
		try {
			const mock = stubFetch(
				(path) => (path === "/api/themes" ? okJson([v1Theme]) : okEmpty()),
				{ themes: 0 }
			)
			await expect(createHttpStorageAdapter().loadThemes()).rejects.toThrow(
				/half-migrated/
			)
			expect(calls(mock).filter((c) => c.startsWith("PUT"))).toEqual([])
		} finally {
			CONTENT_MIGRATIONS.themes = original
		}
	})

	it("still returns migrated data when the stamp write fails", async () => {
		stubFetch(
			(path) => {
				if (path === "/api/themes") return okJson([v1Theme])
				if (path.startsWith("/api/content-versions/")) return failed()
				return okEmpty()
			},
			{ themes: 1 }
		)
		const themes = await createHttpStorageAdapter().loadThemes()
		const migrated = themes?.[0] as unknown as Record<string, unknown>
		expect(Array.isArray(migrated.ordinalPalettes)).toBe(true)
	})

	// A server binary older than this bundle has no such route. Same answer as
	// an unstamped server: adopt current. Stubs fetch directly because
	// `stubFetch` always answers the route.
	it("treats a server with no content-versions route as unstamped", async () => {
		const mock = vi.fn(async (path: string) => {
			if (path === "/api/content-versions") {
				return { ok: false, status: 404 } as unknown as Response
			}
			return path === "/api/themes" ? okJson([v1Theme]) : okEmpty()
		})
		vi.stubGlobal("fetch", mock)
		const themes = await createHttpStorageAdapter().loadThemes()
		expect(themes).toEqual([v1Theme])
		expect(calls(mock)).toContain("PUT /api/content-versions/themes")
	})

	// Folders are the one collection the frontend never versioned.
	it("leaves the unversioned folders collection alone", async () => {
		const mock = stubFetch((path) =>
			path === "/api/folders" ? okJson([{ id: "f1" }]) : okEmpty()
		)
		await createHttpStorageAdapter().loadFolders()
		expect(calls(mock)).toEqual(["GET /api/folders"])
	})
})

describe("capabilities", () => {
	it("declares remoteLoad so the atoms perform authoritative loads on mount", () => {
		expect(createHttpStorageAdapter().capabilities.remoteLoad).toBe(true)
	})
})
