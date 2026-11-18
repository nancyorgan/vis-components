// @vitest-environment node
import { createHash } from "node:crypto"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { beforeEach, describe, expect, it } from "vitest"

import { composePartHtml, PAYLOAD_MARKER } from "./embedFiles.js"
import { validatePublicPayload } from "./publicEmbed.js"
import {
	convertPublishedEmbeds,
	installRuntimeFiles,
	prepareEmbedTemplate,
	RUNTIME_DIR,
	splitEmbedPage,
	withPublicPayload,
} from "./embedRuntimeFiles.js"

/** The embed app as shared files: split out of the page, installed under
 *  runtime/, and old published pages converted in place. */

// The app's code mentions the very tags the splitter looks for.
const APP_JS = 'const a="<style>x</style>";const b="<script type=\\"module\\">";run()'
const APP_CSS = ".chart{color:red}/* <script> */"
const page = (js = APP_JS, css = APP_CSS) =>
	"<!doctype html><html><head><title>Chart embed</title>" +
	"<!-- a <script> in a comment -->" +
	`<script type="module" crossorigin>${js}</script>` +
	`<style rel="stylesheet" crossorigin>${css}</style></head><body>` +
	`<script type="application/json" id="embed-payload">${PAYLOAD_MARKER}</script>` +
	'<div id="root"></div></body></html>'

const ID = "3d162347-9620-4f36-afa4-e080d3acdf7c"
/** What the publish host caches for a year. */
const CACHED_NAME = /^[a-z0-9-]+-[0-9a-f]{16,64}\.(js|css)$/
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

/** A payload as pages carried it before the public boundary: the stored
 *  records whole. */
const STORED_PAYLOAD = JSON.stringify({
	visual: {
		id: "vis-internal-1",
		name: "Sales",
		folderId: "fl-internal-1",
		datasetId: "ds-internal-1",
		themeId: null,
		encodings: { x: "Region" },
		tooltipConfig: { template: "<b>{Region}</b>" },
		thumbnail: null,
		createdAt: 1790000000001,
		updatedAt: 1790000000002,
		updatedBy: { id: "user-internal-1", name: "someone@example.com" },
	},
	dataset: {
		id: "ds-internal-1",
		name: "Quarterly numbers",
		fields: [{ name: "Region", inferredType: "categorical" }],
		versions: [
			{ id: "dv-internal-1", filename: "private file.csv", createdAt: 3, rows: [{ Region: "N" }] },
		],
		latestVersionId: "dv-internal-1",
		createdAt: 1790000000004,
	},
	theme: null,
	fonts: [],
})
const payloadOf = (html: string): { part: string; payload: unknown } =>
	JSON.parse(
		/<script type="application\/json" id="embed-payload">(.*?)<\/script>/s.exec(html)![1]!
	) as { part: string; payload: unknown }

let publishDir: string
beforeEach(() => {
	publishDir = mkdtempSync(join(tmpdir(), "vis-publish-"))
})
const runtimePath = (name: string) => join(publishDir, RUNTIME_DIR, name)
const publishOld = (file: string, html: string) => {
	mkdirSync(join(publishDir, "embeds", ID), { recursive: true })
	writeFileSync(join(publishDir, "embeds", ID, file), html)
}

describe("splitEmbedPage", () => {
	it("moves the app's script and stylesheet out, named by their own bytes", () => {
		const split = splitEmbedPage(page())
		if (split === null) throw new Error("expected a split")
		const [js, css] = split.files
		expect(js?.bytes.toString()).toBe(APP_JS)
		expect(css?.bytes.toString()).toBe(APP_CSS)
		for (const file of split.files) {
			expect(file.name).toMatch(CACHED_NAME)
			expect(sha(file.bytes).startsWith(file.name.split("-")[1]!.split(".")[0]!)).toBe(true)
		}
		expect(split.html).toContain(
			`<script type="module" src="../../runtime/${js?.name}"></script>`
		)
		expect(split.html).toContain(`<link rel="stylesheet" href="../../runtime/${css?.name}" />`)
		expect(split.html).not.toContain("run()")
		// Everything else is byte-for-byte what it was.
		expect(split.html).toContain("<!-- a <script> in a comment -->")
		expect(split.html).toContain(
			`<script type="application/json" id="embed-payload">${PAYLOAD_MARKER}</script>`
		)
	})

	it("leaves the payload alone, whatever it holds", () => {
		const published = composePartHtml(page(), "full", '{"note":"<style>a</style>"}', "T")
		const split = splitEmbedPage(published)
		expect(split?.files).toHaveLength(2)
		expect(split?.html).toContain('{"v":1,"part":"full","payload":{"note":"\\u003cstyle>')
	})

	it("returns null for a page already in the shared form", () => {
		const split = splitEmbedPage(page())
		expect(splitEmbedPage(split!.html)).toBeNull()
	})

	it("returns null for a page it can't read", () => {
		expect(splitEmbedPage('<script type="module">never closed')).toBeNull()
	})
})

describe("installRuntimeFiles", () => {
	const files = splitEmbedPage(page())!.files

	it("writes each file and a .gz that decompresses to the same bytes", async () => {
		await installRuntimeFiles(publishDir, files)
		for (const { name, bytes } of files) {
			expect(readFileSync(runtimePath(name)).equals(bytes)).toBe(true)
			expect(gunzipSync(readFileSync(runtimePath(`${name}.gz`))).equals(bytes)).toBe(true)
		}
	})

	it("repairs a damaged file and a damaged .gz, and deletes nothing", async () => {
		await installRuntimeFiles(publishDir, files)
		const { name, bytes } = files[0]!
		writeFileSync(runtimePath(name), "damaged")
		writeFileSync(runtimePath(`${name}.gz`), "not gzip")
		writeFileSync(runtimePath("embed-0123456789abcdef.js"), "an older release")
		await installRuntimeFiles(publishDir, files)
		expect(readFileSync(runtimePath(name)).equals(bytes)).toBe(true)
		expect(gunzipSync(readFileSync(runtimePath(`${name}.gz`))).equals(bytes)).toBe(true)
		expect(readFileSync(runtimePath("embed-0123456789abcdef.js"), "utf-8")).toBe(
			"an older release"
		)
		expect(readdirSync(join(publishDir, RUNTIME_DIR)).some((n) => n.endsWith(".tmp"))).toBe(false)
	})
})

describe("prepareEmbedTemplate", () => {
	it("installs the files before handing back the page that points at them", async () => {
		const shared = await prepareEmbedTemplate(publishDir, page())
		const names = [...shared.matchAll(/\.\.\/\.\.\/runtime\/([^"]+)"/g)].map((m) => m[1]!)
		expect(names).toHaveLength(2)
		for (const name of names) expect(existsSync(runtimePath(name))).toBe(true)
		expect(shared).toContain(PAYLOAD_MARKER)
	})

	it("installs a rebuilt template's files too", async () => {
		await prepareEmbedTemplate(publishDir, page())
		await prepareEmbedTemplate(publishDir, page("rebuilt()"))
		expect(readdirSync(join(publishDir, RUNTIME_DIR)).filter((n) => n.endsWith(".js"))).toHaveLength(2)
	})
})

describe("convertPublishedEmbeds", () => {
	it("moves an old page's own app out and keeps its payload", async () => {
		const old = composePartHtml(page("oldApp()"), "full", STORED_PAYLOAD, "Sales")
		publishOld("index.html", old)
		publishOld("image.png", "png bytes")
		const pass = await convertPublishedEmbeds(publishDir)
		expect(pass).toEqual({ converted: 1, current: 0, failed: [] })
		const converted = readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")
		expect(converted).toBe(withPublicPayload(splitEmbedPage(old)!.html))
		expect(converted).toContain("<title>Sales</title>")
		// The page runs the app it was published with, not this build's.
		const js = /runtime\/(embed-[0-9a-f]+\.js)/.exec(converted)![1]!
		expect(readFileSync(runtimePath(js), "utf-8")).toBe("oldApp()")
		expect(readFileSync(join(publishDir, "embeds", ID, "image.png"), "utf-8")).toBe("png bytes")
	})

	it("leaves only public fields in an old page's payload", async () => {
		publishOld("chart.html", composePartHtml(page(), "chart", STORED_PAYLOAD))
		await convertPublishedEmbeds(publishDir)
		const converted = readFileSync(join(publishDir, "embeds", ID, "chart.html"), "utf-8")
		for (const text of [
			"someone@example.com",
			"updatedBy",
			"internal",
			"private file.csv",
			"Quarterly numbers",
			"1790000000",
		]) {
			expect(converted).not.toContain(text)
		}
		const { part, payload } = payloadOf(converted)
		expect(part).toBe("chart")
		expect(validatePublicPayload(payload)).toBeNull()
		expect(payload).toMatchObject({
			visual: { id: "embed", name: "Sales", encodings: { x: "Region" } },
			dataset: { versions: [{ rows: [{ Region: "N" }] }] },
		})
		// Still nothing in the payload can end its script tag.
		expect(converted).toContain("\\u003cb>{Region}\\u003c/b>")
	})

	it("cleans the payload of a page whose app is already shared", async () => {
		const shared = splitEmbedPage(composePartHtml(page(), "full", STORED_PAYLOAD))!.html
		publishOld("index.html", shared)
		expect(await convertPublishedEmbeds(publishDir)).toEqual({
			converted: 1,
			current: 0,
			failed: [],
		})
		const converted = readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")
		expect(converted).not.toContain("updatedBy")
		expect(validatePublicPayload(payloadOf(converted).payload)).toBeNull()
	})

	it("is safe to run again", async () => {
		publishOld("index.html", composePartHtml(page(), "full", STORED_PAYLOAD))
		publishOld("chart.html", composePartHtml(page(), "chart", STORED_PAYLOAD))
		await convertPublishedEmbeds(publishDir)
		const before = readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")
		expect(await convertPublishedEmbeds(publishDir)).toEqual({
			converted: 0,
			current: 2,
			failed: [],
		})
		expect(readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")).toBe(before)
	})

	it("leaves a page with no readable payload untouched and reports it", async () => {
		publishOld("index.html", composePartHtml(page(), "full", '{"rows":[]}'))
		const before = readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")
		const pass = await convertPublishedEmbeds(publishDir)
		expect(pass.converted).toBe(0)
		expect(pass.failed[0]?.reason).toContain("holds no visual")
		expect(readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")).toBe(before)
	})

	it("leaves a page it can't convert untouched and reports it", async () => {
		publishOld("index.html", composePartHtml(page(), "full", STORED_PAYLOAD))
		// runtime/ can't be created: a file sits where the folder goes.
		writeFileSync(join(publishDir, RUNTIME_DIR), "in the way")
		const before = readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")
		const pass = await convertPublishedEmbeds(publishDir)
		expect(pass.converted).toBe(0)
		expect(pass.failed).toHaveLength(1)
		expect(pass.failed[0]?.path).toBe(`embeds/${ID}/index.html`)
		expect(readFileSync(join(publishDir, "embeds", ID, "index.html"), "utf-8")).toBe(before)
	})

	it("does nothing when nothing is published", async () => {
		expect(await convertPublishedEmbeds(publishDir)).toEqual({
			converted: 0,
			current: 0,
			failed: [],
		})
	})
})
