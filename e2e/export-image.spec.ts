import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { OUTLINE_HUE_SCATTER, seedFixtureScript } from "./seed"

/** End-to-end coverage for the Export-image tab: the capture must include
 *  the HTML legend (recreated as SVG), and raster exports must honor the
 *  resolution multiplier. Drives the real download path — editor → Export
 *  modal → preview iframe boot → capture → file. */

const openExportTab = async (page: import("@playwright/test").Page) => {
	await page.addInitScript(seedFixtureScript(OUTLINE_HUE_SCATTER))
	await page.goto(`/editor/${OUTLINE_HUE_SCATTER.visualId}`, {
		waitUntil: "networkidle",
	})
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })

	await page.getByRole("button", { name: "Export" }).click()
	await page.getByRole("button", { name: "Export image" }).click()

	// The preview iframe cold-boots the embed app; wait for its chart AND
	// legend so the capture has both to serialize.
	const frame = page.frameLocator('iframe[title="Export preview"]')
	await expect(frame.locator("svg#vc-scatter-svg").first()).toBeVisible({
		timeout: 15_000,
	})
	await expect(frame.locator("[data-legend-root]")).toBeVisible()
}

test.describe("Export image", () => {
	test("SVG export includes the legend entries", async ({ page }) => {
		await openExportTab(page)

		await page.getByLabel("Format").selectOption("svg")
		const downloadPromise = page.waitForEvent("download")
		await page.getByRole("button", { name: "Save SVG" }).click()
		const download = await downloadPromise
		expect(download.suggestedFilename()).toBe(
			`${OUTLINE_HUE_SCATTER.visualId}.svg`
		)

		// Keep the artifact alongside the visual-smoke screenshots so layout
		// regressions in the capture walk can be eyeballed.
		await download.saveAs("e2e/screenshots/chrome/export-legend.svg")

		const content = readFileSync((await download.path())!, "utf8")
		// Legend category labels, recreated as <text> by the capture walk.
		for (const category of ["alpha", "beta", "gamma"]) {
			expect(content).toContain(`>${category}</text>`)
		}
		// Chart marks came along too (nested chart svg with plotted paths).
		expect(content).toContain("<svg")
		expect(content).toContain("<path")
	})

	test("dragging the preview corner updates the size inputs", async ({
		page,
	}) => {
		await openExportTab(page)

		const widthInput = page.getByLabel("Width (px)")
		const heightInput = page.getByLabel("Height (px)")
		// The export size now defaults to the live editor chart size, not a
		// fixed 650×400. Pin it to a known 650×400 so the preview renders at
		// 100% in the 1280×720 viewport and pointer deltas map 1:1 onto export
		// pixels (the drag math below relies on that 1:1 mapping).
		await widthInput.fill("650")
		await heightInput.fill("400")
		await expect(widthInput).toHaveValue("650")
		await expect(heightInput).toHaveValue("400")

		// At 650×400 in a 1280×720 viewport the preview shows at 100%, so
		// pointer deltas map 1:1 onto export pixels.
		const corner = page.getByTestId("export-resize-corner")
		const box = (await corner.boundingBox())!
		const startX = box.x + box.width / 2
		const startY = box.y + box.height / 2
		await page.mouse.move(startX, startY)
		await page.mouse.down()
		await page.mouse.move(startX + 100, startY + 50, { steps: 5 })
		await page.mouse.up()

		await expect(widthInput).toHaveValue("750")
		await expect(heightInput).toHaveValue("450")

		// With the aspect locked, a width-only edge drag derives the height.
		await page.getByLabel("Lock aspect ratio").check()
		const edge = page.getByTestId("export-resize-right")
		const edgeBox = (await edge.boundingBox())!
		const edgeX = edgeBox.x + edgeBox.width / 2
		const edgeY = edgeBox.y + edgeBox.height / 2
		await page.mouse.move(edgeX, edgeY)
		await page.mouse.down()
		await page.mouse.move(edgeX - 250, edgeY, { steps: 5 })
		await page.mouse.up()

		await expect(widthInput).toHaveValue("500")
		await expect(heightInput).toHaveValue("300")
	})

	test("reopening restores the last-exported dimensions", async ({
		page,
	}) => {
		await openExportTab(page)

		const widthInput = page.getByLabel("Width (px)")
		const heightInput = page.getByLabel("Height (px)")
		await widthInput.fill("800")
		await heightInput.fill("500")

		// Only a successful export persists the size.
		await page.getByLabel("Format").selectOption("svg")
		const downloadPromise = page.waitForEvent("download")
		await page.getByRole("button", { name: "Save SVG" }).click()
		await downloadPromise

		// Full reload — the size must come back from storage, not React state.
		await page.reload({ waitUntil: "networkidle" })
		await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
		await page.getByRole("button", { name: "Export" }).click()
		await page.getByRole("button", { name: "Export image" }).click()

		await expect(page.getByLabel("Width (px)")).toHaveValue("800")
		await expect(page.getByLabel("Height (px)")).toHaveValue("500")
	})

	test("PNG export applies the resolution multiplier", async ({ page }) => {
		await openExportTab(page)

		// The default is now the live editor chart size, not a fixed 650×400,
		// so pin it → at the default 2× multiplier that's a 1300×800 bitmap.
		await page.getByLabel("Width (px)").fill("650")
		await page.getByLabel("Height (px)").fill("400")
		const downloadPromise = page.waitForEvent("download")
		await page.getByRole("button", { name: "Save PNG" }).click()
		const download = await downloadPromise
		const png = readFileSync((await download.path())!)

		// PNG IHDR: width at bytes 16–19, height at 20–23 (big-endian).
		expect(png.subarray(1, 4).toString("ascii")).toBe("PNG")
		expect(png.readUInt32BE(16)).toBe(1300)
		expect(png.readUInt32BE(20)).toBe(800)

		// DPI stamp (pHYs, inserted right after IHDR at byte 33): the 2×
		// multiplier exports at 192 dpi → 7559 px/meter — this is what makes
		// PowerPoint/Word insert the image at the chosen physical size.
		expect(png.subarray(37, 41).toString("ascii")).toBe("pHYs")
		expect(png.readUInt32BE(41)).toBe(7559)
		expect(png.readUInt32BE(45)).toBe(7559)
		expect(png[49]).toBe(1) // unit: meters
	})
})
