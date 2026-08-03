import { expect, test } from "@playwright/test"
import { OUTLINE_HUE_SCATTER, seedFixtureScript } from "./seed"

/** Regression coverage for the field-driven outline-color encoding
 *  (`outlineHue` channel). Seeds a scatter whose mark OUTLINE color is
 *  driven by a 3-category field, then asserts the rendered marks carry
 *  more than one distinct stroke color — i.e. the outline scale actually
 *  varies the stroke (before this feature every mark shared the single
 *  universal outline color). Also screenshots the chart for visual diff. */

const SCREENSHOT_DIR = "e2e/screenshots"

test.describe("outline-color encoding", () => {
	test("varies mark stroke color by the mapped field", async ({
		page,
	}, info) => {
		await page.addInitScript(seedFixtureScript(OUTLINE_HUE_SCATTER))
		await page.goto(`/editor/${OUTLINE_HUE_SCATTER.visualId}`, {
			waitUntil: "networkidle",
		})
		await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
		await page.waitForTimeout(500)

		// Distinct, non-"none" stroke colors across the mark paths. A 3-category
		// outline field should yield more than one outline color.
		const strokes = await page.$$eval("svg#vc-scatter-svg path", (paths) =>
			paths
				.map((p) => p.getAttribute("stroke"))
				.filter((s): s is string => !!s && s !== "none")
		)
		const distinct = new Set(strokes.map((s) => s.toLowerCase()))
		expect(distinct.size).toBeGreaterThan(1)

		const canvas = page.locator(".min-h-0.min-w-0.flex-1.p-3").first()
		await expect(canvas).toBeVisible()
		await canvas.screenshot({
			path: `${SCREENSHOT_DIR}/${info.project.name}/outline-hue-scatter.png`,
		})
	})
})
