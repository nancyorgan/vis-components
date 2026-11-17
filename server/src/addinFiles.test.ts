// @vitest-environment node
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
import { beforeEach, describe, expect, it } from "vitest"

import {
	ADDIN_DIR,
	installAddin,
	MANIFEST_FILE,
	MANIFEST_TEMPLATE,
	renderAddinManifest,
} from "./addinFiles.js"

/** The PowerPoint add-in installed from the build into the publish dir. */

const TEMPLATE =
	'<OfficeApp><IconUrl DefaultValue="{{ADDIN_BASE_URL}}/icon-32.png"/>' +
	"<AppDomain>{{ADDIN_ORIGIN}}</AppDomain>" +
	'<SourceLocation DefaultValue="{{ADDIN_BASE_URL}}/taskpane.html"/></OfficeApp>'

let distDir: string
let publishDir: string
beforeEach(() => {
	distDir = mkdtempSync(join(tmpdir(), "vis-dist-"))
	publishDir = mkdtempSync(join(tmpdir(), "vis-publish-"))
})

const shipAddin = (files: Record<string, string>) => {
	mkdirSync(join(distDir, ADDIN_DIR), { recursive: true })
	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(distDir, ADDIN_DIR, name), body)
	}
}

describe("renderAddinManifest", () => {
	it("fills in the add-in folder and the publish origin", () => {
		const xml = renderAddinManifest(TEMPLATE, "https://publish.example.com")
		expect(xml).toContain('"https://publish.example.com/addin/icon-32.png"')
		expect(xml).toContain('"https://publish.example.com/addin/taskpane.html"')
		expect(xml).toContain("<AppDomain>https://publish.example.com</AppDomain>")
		expect(xml).not.toContain("{{")
	})

	it("keeps a path prefix on the folder but not on the origin, and escapes XML", () => {
		const xml = renderAddinManifest(TEMPLATE, "https://example.com/pub?a=1&b=2")
		expect(xml).toContain("https://example.com/pub?a=1&amp;b=2/addin/taskpane.html")
		expect(xml).toContain("<AppDomain>https://example.com</AppDomain>")
	})
})

describe("installAddin", () => {
	it("skips, without touching the publish dir, when the build has no add-in", async () => {
		const result = await installAddin(distDir, publishDir, "https://publish.example.com")
		expect(result.installed).toBe(false)
		expect(readdirSync(publishDir)).toEqual([])
	})

	it("skips when dist/addin/ has no manifest template", async () => {
		shipAddin({ "taskpane.html": "<html></html>" })
		const result = await installAddin(distDir, publishDir, "https://publish.example.com")
		expect(result).toEqual({ installed: false, reason: `dist/addin/ has no ${MANIFEST_TEMPLATE}` })
	})

	it("copies the files and writes manifest.xml (not the template) with this deployment's URLs", async () => {
		shipAddin({ "taskpane.html": "<html>pane</html>", "zafiro.js": "// js", [MANIFEST_TEMPLATE]: TEMPLATE })
		const result = await installAddin(distDir, publishDir, "https://publish.example.com")
		expect(result).toEqual({
			installed: true,
			files: 3,
			manifestUrl: "https://publish.example.com/addin/manifest.xml",
			https: true,
		})
		const target = join(publishDir, ADDIN_DIR)
		expect(readdirSync(target).sort()).toEqual([MANIFEST_FILE, "taskpane.html", "zafiro.js"])
		expect(readFileSync(join(target, "taskpane.html"), "utf-8")).toBe("<html>pane</html>")
		expect(readFileSync(join(target, MANIFEST_FILE), "utf-8")).toBe(
			renderAddinManifest(TEMPLATE, "https://publish.example.com")
		)
	})

	it("removes files an earlier build installed, and leaves the embeds alone", async () => {
		const embed = join(publishDir, "embeds", "01234567-89ab-4cde-8f01-23456789abcd")
		mkdirSync(embed, { recursive: true })
		writeFileSync(join(embed, "index.html"), "<html>chart</html>")
		mkdirSync(join(publishDir, ADDIN_DIR))
		writeFileSync(join(publishDir, ADDIN_DIR, "old.js"), "// gone next start")
		shipAddin({ "taskpane.html": "<html></html>", [MANIFEST_TEMPLATE]: TEMPLATE })

		await installAddin(distDir, publishDir, "https://publish.example.com")

		expect(existsSync(join(publishDir, ADDIN_DIR, "old.js"))).toBe(false)
		expect(readFileSync(join(embed, "index.html"), "utf-8")).toBe("<html>chart</html>")
	})

	it("installs over http too, reporting that Office won't load it", async () => {
		shipAddin({ [MANIFEST_TEMPLATE]: TEMPLATE })
		const result = await installAddin(distDir, publishDir, "http://localhost:8098")
		expect(result).toMatchObject({ installed: true, https: false })
	})
})
