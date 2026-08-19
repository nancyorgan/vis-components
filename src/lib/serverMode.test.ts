import { afterEach, describe, expect, it, vi } from "vitest"
import { parseServerModeConfig, probeServerMode } from "./serverMode"

const jsonResponse = (body: unknown, contentType = "application/json") =>
	({
		ok: true,
		headers: { get: () => contentType },
		json: async () => body,
	}) as unknown as Response

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("parseServerModeConfig", () => {
	it("accepts the exact expected shape", () => {
		expect(parseServerModeConfig({ v: 1, baseUrl: "https://x" })).toEqual({
			v: 1,
			baseUrl: "https://x",
		})
	})

	it("rejects anything else", () => {
		expect(parseServerModeConfig(null)).toBeNull()
		expect(parseServerModeConfig("html")).toBeNull()
		expect(parseServerModeConfig({ v: 2, baseUrl: "https://x" })).toBeNull()
		expect(parseServerModeConfig({ v: 1 })).toBeNull()
		expect(parseServerModeConfig({ baseUrl: "https://x" })).toBeNull()
	})
})

describe("probeServerMode", () => {
	it("resolves the config when the server answers properly", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({ v: 1, baseUrl: "https://charts" }))
		)
		expect(await probeServerMode()).toEqual({ v: 1, baseUrl: "https://charts" })
	})

	it("rejects a static host's SPA fallback (200 + HTML)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse("<title>app</title>", "text/html"))
		)
		expect(await probeServerMode()).toBeNull()
	})

	it("treats 404s and network errors as local mode, never throwing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false }) as unknown as Response)
		)
		expect(await probeServerMode()).toBeNull()
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("network down")
			})
		)
		expect(await probeServerMode()).toBeNull()
	})

	it("rejects JSON of the wrong shape", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ hello: true })))
		expect(await probeServerMode()).toBeNull()
	})
})
