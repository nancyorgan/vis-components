import { expect, test } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

// Per-channel stack/group/overlay composition, end to end: a bar chart with
// hue and pattern mapped to DIFFERENT fields, hue set to `group` and pattern
// to `stack`, must render grouped-outer (two sub-bands on the category axis)
// with stacked-inner (pattern segments cumulative within each sub-band).
// One category, 2 hue (g1, g2) x 2 pattern (p1, p2); values 2/3 and 4/1 so
// both leaves total 5 — both stacks reach the same measure-axis top.
const makeFixture = (
	visualId: string,
	hueStackMode: "stack" | "group"
): SeedFixture => ({
	visualId,
	datasetId: `ds-${visualId}`,
	datasetName: visualId,
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "grp", inferredType: "categorical" },
		{ name: "pat", inferredType: "categorical" },
	],
	rows: [
		{ cat: "A", val: "2", grp: "g1", pat: "p1" },
		{ cat: "A", val: "3", grp: "g1", pat: "p2" },
		{ cat: "A", val: "4", grp: "g2", pat: "p1" },
		{ cat: "A", val: "1", grp: "g2", pat: "p2" },
	],
	encodings: {
		x: { field: "cat" },
		length: { field: "val" },
		hue: { field: "grp" },
		pattern: { field: "pat" },
	},
	channelConfigs: {
		hue: { kind: "categorical", colors: {}, stackMode: hueStackMode },
		pattern: {
			overrides: {},
			dashOverrides: {},
			customDashOverrides: {},
			inkColors: {},
			backgroundColor: "#e2e8f0",
			stackMode: "stack",
		},
	},
})

type BarRect = { x: number; y: number; w: number; h: number }

/** Collect the bar `<rect>`s from the main plot SVG. Bar slices are the only
 *  rects BarPlot emits with a `fill-opacity` attribute; the size floor skips
 *  legend swatches and other adornments that may share the attribute. */
const readBars = (page: import("@playwright/test").Page): Promise<BarRect[]> =>
	page.evaluate(() => {
		const svgs = [...document.querySelectorAll("svg")]
		const area = (s: Element) => {
			const r = s.getBoundingClientRect()
			return r.width * r.height
		}
		const main = svgs.reduce((a, b) => (area(b) > area(a) ? b : a))
		return [...main.querySelectorAll("rect")]
			.filter(
				(r) =>
					r.getAttribute("fill-opacity") !== null &&
					parseFloat(r.getAttribute("height") ?? "0") > 8 &&
					parseFloat(r.getAttribute("width") ?? "0") > 8
			)
			.map((r) => ({
				x: parseFloat(r.getAttribute("x") ?? "0"),
				y: parseFloat(r.getAttribute("y") ?? "0"),
				w: parseFloat(r.getAttribute("width") ?? "0"),
				h: parseFloat(r.getAttribute("height") ?? "0"),
			}))
	})

const distinctXs = (bars: BarRect[]): number[] =>
	[...new Set(bars.map((b) => Math.round(b.x)))].sort((a, b) => a - b)

test("hue=group + pattern=stack renders grouped-outer / stacked-inner bars", async ({
	page,
}) => {
	const fx = makeFixture("vis-stack-comp", "group")
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	await expect.poll(async () => (await readBars(page)).length).toBe(4)
	const bars = await readBars(page)

	// Category axis: two hue sub-bands, two slices each, equal widths.
	const xs = distinctXs(bars)
	expect(xs).toHaveLength(2)
	const clusters = xs.map((x) => bars.filter((b) => Math.round(b.x) === x))
	for (const cluster of clusters) {
		expect(cluster).toHaveLength(2)
		expect(Math.abs(cluster[0]!.w - cluster[1]!.w)).toBeLessThan(1.5)
	}

	// Measure axis: within each sub-band the segments stack — the upper
	// rect ends where the lower begins, both stacks share top and baseline
	// (leaf totals are both 5).
	const tops: number[] = []
	const baselines: number[] = []
	for (const cluster of clusters) {
		const [upper, lower] = [...cluster].sort((a, b) => a.y - b.y)
		expect(Math.abs(upper!.y + upper!.h - lower!.y)).toBeLessThan(1.5)
		tops.push(upper!.y)
		baselines.push(lower!.y + lower!.h)
	}
	expect(Math.abs(tops[0]! - tops[1]!)).toBeLessThan(1.5)
	expect(Math.abs(baselines[0]! - baselines[1]!)).toBeLessThan(1.5)

	// Segment heights carry the values: 2/5, 3/5 in one leaf; 1/5, 4/5 in
	// the other. Sorted ratios across all four ≈ [0.2, 0.4, 0.6, 0.8].
	const stackH = baselines[0]! - tops[0]!
	const ratios = bars.map((b) => b.h / stackH).sort((a, b) => a - b)
	const wanted = [0.2, 0.4, 0.6, 0.8]
	ratios.forEach((r, i) => expect(Math.abs(r - wanted[i]!)).toBeLessThan(0.03))
})

test("Layout toggle round-trip: flipping hue to Group regroups live", async ({
	page,
}) => {
	// Seed the default all-stack layout: one cumulative column per category.
	const fx = makeFixture("vis-stack-toggle", "stack")
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	await expect.poll(async () => (await readBars(page)).length).toBe(4)
	expect(distinctXs(await readBars(page))).toHaveLength(1)

	// With hue AND pattern mapped, the Color panel's toggle row is labeled
	// "Layout" (not "Stacking"). Flip hue to Group.
	await page.getByRole("button", { name: /Toggle options for Color/i }).click()
	const layoutRow = page.getByRole("group", { name: "Layout" })
	await expect(layoutRow).toBeVisible()
	await layoutRow.getByRole("button", { name: "Group", exact: true }).click()

	// The chart regroups live: two hue sub-bands, still two stacked
	// pattern segments in each.
	await expect
		.poll(async () => distinctXs(await readBars(page)).length)
		.toBe(2)
	const bars = await readBars(page)
	for (const x of distinctXs(bars)) {
		expect(bars.filter((b) => Math.round(b.x) === x)).toHaveLength(2)
	}

	// The Pattern panel hosts its own independent Layout row.
	await page
		.getByRole("button", { name: /Toggle options for Pattern/i })
		.click()
	expect(await page.getByRole("group", { name: "Layout" }).count()).toBeGreaterThanOrEqual(1)
})
