import { afterEach, describe, expect, it, vi } from "vitest"
import { createHttpStorageAdapter } from "./httpAdapter"

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

const stubFetch = (
	impl: (path: string, init?: RequestInit) => Response | Promise<Response>
) => {
	const mock = vi.fn(async (path: string, init?: RequestInit) => impl(path, init))
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
		expect(calls(mock)).toEqual(["GET /api/visuals"])

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
		expect(calls(mock)).toEqual(["PUT /api/datasets/ds-2"])
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

describe("capabilities", () => {
	it("declares remoteLoad so the atoms perform authoritative loads on mount", () => {
		expect(createHttpStorageAdapter().capabilities.remoteLoad).toBe(true)
	})
})
