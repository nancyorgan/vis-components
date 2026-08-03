import { expect, test } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

// Area chart with NO hue/color encoding: the Color menu's "Outline" subheader
// offers a single outline color (connection.strokeColor). Setting it must
// recolor the layer edges — including over leftover per-layer overrides
// (linePalette / lineColors) from a hue that was mapped then removed, which
// out-rank strokeColor in the renderer.

const rows = Array.from({ length: 30 }, (_, i) => ({
	x: String(i % 10),
	len: String(((i * 13) % 50) + 5),
	series: ["A", "B", "C"][i % 3]!,
}))

const baseFixture = (
	extraConnection: Record<string, unknown>,
): SeedFixture => ({
	visualId: "area-outline",
	datasetId: "ds-area-outline",
	datasetName: "area-outline",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "len", inferredType: "quantitative" },
		{ name: "series", inferredType: "categorical" },
	],
	rows,
	// areas-x: x + length + connection, no y.
	encodings: {
		x: { field: "x" },
		length: { field: "len" },
		connection: { field: "series" },
	},
	channelConfigs: {
		connection: { fill: "area", thickness: 4, ...extraConnection },
	},
})

const setOutlineColorViaUI = async (
	page: import("@playwright/test").Page,
	fx: SeedFixture,
	hex: string,
) => {
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })
	await page.waitForTimeout(300)
	await page.getByRole("button", { name: /Toggle options for Color/i }).click()
	await page.waitForTimeout(200)
	await page.getByText("Outline", { exact: true }).click()
	await page.waitForTimeout(200)
	// Fill = 1st ColorInput, Outline = 2nd.
	const hexInputs = page.locator('.vc-option-panel input[type="text"]')
	await hexInputs.nth(1).fill(hex)
	await hexInputs.nth(1).blur()
	await page.waitForTimeout(300)
}

const edgeStrokes = (page: import("@playwright/test").Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll("svg path")]
			.map((p) => (p.getAttribute("stroke") ?? "").toLowerCase())
			.filter((s) => s && s !== "none" && s !== "currentcolor"),
	)

test("outline swatch recolors the edge (no hue)", async ({ page }) => {
	await setOutlineColorViaUI(page, baseFixture({}), "#00ff00")
	expect(await edgeStrokes(page)).toContain("#00ff00")
})

test("outline swatch wins over leftover linePalette / lineColors", async ({
	page,
}) => {
	const fx = baseFixture({
		linePaletteId: "leftover",
		linePalette: ["#0000ff", "#0000ff", "#0000ff"],
		lineColors: { A: "#0000ff" },
	})
	await setOutlineColorViaUI(page, fx, "#00ff00")
	const after = await edgeStrokes(page)
	expect(after).toContain("#00ff00")
	expect(after).not.toContain("#0000ff")
})
