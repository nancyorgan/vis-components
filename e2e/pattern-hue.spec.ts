import { expect, test } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

// Scatter with hue + pattern on the SAME ordinal field. Ordinal palette inks
// are red/green/blue; if the renderer looks them up in the categorical palette
// (the bug) it misses and falls back to the default near-black ink.
const FX: SeedFixture = {
	visualId: "vis-pat",
	datasetId: "ds-pat",
	datasetName: "pat",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "grade", inferredType: "ordinal" },
	],
	rows: Array.from({ length: 18 }, (_, i) => ({
		x: String((i % 6) + 1),
		y: String(4 + ((i * 5) % 9)),
		grade: ["low", "mid", "high"][i % 3]!,
	})),
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
		hue: { field: "grade" },
		pattern: { field: "grade" },
	},
	channelConfigs: {
		ordinalPalette: ["#e0f2fe", "#7dd3fc", "#0284c7"],
		ordinalPalettePatternInks: ["#ff0000", "#00ff00", "#0000ff"],
		categoricalPalette: ["#aaaaaa", "#bbbbbb", "#cccccc"],
		categoricalPalettePatternInks: ["#111111", "#222222", "#333333"],
		pattern: {
			overrides: {},
			dashOverrides: {},
			customDashOverrides: {},
			inkColors: {},
			backgroundColor: "#e2e8f0",
			stackMode: "stack",
		},
	},
}

test("item 19 — pattern ink uses the ordinal palette when pattern shares hue", async ({
	page,
}) => {
	await page.addInitScript(seedFixtureScript(FX))
	await page.goto(`/editor/${FX.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	// Collect the ink-color slug (last segment) of each generated pattern def.
	const inkSlugs = await page.evaluate(() =>
		[...document.querySelectorAll('pattern[id^="vc-pat-"]')].map((p) => {
			const parts = (p.id || "").split("-")
			return parts[parts.length - 1]
		})
	)
	// eslint-disable-next-line @th/use-wrapped-json-functions
	console.log(JSON.stringify({ inkSlugs }))

	// Expect the configured ordinal inks (ff0000 / 00ff00 / 0000ff), NOT the
	// default near-black ink (0f172a).
	expect(inkSlugs.length).toBeGreaterThan(0)
	expect(inkSlugs).not.toContain("0f172a")
	expect(inkSlugs.some((s) => ["ff0000", "00ff00", "0000ff"].includes(s))).toBe(
		true
	)
})

// Stacked bar with hue + pattern on the SAME categorical field, plus a
// theme-driven default saturation. The saturation modulates each bar's fill
// hex OFF the palette swatch — the ink lookup must key on the pre-modulation
// hue color, or every bar's pattern falls back to the near-black default ink
// (while the Pattern panel and legend still show the paired inks).
const BAR_FX: SeedFixture = {
	visualId: "vis-bar-pat",
	datasetId: "ds-bar-pat",
	datasetName: "barpat",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "grp", inferredType: "categorical" },
	],
	rows: Array.from({ length: 18 }, (_, i) => ({
		cat: ["a", "b", "c"][i % 3]!,
		val: String(3 + (i % 5)),
		grp: ["g1", "g2", "g3"][Math.floor(i / 6)]!,
	})),
	encodings: {
		x: { field: "cat" },
		length: { field: "val" },
		hue: { field: "grp" },
		pattern: { field: "grp" },
	},
	channelConfigs: {
		categoricalPalette: ["#e0f2fe", "#7dd3fc", "#0284c7"],
		categoricalPalettePatternInks: ["#ff0000", "#00ff00", "#0000ff"],
		defaultSaturation: 0.7,
		pattern: {
			overrides: {},
			dashOverrides: {},
			customDashOverrides: {},
			inkColors: {},
			backgroundColor: "#e2e8f0",
			stackMode: "stack",
		},
	},
}

test("stacked bar pattern ink keeps per-swatch theme inks under sat/bri modulation", async ({
	page,
}) => {
	await page.addInitScript(seedFixtureScript(BAR_FX))
	await page.goto(`/editor/${BAR_FX.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	const info = await page.evaluate(() => {
		const defIds = [
			...document.querySelectorAll('pattern[id^="vc-pat-"]'),
		].map((p) => p.id)
		// Bar rects reference plot-level defs directly (legend swatches use
		// their own `legend-combined-` prefixed copies).
		const barPatternIds = [...document.querySelectorAll("svg rect")]
			.map((r) => r.getAttribute("fill") || "")
			.filter((f) => f.startsWith("url(#vc-pat-"))
			.map((f) => f.slice("url(#".length, -1))
		return { defIds, barPatternIds }
	})

	expect(info.barPatternIds.length).toBeGreaterThan(0)
	const inkSlugs = info.barPatternIds.map((id) => id.split("-").pop())
	// Paired inks, not the near-black default.
	expect(inkSlugs).not.toContain("0f172a")
	expect(new Set(inkSlugs)).toEqual(new Set(["ff0000", "00ff00", "0000ff"]))
	// Every referenced def must actually be emitted.
	for (const id of info.barPatternIds) {
		expect(info.defIds).toContain(id)
	}
})
