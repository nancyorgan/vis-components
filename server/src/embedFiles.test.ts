// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import {
	PAYLOAD_MARKER,
	composePartHtml,
	embedPartPath,
	isEmbedPart,
	isPublishId,
	publishEmbedFiles,
	unpublishEmbedFiles,
} from "./embedFiles.js"

const TEMPLATE = `<html><script type="application/json" id="embed-payload">${PAYLOAD_MARKER}</script></html>`
const ID = "01234567-89ab-4cde-8f01-23456789abcd"

let publishDir: string
beforeEach(() => {
	publishDir = mkdtempSync(join(tmpdir(), "vis-publish-"))
})

describe("isPublishId", () => {
	it("accepts only lowercase hyphenated UUIDs", () => {
		expect(isPublishId(ID)).toBe(true)
		expect(isPublishId(ID.toUpperCase())).toBe(false)
		expect(isPublishId("ei-123-abc")).toBe(false)
		expect(isPublishId("../escape")).toBe(false)
		expect(isPublishId("")).toBe(false)
	})
})

describe("isEmbedPart", () => {
	it("accepts exactly the three parts", () => {
		expect(isEmbedPart("full")).toBe(true)
		expect(isEmbedPart("chart")).toBe(true)
		expect(isEmbedPart("legend")).toBe(true)
		expect(isEmbedPart("index")).toBe(false)
		expect(isEmbedPart(3)).toBe(false)
	})
})

describe("composePartHtml", () => {
	it("injects a wrapper with version, part, and the payload verbatim", () => {
		const html = composePartHtml(TEMPLATE, "chart", '{"a":1}')
		expect(html).toContain('{"v":1,"part":"chart","payload":{"a":1}}')
		expect(html).not.toContain(PAYLOAD_MARKER)
	})

	it("escapes < so payload content can never terminate the script tag", () => {
		const payload = JSON.stringify({ tip: "</script><script>alert(1)" })
		const html = composePartHtml(TEMPLATE, "full", payload)
		expect(html).not.toContain("</script><script>alert")
		expect(html).toContain("\\u003c/script>\\u003cscript>")
	})

	it("does not mangle replacement patterns like $& in the payload", () => {
		const html = composePartHtml(TEMPLATE, "full", '{"t":"$& $` $\'"}')
		expect(html).toContain('{"t":"$& $` $\'"}')
	})

	it("refuses a template without the marker", () => {
		expect(() => composePartHtml("<html></html>", "full", "{}")).toThrow(
			/marker/
		)
	})
})

describe("publishEmbedFiles", () => {
	it("writes one verified file per part and returns file-naming paths", async () => {
		const paths = await publishEmbedFiles(publishDir, ID, TEMPLATE, '{"x":1}', [
			"full",
			"chart",
		])
		expect(paths).toEqual({
			full: `embeds/${ID}/index.html`,
			chart: `embeds/${ID}/chart.html`,
		})
		const dir = join(publishDir, "embeds", ID)
		expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(
			'"part":"full"'
		)
		expect(readFileSync(join(dir, "chart.html"), "utf-8")).toContain(
			'"part":"chart"'
		)
		expect(existsSync(join(dir, "legend.html"))).toBe(false)
		// Whole-file discipline: no temp files linger after a publish.
		expect(readdirSync(dir).sort()).toEqual(["chart.html", "index.html"])
	})

	it("republish rewrites in place and retires parts the request dropped", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, '{"x":1}', [
			"full",
			"chart",
			"legend",
		])
		await publishEmbedFiles(publishDir, ID, TEMPLATE, '{"x":2}', ["full"])
		const dir = join(publishDir, "embeds", ID)
		expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain('{"x":2}')
		expect(existsSync(join(dir, "chart.html"))).toBe(false)
		expect(existsSync(join(dir, "legend.html"))).toBe(false)
	})

	it("rejects an unsafe publish id before touching the filesystem", async () => {
		await expect(
			publishEmbedFiles(publishDir, "../../etc", TEMPLATE, "{}", ["full"])
		).rejects.toThrow(/Unsafe publish id/)
		expect(existsSync(join(publishDir, "embeds"))).toBe(false)
	})
})

describe("unpublishEmbedFiles", () => {
	it("deletes every part file and the embed directory", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, "{}", ["full", "legend"])
		await unpublishEmbedFiles(publishDir, ID)
		expect(existsSync(join(publishDir, "embeds", ID))).toBe(false)
	})

	it("is a no-op for an embed that was never published", async () => {
		await expect(unpublishEmbedFiles(publishDir, ID)).resolves.toBeUndefined()
	})
})

describe("embedPartPath", () => {
	it("always names a file, never a directory", () => {
		expect(embedPartPath(ID, "full")).toBe(`embeds/${ID}/index.html`)
		expect(embedPartPath(ID, "legend")).toBe(`embeds/${ID}/legend.html`)
	})
})
