/* eslint-disable @th/use-wrapped-json-functions -- debug/measurement output, not app data */
import { expect, test, type Page } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

const hist = (
	id: string,
	histogram: Record<string, unknown>,
	extraX: Record<string, unknown> = {},
	withHue = true
): SeedFixture => ({
	visualId: id,
	datasetId: `ds-${id}`,
	datasetName: id,
	fields: [
		{ name: "val", inferredType: "quantitative" },
		{ name: "grp", inferredType: "categorical" },
	],
	rows: Array.from({ length: 60 }, (_, i) => ({
		val: String((i * 7) % 100),
		grp: ["A", "B", "C"][i % 3]!,
	})),
	encodings: withHue
		? { x: { field: "val" }, hue: { field: "grp" } }
		: { x: { field: "val" } },
	channelConfigs: { x: { histogram, ...extraX } },
})

const xAxisLabels = () =>
	[...document.querySelectorAll("svg text")]
		.map((t) => (t.textContent ?? "").trim())
		.filter((s) => s.length > 0)

const legendSwatchCount = () =>
	[...document.querySelectorAll("span")].filter(
		(s) =>
			s.style.width === "18px" &&
			s.style.height === "12px" &&
			!s.closest("aside")
	).length

/** Expand the sidebar's Legend section (it's `defaultCollapsed` and unmounts
 *  its children — including the "Legends shown" subsection — while closed).
 *  Idempotent: no-op if already expanded. */
const expandLegendSection = async (page: Page) => {
	const header = page.getByRole("button", { name: "Legend", exact: true })
	if ((await header.getAttribute("aria-expanded")) === "false") {
		await header.click()
	}
}

test("item 16 — toggling Color off removes the histogram legend", async ({
	page,
}) => {
	const fx = hist("h16", { enabled: true, binCount: 6, mode: "count", labelMode: "range" })
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	const before = await page.evaluate(legendSwatchCount)
	await page.screenshot({ path: "/tmp/h16-before.png", fullPage: true })

	// Expand the Legend section (defaultCollapsed — its children don't exist
	// in the DOM until opened), then the "Legends shown" subsection, then
	// uncheck the "Color" toggle.
	await expandLegendSection(page)
	await page.getByRole("button", { name: "Legends shown" }).click()
	await page.waitForTimeout(150)
	// Scope to the Legend section — the encoding shelf row is now also labeled
	// "Color" (renamed from "Hue"), so an unscoped match is ambiguous.
	await page
		.locator("#aside-section-Legend")
		.getByText("Color", { exact: true })
		.click()
	await page.waitForTimeout(250)
	const after = await page.evaluate(legendSwatchCount)
	await page.screenshot({ path: "/tmp/h16-after.png", fullPage: true })

	console.log(JSON.stringify({ before, after }))
	expect(before).toBeGreaterThan(0)
	expect(after).toBe(0)
})

test("item 16b — fill+outline histogram needs BOTH legend toggles to hide it", async ({
	page,
}) => {
	// Regression: `outlineHue` is a legend candidate (renders a section) but was
	// missing from LEGEND_CHANNELS, so the "Legends shown" sidebar offered only
	// a "Color" toggle. With fill (hue) and outline (outlineHue) on the same
	// field the legend section combines both; unchecking "Color" hid only the
	// fill half, leaving the outline-color legend stuck on screen.
	const fx: SeedFixture = {
		visualId: "h16b",
		datasetId: "ds-h16b",
		datasetName: "h16b",
		fields: [
			{ name: "val", inferredType: "quantitative" },
			{ name: "grp", inferredType: "categorical" },
		],
		rows: Array.from({ length: 60 }, (_, i) => ({
			val: String((i * 7) % 100),
			grp: ["A", "B", "C"][i % 3]!,
		})),
		encodings: {
			x: { field: "val" },
			hue: { field: "grp" },
			outlineHue: { field: "grp" },
		},
		channelConfigs: {
			x: { histogram: { enabled: true, binCount: 6, mode: "count", labelMode: "range" } },
		},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	// The legend's section title is a `.font-medium` div carrying the field
	// name ("grp"). Detect it outside the sidebar — robust to whether the
	// swatch is a plain hue square or the combined fill+outline composite.
	const legendPresent = () =>
		[...document.querySelectorAll("div.font-medium")].some(
			(d) => !d.closest("aside") && (d.textContent ?? "").trim() === "grp"
		)

	expect(await page.evaluate(legendPresent)).toBe(true)

	await expandLegendSection(page)
	await page.getByRole("button", { name: "Legends shown" }).click()
	await page.waitForTimeout(150)
	const colorToggle = page.getByRole("checkbox", { name: "Color", exact: true })
	const outlineToggle = page.getByRole("checkbox", {
		name: "Outline color",
		exact: true,
	})
	await expect(colorToggle).toBeVisible()
	await expect(outlineToggle).toBeVisible()

	// Color off alone: legend persists (outline half still shows).
	await colorToggle.click()
	await page.waitForTimeout(250)
	expect(await page.evaluate(legendPresent)).toBe(true)

	// Outline off too: legend fully gone.
	await outlineToggle.click()
	await page.waitForTimeout(250)
	expect(await page.evaluate(legendPresent)).toBe(false)
})

test("item 17 — histogram tick-label stride reduces labels", async ({ page }) => {
	const fx = hist(
		"h17",
		{ enabled: true, binCount: 10, mode: "count", labelMode: "range" },
		{ categoricalTickStride: 3 }
	)
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })
	await page.screenshot({ path: "/tmp/h17.png", fullPage: true })
	const labels = await page.evaluate(xAxisLabels)
	const ranges = labels.filter((s) => s.includes("–"))
	console.log(JSON.stringify({ allLabels: labels, ranges }))
	// With ~10 bins at stride 3, only a few bin labels should show (not all).
	expect(ranges.length).toBeGreaterThan(0)
	expect(ranges.length).toBeLessThan(8)
})

test("item 18 — histogram bin labelMode 'low' shows single values", async ({
	page,
}) => {
	const fx = hist("h18", {
		enabled: true,
		binCount: 6,
		mode: "count",
		labelMode: "low",
	})
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })
	const labels = await page.evaluate(xAxisLabels)
	const dashed = labels.filter((s) => s.includes("–"))
	const numeric = labels.filter((s) => /^\d+(\.\d+)?$/.test(s))
	console.log(JSON.stringify({ dashed: dashed.length, numericSample: numeric.slice(0, 8) }))
	expect(dashed.length).toBe(0)
	expect(numeric.length).toBeGreaterThan(1)
})
