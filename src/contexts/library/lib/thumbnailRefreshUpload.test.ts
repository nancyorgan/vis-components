import { createStore } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { stringifyJsonDangerous } from "../../../lib/json"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { localStorageAdapter } from "../../chartBuilder/lib/storage/adapter"
import { createHttpStorageAdapter } from "../../chartBuilder/lib/storage/httpAdapter"
import { CONTENT_MIGRATIONS } from "../../chartBuilder/lib/storage/migrations"
import { setStorageAdapter } from "../../chartBuilder/lib/storage/registry"
import type { Visual } from "../../chartBuilder/lib/types"
import { visualsAtom } from "../../chartBuilder/store/atoms"
import { withFreshThumbnail } from "./thumbnailBackfill"

/** The library's preview refresh writes `withFreshThumbnail(v, …)` into the
 *  visuals list, which saves the whole list. Its copy of a visual can be
 *  much older than the stored chart (edited in another tab, or by someone
 *  else, since the library loaded). The refresh must send ONLY the picture
 *  — re-sending that old body would overwrite the newer chart. */

const PNG = "data:image/png;base64,iVBORw0KGgo="

const json = (body: unknown) =>
	({
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => stringifyJsonDangerous(body as never),
	}) as unknown as Response

const oldCopy = {
	id: "v1",
	name: "As the library loaded it",
	folderId: null,
	datasetId: "ds-1",
	thumbnail: null,
	createdAt: 1,
	updatedAt: 5,
} as unknown as Visual

beforeEach(() => {
	installInMemoryLocalStorage()
	setStorageAdapter(createHttpStorageAdapter())
})

afterEach(() => {
	setStorageAdapter(localStorageAdapter)
	vi.unstubAllGlobals()
})

describe("library preview refresh in server mode", () => {
	it("uploads only the picture for an old in-memory copy", async () => {
		const versions = Object.fromEntries(
			Object.entries(CONTENT_MIGRATIONS).map(([c, s]) => [c, s.currentVersion])
		)
		const mock = vi.fn(async (path: string, init?: RequestInit) => {
			if ((init?.method ?? "GET") !== "GET")
				return { ok: true, status: 204 } as unknown as Response
			if (path === "/api/content-versions") return json(versions)
			return json(path.startsWith("/api/visuals") ? [oldCopy] : [])
		})
		vi.stubGlobal("fetch", mock)

		const store = createStore()
		const unsub = store.sub(visualsAtom, () => {})
		await vi.waitFor(() => expect(store.get(visualsAtom)).toHaveLength(1))
		mock.mockClear()

		// Exactly what useAutoRefreshThumbnails / RegeneratePreviewButton do.
		await store.set(visualsAtom, (prev) =>
			prev.map((v) => (v.id === "v1" ? withFreshThumbnail(v, PNG, 777) : v))
		)
		const writes = mock.mock.calls.map(
			([path, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${path}`
		)
		expect(writes).toEqual(["PUT /api/visuals/v1/thumbnail"])
		const [, init] = mock.mock.calls[0] as [string, RequestInit]
		expect((init.headers as Record<string, string>)["x-vis-thumbnail-at"]).toBe("777")
		unsub()
	})
})
