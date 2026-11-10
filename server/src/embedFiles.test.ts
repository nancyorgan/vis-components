// @vitest-environment node
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import {
	composePartHtml,
	embedImagePath,
	embedPartPath,
	embedVectorPath,
	IMAGE_FILE,
	isEmbedPart,
	isPublishId,
	PAYLOAD_MARKER,
	publishEmbedFiles,
	publishEmbedImage,
	publishEmbedVector,
	unpublishEmbedFiles,
	VECTOR_FILE,
} from "./embedFiles.js"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])

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

	it("names the page after the visual, HTML-escaped", () => {
		const tpl = `<head><title>Chart embed</title></head>${TEMPLATE}`
		const html = composePartHtml(tpl, "full", "{}", 'Sales <Q1> & "more"')
		expect(html).toContain(
			"<title>Sales &lt;Q1&gt; &amp; &quot;more&quot;</title>"
		)
		expect(composePartHtml(tpl, "full", "{}")).toContain(
			"<title>Chart embed</title>"
		)
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

	it("republish deletes an existing picture so it never goes stale", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, '{"x":1}', ["full"])
		await publishEmbedImage(publishDir, ID, PNG)
		const dir = join(publishDir, "embeds", ID)
		expect(existsSync(join(dir, IMAGE_FILE))).toBe(true)
		await publishEmbedFiles(publishDir, ID, TEMPLATE, '{"x":2}', ["full"])
		expect(existsSync(join(dir, IMAGE_FILE))).toBe(false)
		expect(readdirSync(dir)).toEqual(["index.html"])
	})

	it("rejects an unsafe publish id before touching the filesystem", async () => {
		await expect(
			publishEmbedFiles(publishDir, "../../etc", TEMPLATE, "{}", ["full"])
		).rejects.toThrow(/Unsafe publish id/)
		expect(existsSync(join(publishDir, "embeds"))).toBe(false)
	})
})

describe("publishEmbedImage", () => {
	it("writes image.png into a published embed and returns its path", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, "{}", ["full"])
		expect(await publishEmbedImage(publishDir, ID, PNG)).toBe(
			`embeds/${ID}/image.png`
		)
		const dir = join(publishDir, "embeds", ID)
		expect(readFileSync(join(dir, "image.png")).equals(PNG)).toBe(true)
		// Whole-file discipline: no temp file lingers.
		expect(readdirSync(dir).sort()).toEqual(["image.png", "index.html"])
	})

	it("signals not-published with null and creates nothing", async () => {
		expect(await publishEmbedImage(publishDir, ID, PNG)).toBeNull()
		expect(existsSync(join(publishDir, "embeds"))).toBe(false)
	})

	it("rejects an unsafe publish id", async () => {
		await expect(publishEmbedImage(publishDir, "../../etc", PNG)).rejects.toThrow(
			/Unsafe publish id/
		)
	})
})

describe("unpublishEmbedFiles", () => {
	it("deletes the picture along with the parts, and the directory", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, "{}", ["full"])
		await publishEmbedImage(publishDir, ID, PNG)
		await unpublishEmbedFiles(publishDir, ID)
		expect(existsSync(join(publishDir, "embeds", ID))).toBe(false)
	})

	it("sweeps a picture even when it is the only file left", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, "{}", ["full"])
		const dir = join(publishDir, "embeds", ID)
		writeFileSync(join(dir, IMAGE_FILE), PNG)
		await unpublishEmbedFiles(publishDir, ID)
		expect(existsSync(dir)).toBe(false)
	})

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

describe("embedImagePath", () => {
	it("names image.png in the embed's folder and guards the id", () => {
		expect(embedImagePath(ID)).toBe(`embeds/${ID}/image.png`)
		expect(() => embedImagePath("../escape")).toThrow(/Unsafe publish id/)
	})
})

describe("publishEmbedVector", () => {
	const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', "utf-8")

	it("writes image.svg beside image.png and returns its path", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, "{}", ["full"])
		await publishEmbedImage(publishDir, ID, PNG)
		expect(await publishEmbedVector(publishDir, ID, SVG)).toBe(`embeds/${ID}/image.svg`)
		const dir = join(publishDir, "embeds", ID)
		expect(readFileSync(join(dir, VECTOR_FILE)).equals(SVG)).toBe(true)
		expect(readdirSync(dir).sort()).toEqual(["image.png", "image.svg", "index.html"])
	})

	it("signals not-published with null and creates nothing", async () => {
		expect(await publishEmbedVector(publishDir, ID, SVG)).toBeNull()
		expect(existsSync(join(publishDir, "embeds"))).toBe(false)
	})

	it("a republish retires both pictures; an unpublish sweeps a lone vector", async () => {
		await publishEmbedFiles(publishDir, ID, TEMPLATE, "{}", ["full"])
		await publishEmbedImage(publishDir, ID, PNG)
		await publishEmbedVector(publishDir, ID, SVG)
		await publishEmbedFiles(publishDir, ID, TEMPLATE, "{}", ["full"])
		const dir = join(publishDir, "embeds", ID)
		expect(readdirSync(dir)).toEqual(["index.html"])
		writeFileSync(join(dir, VECTOR_FILE), SVG)
		await unpublishEmbedFiles(publishDir, ID)
		expect(existsSync(dir)).toBe(false)
	})

	it("names image.svg in the embed's folder and guards the id", () => {
		expect(embedVectorPath(ID)).toBe(`embeds/${ID}/image.svg`)
		expect(() => embedVectorPath("../escape")).toThrow(/Unsafe publish id/)
	})
})
