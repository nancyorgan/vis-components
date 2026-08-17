import { expect, test } from "@playwright/test"
import {
	FACETED_1x3,
	FACETED_3x1_RIDGELINE,
	FACETED_6x1_BARS_Y,
	SINGLE_PANEL,
	seedFixtureScript,
	type SeedFixture,
} from "./seed"

/** Visual smoke tests for faceted + single-panel layouts.
 *
 *  Each test seeds the editor via localStorage, navigates to the editor
 *  page, waits for the chart to render, then screenshots the chart canvas.
 *  Screenshots land in `e2e/screenshots/chrome/`.
 *
 *  Run via:
 *    pnpm exec playwright test
 */

const SCREENSHOT_DIR = "e2e/screenshots"

const seedAndOpen = async (
	page: import("@playwright/test").Page,
	fixture: SeedFixture
) => {
	await page.addInitScript(seedFixtureScript(fixture))
	// Navigate to the EXISTING-visual editor route — /editor/new triggers
	// reset() which would clobber our seeded localStorage. /editor/<id>
	// goes through useLoadVisual which reads the visual we seeded.
	await page.goto(`/editor/${fixture.visualId}`, {
		waitUntil: "networkidle",
	})
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	// Give one more rAF tick for any post-mount layout adjustment.
	await page.waitForTimeout(500)
}

const screenshotChart = async (
	page: import("@playwright/test").Page,
	name: string,
	project: string
) => {
	// Screenshot the chart-canvas region. The editor wraps the chart in a
	// flex column with `.min-h-0.min-w-0.flex-1.p-3` — that's the chart
	// area minus sidebar / header / data drawer.
	const canvas = page.locator(".min-h-0.min-w-0.flex-1.p-3").first()
	await expect(canvas).toBeVisible()
	const path = `${SCREENSHOT_DIR}/${project}/${name}.png`
	await canvas.screenshot({ path })
}

test.describe("Faceted layout visual smoke", () => {
	test("1×3 faceted (shared axes)", async ({ page }, info) => {
		await seedAndOpen(page, FACETED_1x3)
		await screenshotChart(page, "01-faceted-1x3-shared", info.project.name)
	})

	test("3×1 ridgeline (negative gapY)", async ({ page }, info) => {
		await seedAndOpen(page, FACETED_3x1_RIDGELINE)
		await screenshotChart(page, "02-ridgeline-3x1", info.project.name)
	})

	test("single panel scatter", async ({ page }, info) => {
		await seedAndOpen(page, SINGLE_PANEL)
		await screenshotChart(page, "03-single-panel", info.project.name)
	})

	test("6×1 bars-y with long categorical labels", async ({
		page,
	}, info) => {
		await seedAndOpen(page, FACETED_6x1_BARS_Y)
		// The chart canvas is taller than the viewport — fullPage screenshot
		// captures the entire scroll height.
		const path = `e2e/screenshots/${info.project.name}/04-bars-y-6x1-long-labels.png`
		await page.screenshot({ path, fullPage: true })
	})
})
