import { afterEach, describe, expect, it, vi } from "vitest"
import {
	publishEmbedImageRequest,
	publishEmbedRequest,
	publishEmbedVectorRequest,
} from "./embedPublish"
import { pngFileFromDataUrl } from "./storage/thumbnailUpload"

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

describe("publishEmbedImageRequest", () => {
	// 1×1 transparent PNG.
	const PNG =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

	it("PUTs one multipart file part named image and returns the url", async () => {
		const mock = vi.fn(
			async (_path: string, _init?: RequestInit) =>
				({
					ok: true,
					status: 200,
					json: async () => ({ v: 1, url: "https://x/embeds/pub-1/image.png" }),
				}) as unknown as Response
		)
		vi.stubGlobal("fetch", mock)

		const png = pngFileFromDataUrl(PNG, "image.png")
		expect(png).not.toBeNull()
		const url = await publishEmbedImageRequest("pub-1", png!)
		expect(url).toBe("https://x/embeds/pub-1/image.png")

		const [path, init] = mock.mock.calls[0]
		expect(path).toBe("/api/embeds/pub-1/image")
		expect(init!.method).toBe("PUT")
		const headers = init!.headers as Record<string, string>
		const names = Object.keys(headers).map((h) => h.toLowerCase())
		expect(names).not.toContain("content-type")
		expect(names).not.toContain("content-encoding")
		expect(names).toContain("x-vis-content-version")

		expect(init!.body).toBeInstanceOf(FormData)
		const entries = [...(init!.body as FormData).entries()]
		expect(entries).toHaveLength(1)
		const [field, file] = entries[0]
		expect(field).toBe("image")
		expect(file).toBeInstanceOf(File)
		expect((file as File).name).toBe("image.png")
		expect((file as File).type).toBe("image/png")
	})

	it("throws on a non-ok response or an unexpected body", async () => {
		const png = pngFileFromDataUrl(PNG, "image.png")!
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response)
		)
		await expect(publishEmbedImageRequest("pub-1", png)).rejects.toThrow()
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					({ ok: true, status: 200, json: async () => ({ v: 1 }) }) as unknown as Response
			)
		)
		await expect(publishEmbedImageRequest("pub-1", png)).rejects.toThrow()
	})
})

describe("publishEmbedVectorRequest", () => {
	const svgFile = () =>
		new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "image.svg", { type: "image/svg+xml" })

	it("PUTs one multipart file part named vector to the sibling route and returns the url", async () => {
		const mock = vi.fn(
			async (_path: string, _init?: RequestInit) =>
				({
					ok: true,
					status: 200,
					json: async () => ({ v: 1, url: "https://x/embeds/pub-1/image.svg" }),
				}) as unknown as Response
		)
		vi.stubGlobal("fetch", mock)
		expect(await publishEmbedVectorRequest("pub-1", svgFile())).toBe(
			"https://x/embeds/pub-1/image.svg"
		)
		const [path, init] = mock.mock.calls[0]
		expect(path).toBe("/api/embeds/pub-1/vector")
		expect(init!.method).toBe("PUT")
		const entries = [...(init!.body as FormData).entries()]
		expect(entries).toHaveLength(1)
		expect(entries[0][0]).toBe("vector")
		expect((entries[0][1] as File).type).toBe("image/svg+xml")
	})

	it("throws on a refused vector (400)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response)
		)
		await expect(publishEmbedVectorRequest("pub-1", svgFile())).rejects.toThrow(/HTTP 400/)
	})
})
