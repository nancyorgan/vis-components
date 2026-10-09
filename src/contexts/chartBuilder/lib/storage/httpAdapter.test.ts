import { afterEach, describe, expect, it, vi } from "vitest"
import { stringifyJsonDangerous } from "../../../../lib/json"
import { datasetContentHash } from "../datasetDedupe"
import { clearExampleOverlay, installExampleOverlay } from "../exampleOverlay"
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
		// `loadWholeDataset` reads the raw text (it doubles as the diff
		// baseline) and parses it itself.
		text: async () => stringifyJsonDangerous(body as never),
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
	it("diffs the record and sends uncompressed bodies", async () => {
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

	it("sends dataset and version bodies uncompressed, as plain JSON", async () => {
		const ds = {
			id: "ds-1",
			name: "One",
			fields: [],
			versions: [
				{ id: "dv-1", filename: "a.csv", createdAt: 0, rows: [{ a: "1" }] },
			],
		}
		const mock = stubFetch((path) =>
			path === "/api/datasets" ? okJson({}) : okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		await adapter.loadDatasets()
		mock.mockClear()
		await adapter.saveDatasets({ "ds-1": ds } as never)

		const writes = mock.mock.calls.filter(
			([, init]) => (init as RequestInit | undefined)?.method === "PUT"
		)
		expect(writes.length).toBeGreaterThan(0)
		for (const [, init] of writes) {
			const { headers, body } = init as RequestInit
			const names = Object.keys(headers as Record<string, string>).map((h) =>
				h.toLowerCase()
			)
			expect(names).not.toContain("content-encoding")
			expect((headers as Record<string, string>)["content-type"]).toBe(
				"application/json"
			)
			// A string body, not a Blob: nothing re-encoded the JSON.
			expect(typeof body).toBe("string")
			expect(() => JSON.parse(body as string)).not.toThrow()
		}
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
		// The content-version gate runs first — the lazy paths must consult
		// the migration seam — then the index; never a body.
		expect(calls(mock)).toEqual([
			"GET /api/content-versions",
			"GET /api/datasets?view=index",
		])
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
		// The derived metadata also carries a backfilled contentHash so
		// upload-time dedupe can compare against it without the rows.
		expect(index["ds-old"]).toEqual({
			id: "ds-old",
			name: "Legacy",
			fields: [],
			versions: [
				{ id: "dv-1", filename: "a.csv", createdAt: 0, rowCount: 1 },
			],
			contentHash: datasetContentHash(body as never),
		})
		// Derived once and written back — and the stale per-version bodies are
		// re-split from the fresh whole body, since a missing meta means
		// something (an old bundle, a crash) wrote the body without the
		// follow-ups.
		expect(calls(mock)).toEqual([
			"GET /api/content-versions",
			"GET /api/datasets?view=index",
			"GET /api/datasets/ds-old",
			"PUT /api/datasets/ds-old/versions/dv-1",
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
			"GET /api/content-versions",
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

// The default-theme pick is SHARED: it seeds every new visualization anyone
// creates on this server, so it must come from the server's settings
// collection, never this browser's localStorage.
describe("the shared default-theme setting", () => {
	it("reads the pick from the settings collection, null when unset", async () => {
		let settings: unknown[] = []
		const mock = stubFetch((path) =>
			path === "/api/settings" ? okJson(settings) : okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadUserDefaultThemeId()).toBeNull()
		settings = [{ id: "default-theme", themeId: "t-9" }]
		expect(await adapter.loadUserDefaultThemeId()).toBe("t-9")
		expect(calls(mock)).toEqual(["GET /api/settings", "GET /api/settings"])
	})

	it("PUTs the pick to the server so every user's next load sees it", async () => {
		const mock = stubFetch(() => okEmpty())
		const adapter = createHttpStorageAdapter()
		await adapter.saveUserDefaultThemeId("t-9")
		expect(calls(mock)).toEqual(["PUT /api/settings/default-theme"])
		const [, init] = mock.mock.calls[0]
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({
			id: "default-theme",
			themeId: "t-9",
		})
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

describe("per-version dataset bodies", () => {
	it("fetches only the version being drawn", async () => {
		const mock = stubFetch((path) =>
			path === "/api/datasets/ds-1/versions/dv-2"
				? okJson({ id: "dv-2", rows: [{ a: "1" }] })
				: okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadDatasetVersion("ds-1", "dv-2")).toEqual([
			{ a: "1" },
		])
		// Never the whole dataset — that is the entire point.
		expect(calls(mock)).toEqual([
			"GET /api/content-versions",
			"GET /api/datasets/ds-1/versions/dv-2",
		])
	})

	it("falls back to the whole body for a dataset stored before the split, and splits it", async () => {
		const whole = {
			id: "ds-old",
			name: "Legacy",
			fields: [],
			versions: [
				{ id: "dv-1", filename: "a.csv", createdAt: 0, rows: [{ a: "1" }] },
				{ id: "dv-2", filename: "b.csv", createdAt: 1, rows: [{ a: "2" }] },
			],
		}
		// Only the READ 404s — that is what "no per-version body stored yet"
		// looks like. The split's writes succeed, as they would on a real
		// server.
		const mock = stubFetch((path, init) =>
			path.startsWith("/api/datasets/ds-old/versions/")
				? (init?.method ?? "GET") === "GET"
					? new Response(null, { status: 404 })
					: okEmpty()
				: path === "/api/datasets/ds-old"
					? okJson(whole)
					: okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadDatasetVersion("ds-old", "dv-2")).toEqual([
			{ a: "2" },
		])

		const made = calls(mock)
		expect(made).toContain("GET /api/datasets/ds-old/versions/dv-2")
		expect(made).toContain("GET /api/datasets/ds-old")
		// Split on the way through, so the next open costs one version.
		expect(made).toContain("PUT /api/datasets/ds-old/versions/dv-1")
		expect(made).toContain("PUT /api/datasets/ds-old/versions/dv-2")
	})

	it("reports a version of a dataset the server does not have as null", async () => {
		const mock = stubFetch(() => new Response(null, { status: 404 }))
		const adapter = createHttpStorageAdapter()
		expect(await adapter.loadDatasetVersion("ds-gone", "dv-1")).toBeNull()
		expect(calls(mock)).toEqual([
			"GET /api/content-versions",
			"GET /api/datasets/ds-gone/versions/dv-1",
			"GET /api/datasets/ds-gone",
		])
	})

	// The regression that shipped in the first cut: the save updated its
	// record of what the server holds BEFORE diffing against it, so the
	// removed set was always empty and deleted versions' rows stayed on the
	// server (servable) forever.
	it("DELETEs a removed version's body on save", async () => {
		const meta = {
			id: "ds-1",
			name: "One",
			fields: [],
			versions: [
				{ id: "dv-1", filename: "a.csv", createdAt: 0, rowCount: 1 },
				{ id: "dv-2", filename: "b.csv", createdAt: 1, rowCount: 1 },
			],
		}
		const mock = stubFetch((path) =>
			path === "/api/datasets?view=index" ? okJson({ "ds-1": meta }) : okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		await adapter.loadDatasetIndex() // the server is known to hold dv-1+dv-2
		mock.mockClear()
		await adapter.saveDatasets({
			"ds-1": {
				id: "ds-1",
				name: "One",
				fields: [],
				latestVersionId: "dv-1",
				versions: [
					{ id: "dv-1", filename: "a.csv", createdAt: 0, rows: [{ a: "1" }] },
				],
			},
		} as never)
		const made = calls(mock)
		expect(made).toContain("DELETE /api/datasets/ds-1/versions/dv-2")
		// Metadata still goes LAST — a crash mid-sequence must read as
		// un-hydrated, never as stale.
		expect(made[made.length - 1]).toBe("PUT /api/datasets/ds-1/meta")
	})

	it("re-uploads no rows for a metadata-only version edit", async () => {
		const rows = [{ a: "1" }]
		const v1 = { id: "dv-1", filename: "a.csv", createdAt: 0, rows }
		const ds = {
			id: "ds-1",
			name: "One",
			fields: [],
			latestVersionId: "dv-1",
			versions: [v1],
		}
		const mock = stubFetch(() => okEmpty())
		const adapter = createHttpStorageAdapter()
		await adapter.saveDatasets({ "ds-1": ds } as never)
		mock.mockClear()
		// A note edit maps the version into a NEW object around the SAME rows
		// array — the skip-cache must key on the rows, or this re-uploads the
		// full row payload to persist a one-line note.
		const noted = { ...ds, versions: [{ ...v1, note: "checked" }] }
		await adapter.saveDatasets({ "ds-1": noted } as never)
		const made = calls(mock)
		expect(made).toContain("PUT /api/datasets/ds-1")
		expect(made).not.toContain("PUT /api/datasets/ds-1/versions/dv-1")
	})

	it("does not write metadata over a failed version sync", async () => {
		let failVersionPuts = true
		const ds = {
			id: "ds-1",
			name: "One",
			fields: [],
			latestVersionId: "dv-1",
			versions: [
				{ id: "dv-1", filename: "a.csv", createdAt: 0, rows: [{ a: "1" }] },
			],
		}
		const mock = stubFetch((path, init) =>
			failVersionPuts &&
			path.includes("/versions/") &&
			init?.method === "PUT"
				? failed()
				: okEmpty()
		)
		const adapter = createHttpStorageAdapter()
		// The body PUT nulled the server's meta; writing fresh meta over the
		// FAILED version sync would mask the stale version bodies from every
		// future repair pass — leaving meta null keeps the dataset flagged
		// for hydration instead.
		await expect(
			adapter.saveDatasets({ "ds-1": ds } as never)
		).rejects.toThrow(/500/)
		expect(calls(mock)).not.toContain("PUT /api/datasets/ds-1/meta")

		// And the failed save stayed out of the baseline: the retry re-runs
		// the full body + versions + meta sequence.
		failVersionPuts = false
		mock.mockClear()
		await adapter.saveDatasets({ "ds-1": ds } as never)
		expect(calls(mock)).toEqual([
			"PUT /api/datasets/ds-1",
			"PUT /api/datasets/ds-1/versions/dv-1",
			"PUT /api/datasets/ds-1/meta",
		])
	})

	it("marks body PUTs as versions-managed so the server keeps version rows", async () => {
		const mock = stubFetch(() => okEmpty())
		const adapter = createHttpStorageAdapter()
		await adapter.saveDatasets({
			"ds-1": { id: "ds-1", name: "One", fields: [], versions: [] },
		} as never)
		const put = mock.mock.calls.find(
			([path, init]) =>
				path === "/api/datasets/ds-1" &&
				(init as RequestInit | undefined)?.method === "PUT"
		)
		expect((put?.[1] as RequestInit).headers).toMatchObject({
			"x-vis-versions-managed": "1",
		})
	})

	it("retries a failed hydration read once instead of dropping the dataset", async () => {
		let first = true
		const body = { id: "ds-1", name: "One", fields: [], versions: [] }
		stubFetch((path) => {
			if (path === "/api/datasets?view=index") return okJson({ "ds-1": null })
			if (path === "/api/datasets/ds-1") {
				if (first) {
					first = false
					return failed()
				}
				return okJson(body)
			}
			return okEmpty()
		})
		const adapter = createHttpStorageAdapter()
		// One transient blip must not remove the dataset from the session's
		// whole index — an embed validating a pinned version against the index
		// would render a false "version no longer exists" for the visual.
		const index = await adapter.loadDatasetIndex()
		expect(index["ds-1"]).toMatchObject({ id: "ds-1", name: "One" })
	})
})

describe("the migration gate on lazy reads", () => {
	it("refuses a lazy read when the server's datasets are stamped newer", async () => {
		stubFetch(() => okEmpty(), { datasets: 999 })
		const adapter = createHttpStorageAdapter()
		await expect(adapter.loadDatasetIndex()).rejects.toThrow(/newer/i)
		await expect(adapter.loadDatasetVersion("ds-1", "dv-1")).rejects.toThrow(
			/newer/i
		)
	})

	it("stamps an unstamped server as current, once, and proceeds", async () => {
		const mock = stubFetch((path) =>
			path === "/api/datasets?view=index" ? okJson({}) : okEmpty()
		, {})
		const adapter = createHttpStorageAdapter()
		await adapter.loadDatasetIndex()
		await adapter.loadDatasetIndex()
		const stamps = calls(mock).filter((c) =>
			c.startsWith("PUT /api/content-versions/datasets")
		)
		expect(stamps).toHaveLength(1)
	})
})

describe("the example sandbox in server mode", () => {
	const seedDs = {
		id: "ds-seed",
		name: "Seed data",
		fields: [],
		versions: [{ id: "dv-seed", filename: "seed.csv", createdAt: 0, rows: [{ a: "1" }] }],
	}
	const seedDsMeta = {
		id: "ds-seed",
		name: "Seed data",
		fields: [],
		versions: [{ id: "dv-seed", filename: "seed.csv", createdAt: 0, rowCount: 1 }],
	}
	const seedVisual = {
		id: "seed-1",
		name: "Example",
		datasetId: "ds-seed",
		themeId: "th-seed",
		folderId: "f-seed",
		thumbnail: "data:image/png;base64,AAA",
	}
	const seedTheme = { id: "th-seed", name: "Seed theme", isSystem: false }
	const seedFolder = { id: "f-seed", name: "Examples", parentId: null, createdAt: 0 }

	/** As main.tsx installs it in server mode: nothing adopted up front. */
	const installSandbox = () =>
		installExampleOverlay(
			{
				visuals: [seedVisual],
				folders: [seedFolder],
				datasets: { "ds-seed": seedDs },
				themes: [seedTheme],
				userDefaultThemeId: "th-seed",
			} as never,
			[]
		)

	/** A server holding the given rows; everything else answers empty. */
	const server = (held: {
		visuals?: unknown[]
		folders?: unknown[]
		themes?: unknown[]
		index?: Record<string, unknown>
		bodies?: Record<string, unknown>
	}) =>
		stubFetch((path) => {
			if (path === "/api/visuals") return okJson(held.visuals ?? [])
			if (path === "/api/folders") return okJson(held.folders ?? [])
			if (path === "/api/themes") return okJson(held.themes ?? [])
			if (path === "/api/datasets?view=index") return okJson(held.index ?? {})
			const body = /^\/api\/datasets\/([^/?]+)$/.exec(path)
			if (body && held.bodies?.[body[1]!]) return okJson(held.bodies[body[1]!])
			return okEmpty()
		})

	/** What the atoms do at boot: the four collection loads. */
	const boot = async (adapter: ReturnType<typeof createHttpStorageAdapter>) => {
		await adapter.loadVisuals()
		await adapter.loadFolders()
		await adapter.loadThemes()
		await adapter.loadDatasetIndex()
	}

	afterEach(() => {
		clearExampleOverlay()
	})

	it("merges the examples into every load, and serves their rows from memory", async () => {
		installSandbox()
		const own = { id: "v1", name: "Mine", thumbnail: null }
		const mock = server({ visuals: [own] })
		const adapter = createHttpStorageAdapter()
		expect((await adapter.loadVisuals()).map((v) => v.id)).toEqual(["v1", "seed-1"])
		expect((await adapter.loadFolders()).map((f) => f.id)).toEqual(["f-seed"])
		expect(await adapter.loadThemes()).toBeNull()
		expect(Object.keys(await adapter.loadDatasetIndex())).toEqual(["ds-seed"])
		// The server has never heard of a seed dataset: no request for one.
		mock.mockClear()
		expect(await adapter.loadDataset("ds-seed")).toEqual(seedDs)
		expect(await adapter.loadDatasetVersion("ds-seed", "dv-seed")).toEqual([{ a: "1" }])
		expect(calls(mock)).toEqual([])
	})

	it("never writes an edited or deleted example to the server", async () => {
		installSandbox()
		const mock = server({})
		const adapter = createHttpStorageAdapter()
		await boot(adapter)
		mock.mockClear()
		await adapter.saveVisuals([{ ...seedVisual, name: "Edited" }] as never)
		await adapter.saveVisuals([] as never)
		await adapter.saveFolders([{ ...seedFolder, name: "Edited" }] as never)
		await adapter.saveDatasets({ "ds-seed": { ...seedDs, name: "Edited" } } as never)
		await adapter.deleteDatasets(["ds-seed"])
		await adapter.saveThemes([{ ...seedTheme, name: "Edited" }] as never)
		expect(calls(mock)).toEqual([])
	})

	it("persists a copy of an example together with the seed rows it points at", async () => {
		installSandbox()
		const mock = server({})
		const adapter = createHttpStorageAdapter()
		await boot(adapter)
		mock.mockClear()
		const copy = { ...seedVisual, id: "v-copy", name: "Example (copy)" }
		await adapter.saveVisuals([seedVisual, copy] as never)
		const made = calls(mock)
		expect(made).toContain("PUT /api/visuals/v-copy")
		expect(made).not.toContain("PUT /api/visuals/seed-1")
		// The dataset goes up as the usual triplet, plus the theme and folder.
		expect(made).toContain("PUT /api/datasets/ds-seed")
		expect(made).toContain("PUT /api/datasets/ds-seed/versions/dv-seed")
		expect(made).toContain("PUT /api/datasets/ds-seed/meta")
		expect(made).toContain("PUT /api/themes/th-seed")
		expect(made).toContain("PUT /api/folders/f-seed")

		// Promoted rows are the user's now: unchanged, they are not re-sent;
		// edited, they sync like anything else.
		mock.mockClear()
		await adapter.saveThemes([seedTheme] as never)
		await adapter.saveFolders([seedFolder] as never)
		expect(calls(mock)).toEqual([])
		await adapter.saveThemes([{ ...seedTheme, name: "Renamed" }] as never)
		expect(calls(mock)).toEqual(["PUT /api/themes/th-seed"])
	})

	it("adopts examples a library already holds from the old persist-once seeding", async () => {
		installSandbox()
		const persisted = { ...seedVisual, name: "Mine now" }
		const mock = server({
			visuals: [persisted],
			folders: [seedFolder],
			themes: [seedTheme],
			index: { "ds-seed": seedDsMeta },
		})
		const adapter = createHttpStorageAdapter()
		const loaded = await adapter.loadVisuals()
		// One copy — the server's — not a second from the bundle.
		expect(loaded.map((v) => v.id)).toEqual(["seed-1"])
		expect(loaded[0]!.name).toBe("Mine now")
		await adapter.loadFolders()
		await adapter.loadThemes()
		await adapter.loadDatasetIndex()
		mock.mockClear()
		// Theirs to edit and to delete, like any other row.
		await adapter.saveVisuals([{ ...persisted, name: "Edited" }] as never)
		expect(calls(mock)).toEqual(["PUT /api/visuals/seed-1"])
		mock.mockClear()
		await adapter.saveVisuals([] as never)
		expect(calls(mock)).toEqual(["DELETE /api/visuals/seed-1"])
	})

	it("learns what the server holds before promoting, even ahead of the boot loads", async () => {
		installSandbox()
		const mock = server({
			folders: [seedFolder],
			themes: [seedTheme],
			index: { "ds-seed": seedDsMeta },
		})
		const adapter = createHttpStorageAdapter()
		// Only the visuals have loaded when the copy is saved.
		await adapter.loadVisuals()
		mock.mockClear()
		const copy = { ...seedVisual, id: "v-copy", name: "Example (copy)" }
		await adapter.saveVisuals([seedVisual, copy] as never)
		const made = calls(mock)
		expect(made).toContain("GET /api/folders")
		expect(made).toContain("GET /api/themes")
		expect(made).toContain("GET /api/datasets?view=index")
		expect(made).toContain("PUT /api/visuals/v-copy")
		// The library's own copies of the seed rows are NOT overwritten.
		expect(made.filter((c) => c.startsWith("PUT "))).toEqual(["PUT /api/visuals/v-copy"])
	})

	it("reads a seed dataset from the server when the library holds its own copy", async () => {
		installSandbox()
		const theirs = { ...seedDs, name: "Seed data, edited" }
		server({ index: { "ds-seed": seedDsMeta }, bodies: { "ds-seed": theirs } })
		const adapter = createHttpStorageAdapter()
		await adapter.loadVisuals()
		// No index load yet — the adapter must find out rather than assume.
		expect(await adapter.loadDataset("ds-seed")).toEqual(theirs)
	})

	it("joins an in-flight index load instead of issuing a second one", async () => {
		installSandbox()
		const mock = server({})
		const adapter = createHttpStorageAdapter()
		await Promise.all([adapter.loadDatasetIndex(), adapter.loadDatasetIndex()])
		expect(calls(mock).filter((c) => c === "GET /api/datasets?view=index")).toHaveLength(1)
	})
})
