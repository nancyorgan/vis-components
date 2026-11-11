// @vitest-environment node
import { mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { checkFileName, resolveExportFolder, snapshotFolder, writeExportFile } from "./files"
import { tempDir } from "./testStub"

const HOME = "/home/pat"

describe("resolveExportFolder", () => {
	const at = (value: string | undefined) => resolveExportFolder(value === undefined ? {} : { VIS_EXPORT_DIR: value }, HOME)

	it("defaults to Downloads/Zafiro when unset, blank or relative", () => {
		expect(at(undefined)).toBe(join(HOME, "Downloads", "Zafiro"))
		expect(at("   ")).toBe(join(HOME, "Downloads", "Zafiro"))
		expect(at("Charts")).toBe(join(HOME, "Downloads", "Zafiro"))
	})

	it("expands a leading ~ or ${HOME}", () => {
		expect(at("~/Desktop/Charts")).toBe(join(HOME, "Desktop", "Charts"))
		expect(at("${HOME}/Charts")).toBe(join(HOME, "Charts"))
		expect(at("~")).toBe(HOME)
		// Only a leading home marker.
		expect(at("~pat/Charts")).toBe(join(HOME, "Downloads", "Zafiro"))
	})

	it("keeps an absolute folder", () => {
		expect(at("/srv/exports/")).toBe("/srv/exports")
	})
})

describe("checkFileName", () => {
	it("refuses a path", () => {
		expect(checkFileName("../Board")).toMatchObject({ ok: false, reason: expect.stringContaining("not a path") })
		expect(checkFileName("a\\b")).toMatchObject({ ok: false, reason: expect.stringContaining("not a path") })
	})

	it("removes what Windows refuses and cuts to 120 characters", () => {
		const long = `Q3: ${"x".repeat(196)}`
		const out = checkFileName(long)
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.name).not.toContain(":")
		expect(out.name.length).toBe(120)
		expect(out.name.startsWith("Q3 xx")).toBe(true)
		expect(checkFileName('a<b>c"d|e?f*g\u0001h')).toEqual({ ok: true, name: "abcdefgh" })
		expect(checkFileName("Report. . ")).toEqual({ ok: true, name: "Report" })
	})

	it("refuses an empty or reserved name", () => {
		expect(checkFileName("??")).toMatchObject({ ok: false })
		expect(checkFileName("..")).toMatchObject({ ok: false })
		expect(checkFileName("CON")).toMatchObject({ ok: false, reason: expect.stringContaining("reserves") })
		expect(checkFileName("lpt1.report")).toMatchObject({ ok: false })
		expect(checkFileName("Console")).toEqual({ ok: true, name: "Console" })
	})
})

describe("writeExportFile", () => {
	const bytes = new TextEncoder().encode("chart")

	it("makes the folder and never replaces a file", async () => {
		const folder = join(tempDir("write"), "nested", "Zafiro")
		const before = await snapshotFolder(folder)
		expect(before).toBeNull()
		const first = await writeExportFile({ folder, before, name: "Board", ext: ".png", bytes })
		const second = await writeExportFile({ folder, before, name: "Board", ext: ".png", bytes })
		const third = await writeExportFile({ folder, before, name: "Board", ext: ".png", bytes })
		expect([first, second, third].map((p) => p.slice(folder.length + 1))).toEqual([
			"Board.png",
			"Board (2).png",
			"Board (3).png",
		])
		expect(readFileSync(first, "utf8")).toBe("chart")
	})

	it("refuses a folder swapped for another while the chart rendered", async () => {
		const dir = tempDir("swap")
		const folder = join(dir, "Charts")
		mkdirSync(folder)
		const before = await snapshotFolder(folder)
		renameSync(folder, join(dir, "Old"))
		mkdirSync(folder)
		await expect(writeExportFile({ folder, before, name: "Board", ext: ".png", bytes })).rejects.toThrow("replaced")
		expect(readdirSync(folder)).toEqual([])
	})

	it("refuses a folder swapped for a link", async () => {
		const dir = tempDir("swaplink")
		const outside = tempDir("outside")
		const folder = join(dir, "Charts")
		mkdirSync(folder)
		const before = await snapshotFolder(folder)
		renameSync(folder, join(dir, "Old"))
		symlinkSync(outside, folder)
		await expect(writeExportFile({ folder, before, name: "Board", ext: ".png", bytes })).rejects.toThrow("is a link")
		expect(readdirSync(outside)).toEqual([])
	})
})
