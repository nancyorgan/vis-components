import { afterEach, describe, expect, it, vi } from "vitest"
import { publishEmbedRequest } from "./embedPublish"

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("publishEmbedRequest", () => {
	it("PUTs the body uncompressed, as plain JSON", async () => {
		const mock = vi.fn(
			async (_path: string, _init?: RequestInit) =>
				({
					ok: true,
					status: 200,
					json: async () => ({ v: 1, urls: { full: "https://x/full.html" } }),
				}) as unknown as Response
		)
		vi.stubGlobal("fetch", mock)

		const urls = await publishEmbedRequest(
			"pub-1",
			["full"],
			{ hello: "world" } as never
		)
		expect(urls).toEqual({ full: "https://x/full.html" })

		const [path, init] = mock.mock.calls[0]
		expect(path).toBe("/api/embeds/pub-1")
		expect(init!.method).toBe("PUT")
		const headers = init!.headers as Record<string, string>
		expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain(
			"content-encoding"
		)
		expect(headers["content-type"]).toBe("application/json")
		// A string body, not a Blob: the JSON goes over the wire as written.
		expect(typeof init!.body).toBe("string")
		expect(JSON.parse(init!.body as string)).toEqual({
			v: 1,
			parts: ["full"],
			payload: { hello: "world" },
		})
	})
})
