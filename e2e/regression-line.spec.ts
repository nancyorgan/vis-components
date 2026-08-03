import { expect, test } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

/** Regression-line overlay on a two-quantitative scatter. One UI-driven spec:
 *  toggle "Add regression line" in the X position options and assert the
 *  fitted path appears; plus a seeded check that a saved visual with the
 *  CI band on renders line + band without any interaction. */

// Default theme regressionStroke / regressionCiFill (systemThemes.ts).
const LINE_STROKE = "#475569"
const BAND_FILL = "#cbd5e1"

const rows = Array.from({ length: 30 }, (_, i) => ({
	x: String(i + 1),
	y: String(3 + 2 * i + (i % 5)),
}))

const baseFixture = (id: string): SeedFixture => ({
	visualId: `vis-${id}`,
	datasetId: `ds-${id}`,
	datasetName: "regression-scatter",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
	],
	rows,
	encodings: { x: { field: "x" }, y: { field: "y" } },
	labels: { title: "Regression scatter", xAxisTitle: "x", yAxisTitle: "y" },
})

/** Count svg paths that look like the fitted line (theme stroke, no fill). */
const countLinePaths = (page: import("@playwright/test").Page) =>
	page.evaluate(
		(stroke) =>
			[...document.querySelectorAll("svg#vc-scatter-svg path")].filter(
				(p) =>
					(p.getAttribute("stroke") ?? "").toLowerCase() === stroke &&
					p.getAttribute("fill") === "none"
			).length,
		LINE_STROKE
	)

test("toggling Add regression line draws the fitted path", async ({ page }) => {
	const fx = baseFixture("reg-toggle")
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(300)

	expect(await countLinePaths(page)).toBe(0)

	await page
		.getByRole("button", { name: "Toggle options for X position" })
		.click()
	// Subsections are collapsed by default — expand Regression first.
	await page.getByRole("button", { name: "Regression", exact: true }).click()
	await page.getByText("Add regression line").click()

	await expect.poll(() => countLinePaths(page), { timeout: 5_000 }).toBe(1)
})

test("seeded visual with CI on renders the line and the band", async ({
	page,
}) => {
	const fx: SeedFixture = {
		...baseFixture("reg-seeded"),
		channelConfigs: {
			x: {
				regression: {
					enabled: true,
					kind: "linear",
					degree: 2,
					drawPosition: "front",
					perGroup: false,
					groupField: null,
					showCi: true,
					ciLevel: 95,
					color: LINE_STROKE,
					ciFillColor: BAND_FILL,
					strokeWidth: 2,
					lineStyle: "solid",
				},
			},
		},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(300)

	expect(await countLinePaths(page)).toBe(1)
	const bandCount = await page.evaluate(
		(fill) =>
			[...document.querySelectorAll("svg#vc-scatter-svg path")].filter(
				(p) =>
					(p.getAttribute("fill") ?? "").toLowerCase() === fill &&
					p.getAttribute("stroke") === "none"
			).length,
		BAND_FILL
	)
	expect(bandCount).toBe(1)
})
