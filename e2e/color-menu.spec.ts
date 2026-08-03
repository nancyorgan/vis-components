import { expect, test } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

const rows = Array.from({ length: 60 }, (_, i) => ({
	val: String((i * 7) % 100),
	grp: ["A", "B", "C"][i % 3]!,
}))

// Back-compat: a histogram saved with the legacy `histogram.rugColor` (no
// color slot) must still render its rug in that color.
test("legacy rug color renders without a color slot", async ({ page }) => {
	const fx: SeedFixture = {
		visualId: "cm-rug",
		datasetId: "ds-cm-rug",
		datasetName: "cm-rug",
		fields: [
			{ name: "val", inferredType: "quantitative" },
			{ name: "grp", inferredType: "categorical" },
		],
		rows,
		encodings: { x: { field: "val" } },
		channelConfigs: {
			x: {
				histogram: {
					enabled: true,
					binCount: 6,
					mode: "count",
					labelMode: "range",
					showRug: true,
					rugColor: "#ff0000",
					rugPaletteId: null,
					rugPalette: [],
				},
			},
		},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })
	await page.waitForTimeout(300)
	const rugCount = await page.evaluate(() =>
		[...document.querySelectorAll("svg line")].filter(
			(l) => (l.getAttribute("stroke") ?? "").toLowerCase() === "#ff0000"
		).length
	)
	expect(rugCount).toBe(60)
})

// The unified Color menu shows the per-target subheaders for the chart type.
test("Color menu shows Fill + Outline + violin/box subheaders", async ({ page }) => {
	const fx: SeedFixture = {
		visualId: "cm-violin",
		datasetId: "ds-cm-violin",
		datasetName: "cm-violin",
		fields: [
			{ name: "val", inferredType: "quantitative" },
			{ name: "grp", inferredType: "categorical" },
		],
		rows,
		encodings: { x: { field: "grp" }, y: { field: "val" } },
		channelConfigs: {
			y: {
				distributionOverlay: { showDensityViolin: true, showPoints: true } as never,
			},
		},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })
	await page.getByRole("button", { name: /Toggle options for Color/i }).click()
	await page.waitForTimeout(300)
	await page.screenshot({ path: "/tmp/color-menu.png", fullPage: true })
	for (const label of ["Fill", "Outline", "Violin / Box Fill", "Violin / Box Outline"]) {
		await expect(page.getByText(label, { exact: true })).toBeVisible()
	}
})
