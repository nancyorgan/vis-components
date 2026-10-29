import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { OUTLINE_HUE_SCATTER, seedFixtureScript } from "./seed"
import type { SeedFixture } from "./seed"

/** End-to-end coverage for /export/<id>: the page runs the Export dialog's
 *  pipeline with no one at the dialog and writes the file into
 *  #export-result. Asserts type, pixel size and stamped DPI rather than
 *  bytes, which drift by a pixel of layout between hosts. */

type Exported = { mime: string; bytes: Buffer }

const exportFile = async (
	page: Page,
	fixture: SeedFixture,
	query: string
): Promise<Exported> => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/export/${fixture.visualId}?${query}`)
	const result = page.locator("#export-result")
	await expect(result).toBeAttached({ timeout: 20_000 })
	const mime = (await result.getAttribute("data-mime")) ?? ""
	const bytes = Buffer.from((await result.textContent()) ?? "", "base64")
	expect(Number(await result.getAttribute("data-bytes"))).toBe(bytes.length)
	return { mime, bytes }
}

// PNG IHDR: width at bytes 16–19, height at 20–23; pHYs right after it.
const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)]
const pngDpi = (png: Buffer) => {
	expect(png.subarray(37, 41).toString("ascii")).toBe("pHYs")
	expect(png[49]).toBe(1) // unit: meters
	return Math.round(png.readUInt32BE(41) * 0.0254)
}

const FIXED_CANVAS: SeedFixture = {
	...OUTLINE_HUE_SCATTER,
	channelConfigs: {
		canvasSize: { enabled: true, width: 543, height: 552, unit: "in" },
	},
}

test.describe("Export page", () => {
	test("PNG matches the dialog's size and DPI for the same settings", async ({
		page,
	}) => {
		// The dialog spec's PNG case: 650×400 at 4× is 2600×1600, 384 dpi.
		const { mime, bytes } = await exportFile(
			page,
			OUTLINE_HUE_SCATTER,
			"format=png&width=650&height=400&ratio=4"
		)
		expect(mime).toBe("image/png")
		expect(pngSize(bytes)).toEqual([2600, 1600])
		expect(pngDpi(bytes)).toBe(384)
	})

	test("without a fixed canvas, exports at the dialog's default size", async ({
		page,
	}) => {
		const { mime, bytes } = await exportFile(
			page,
			OUTLINE_HUE_SCATTER,
			"format=png"
		)
		expect(mime).toBe("image/png")
		expect(pngSize(bytes)).toEqual([2600, 1600])
		expect(pngDpi(bytes)).toBe(384)
	})

	test("a fixed canvas size sets the export size at 4×", async ({ page }) => {
		const { bytes } = await exportFile(page, FIXED_CANVAS, "format=png")
		expect(pngSize(bytes)).toEqual([2172, 2208])
		expect(pngDpi(bytes)).toBe(384)
	})

	test("JPEG carries its DPI in the JFIF header", async ({ page }) => {
		const { mime, bytes } = await exportFile(
			page,
			OUTLINE_HUE_SCATTER,
			"format=jpeg"
		)
		expect(mime).toBe("image/jpeg")
		// SOI, then the JFIF APP0: density units at 13, x / y density at 14 / 16.
		expect(bytes.subarray(6, 10).toString("ascii")).toBe("JFIF")
		expect(bytes[13]).toBe(1) // dots per inch
		expect(bytes.readUInt16BE(14)).toBe(384)
		expect(bytes.readUInt16BE(16)).toBe(384)
	})

	test("SVG includes the legend entries", async ({
		page,
	}) => {
		const { mime, bytes } = await exportFile(
			page,
			OUTLINE_HUE_SCATTER,
			"format=svg"
		)
		expect(mime).toBe("image/svg+xml")
		const content = bytes.toString("utf8")
		for (const category of ["alpha", "beta", "gamma"]) {
			expect(content).toContain(`>${category}</text>`)
		}
		expect(content).toContain("<path")
	})

	test("PDF page is the export size in points", async ({ page }) => {
		const { mime, bytes } = await exportFile(
			page,
			OUTLINE_HUE_SCATTER,
			"format=pdf"
		)
		expect(mime).toBe("application/pdf")
		const text = bytes.toString("latin1")
		expect(text.startsWith("%PDF-")).toBe(true)
		// 650 × 400 px at 96 px/in = 487.5 × 300 pt.
		expect(text).toMatch(/\/MediaBox \[0 0 487\.5 300\]/)
	})

	test("an unknown visual or format reports an error", async ({ page }) => {
		await page.addInitScript(seedFixtureScript(OUTLINE_HUE_SCATTER))
		await page.goto("/export/no-such-visual?format=png")
		await expect(page.locator("#export-error")).toHaveText(
			"Visualization not found."
		)
		await page.goto(`/export/${OUTLINE_HUE_SCATTER.visualId}?format=gif`)
		await expect(page.locator("#export-error")).toHaveText("Unknown format.")
	})
})
