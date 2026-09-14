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
	// The modal opens on the "Export image" tab by default.

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
		// The export size defaults to the live editor chart size, not a fixed
		// value. Pin it to a known 640×320 — small enough that the preview
		// renders at 100% inside the fixed, viewport-sized preview box in the
		// 1280×800 test viewport — so pointer deltas map 1:1 onto export pixels
		// (the drag math below relies on that 1:1 mapping).
		await widthInput.fill("640")
		await heightInput.fill("320")
		await expect(widthInput).toHaveValue("640")
		await expect(heightInput).toHaveValue("320")

		const corner = page.getByTestId("export-resize-corner")
		const box = (await corner.boundingBox())!
		const startX = box.x + box.width / 2
		const startY = box.y + box.height / 2
		await page.mouse.move(startX, startY)
		await page.mouse.down()
		await page.mouse.move(startX + 100, startY + 50, { steps: 5 })
		await page.mouse.up()

		await expect(widthInput).toHaveValue("740")
		await expect(heightInput).toHaveValue("370")

		// With the aspect locked, a width-only edge drag derives the height.
		// Re-pin to 640×320 first so the preview is back at 100% (the corner
		// drag grew it past the fixed box, which scales the display down).
		await widthInput.fill("640")
		await heightInput.fill("320")
		await page.getByLabel("Lock aspect ratio").check()
		const edge = page.getByTestId("export-resize-right")
		const edgeBox = (await edge.boundingBox())!
		const edgeX = edgeBox.x + edgeBox.width / 2
		const edgeY = edgeBox.y + edgeBox.height / 2
		await page.mouse.move(edgeX, edgeY)
		await page.mouse.down()
		await page.mouse.move(edgeX - 140, edgeY, { steps: 5 })
		await page.mouse.up()

		await expect(widthInput).toHaveValue("500")
		await expect(heightInput).toHaveValue("250")
	})

	test("switching tabs keeps the popup and tab row in place", async ({
		page,
	}) => {
		await page.addInitScript(seedFixtureScript(OUTLINE_HUE_SCATTER))
		await page.goto(`/editor/${OUTLINE_HUE_SCATTER.visualId}`, {
			waitUntil: "networkidle",
		})
		await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
		await page.getByRole("button", { name: "Export" }).click()

		// Both tabs share the pinned top-left layout: toggling between them
		// must not move the popup's top-left corner or the tab buttons. The
		// modal opens on "Export image", so toggle to Embed and back.
		const dialog = page.locator('[role="dialog"]')
		const embedTab = page.getByRole("button", { name: "Embed" })
		const dialogBefore = (await dialog.boundingBox())!
		const tabBefore = (await embedTab.boundingBox())!

		await embedTab.click()
		const dialogExport = (await dialog.boundingBox())!
		const tabExport = (await embedTab.boundingBox())!
		expect(dialogExport.x).toBe(dialogBefore.x)
		expect(dialogExport.y).toBe(dialogBefore.y)
		expect(tabExport.x).toBe(tabBefore.x)
		expect(tabExport.y).toBe(tabBefore.y)

		await page.getByRole("button", { name: "Export image" }).click()
		const dialogBack = (await dialog.boundingBox())!
		const tabBack = (await embedTab.boundingBox())!
		expect(dialogBack.x).toBe(dialogBefore.x)
		expect(dialogBack.y).toBe(dialogBefore.y)
		expect(tabBack.x).toBe(tabBefore.x)
		expect(tabBack.y).toBe(tabBefore.y)
	})

	test("popup resizes with the preview but the controls stay pinned", async ({
		page,
	}) => {
		await openExportTab(page)

		// The popup is pinned top-left and grows down/right with the preview:
		// changing the dimensions must not move the controls above the preview
		// (the Cancel/Save row below it rides the bottom edge by design).
		await page.getByLabel("Width (px)").fill("500")
		await page.getByLabel("Height (px)").fill("300")
		const widthInput = page.getByLabel("Width (px)")
		const formatSelect = page.getByLabel("Format")
		const inputBefore = (await widthInput.boundingBox())!
		const formatBefore = (await formatSelect.boundingBox())!

		// Even at the maximum image size, the popup must keep a buffer to the
		// viewport edges (an overflow cuts off the title bar) and the corner
		// handle must stay on screen, draggable.
		await page.getByLabel("Height (px)").fill("4000")
		await page.getByLabel("Width (px)").fill("4000")

		const inputAfter = (await widthInput.boundingBox())!
		const formatAfter = (await formatSelect.boundingBox())!
		expect(inputAfter.x).toBe(inputBefore.x)
		expect(inputAfter.y).toBe(inputBefore.y)
		expect(formatAfter.x).toBe(formatBefore.x)
		expect(formatAfter.y).toBe(formatBefore.y)

		// The action buttons sit BELOW the preview.
		const save = (await page
			.getByRole("button", { name: "Save PNG" })
			.boundingBox())!
		const preview = (await page
			.locator('iframe[title="Export preview"]')
			.boundingBox())!
		expect(save.y).toBeGreaterThanOrEqual(preview.y + preview.height)

		const dialog = page.locator('[role="dialog"]')
		const box = (await dialog.boundingBox())!
		const viewport = page.viewportSize()!
		expect(box.y).toBeGreaterThanOrEqual(16)
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 16)
		expect(box.x).toBeGreaterThanOrEqual(16)
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 16)

		const corner = (await page
			.getByTestId("export-resize-corner")
			.boundingBox())!
		expect(corner.x + corner.width).toBeLessThanOrEqual(viewport.width)
		expect(corner.y + corner.height).toBeLessThanOrEqual(viewport.height)

		// The preview shows TRUE SIZE as long as it fits on screen — the popup
		// grows toward the screen's right edge rather than capping the preview
		// at some fixed panel width.
		await page.getByLabel("Width (px)").fill("1000")
		await page.getByLabel("Height (px)").fill("300")
		const iframe = (await page
			.locator('iframe[title="Export preview"]')
			.boundingBox())!
		expect(iframe.width).toBe(1000)
		expect(iframe.height).toBe(300)
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
		// so pin it → at the default 4× multiplier that's a 2600×1600 bitmap.
		await page.getByLabel("Width (px)").fill("650")
		await page.getByLabel("Height (px)").fill("400")
		const downloadPromise = page.waitForEvent("download")
		await page.getByRole("button", { name: "Save PNG" }).click()
		const download = await downloadPromise
		const png = readFileSync((await download.path())!)

		// PNG IHDR: width at bytes 16–19, height at 20–23 (big-endian).
		expect(png.subarray(1, 4).toString("ascii")).toBe("PNG")
		expect(png.readUInt32BE(16)).toBe(2600)
		expect(png.readUInt32BE(20)).toBe(1600)

		// DPI stamp (pHYs, inserted right after IHDR at byte 33): the 4×
		// multiplier exports at 384 dpi → 15118 px/meter — this is what makes
		// PowerPoint/Word insert the image at the chosen physical size.
		expect(png.subarray(37, 41).toString("ascii")).toBe("pHYs")
		expect(png.readUInt32BE(41)).toBe(15118)
		expect(png.readUInt32BE(45)).toBe(15118)
		expect(png[49]).toBe(1) // unit: meters
	})
})
