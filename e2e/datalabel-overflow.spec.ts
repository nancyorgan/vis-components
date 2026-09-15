import { expect, test, type Page } from "@playwright/test"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** End-of-line data labels must stay inside the SVG. The reserve that
 *  makes room for them (dataLabelReserve.ts → solver extraRightMargin)
 *  used to be capped at 400px, so a long series name on the last point of
 *  a line clipped off the right edge. Now the plot compresses as far as
 *  needed (like a wide legend, down to a zero-width plot); in fit mode the
 *  solver only clamps the reserve to the container so the canvas never
 *  grows/scrolls. Mirrors those two regimes. */

const SCRATCH = process.env.VC_E2E_SCREENSHOT_DIR

const lineFixture = (id: string, longName: string): SeedFixture => {
	const series = ["Alpha", longName, "Gamma"]
	const rows: Array<Record<string, string>> = []
	series.forEach((s, si) => {
		for (let y = 2015; y <= 2024; y++) {
			rows.push({
				series: s,
				year: String(y),
				value: String(10 + si * 5 + (y - 2015) * 1.5),
			})
		}
	})
	return {
		visualId: id,
		datasetId: `ds-${id}`,
		datasetName: id,
		fields: [
			{ name: "series", inferredType: "categorical" },
			{ name: "year", inferredType: "quantitative" },
			{ name: "value", inferredType: "quantitative" },
		],
		rows,
		// No hue → no legend, so the chart gets the full width and the
		// 400px regime is actually reachable at the 1280px viewport.
		encodings: {
			x: { field: "year" },
			y: { field: "value" },
			connection: { field: "series" },
		},
	}
}

/** Data labels aren't part of SeedFixture; patch them onto the seeded
 *  visual (the loader hydrates `dataLabelsConfig` / `dataLabelsEncodings`
 *  straight off the Visual). Left-aligned "last per series" labels with a
 *  small offset — the direct-labeling setup that clips. */
/** Serializes for interpolation into the browser init script, where the
 *  @th/lib json helpers aren't available (same carve-out as seed.ts). */
// eslint-disable-next-line @th/use-wrapped-json-functions
const toJson = (v: unknown): string => JSON.stringify(v)

const patchDataLabels = (
	enc: Record<string, unknown> = {},
	cfg: Record<string, unknown> = {},
) => `
(() => {
	const visuals = JSON.parse(localStorage.getItem("vis-components:visuals"));
	for (const v of visuals) {
		v.dataLabelsEncodings = Object.assign({
			x: { field: "year" }, y: { field: "value" },
			angle: { field: null }, r: { field: null },
			hue: { field: null }, size: { field: null },
			value: { field: "series" },
		}, ${toJson(enc)});
		v.dataLabelsConfig = Object.assign(
			{ labelPoints: "last", alignment: "left", xOffset: 6, fontSize: 12 },
			${toJson(cfg)});
	}
	localStorage.setItem("vis-components:visuals", JSON.stringify(visuals));
})();
`

const openChart = async (
	page: Page,
	fx: SeedFixture,
	patch: string = patchDataLabels(),
) => {
	await page.addInitScript(seedFixtureScript(fx))
	await page.addInitScript(patch)
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(800)
}

const measureLabel = async (page: Page, needle: string) =>
	page.evaluate((needle) => {
		const svg = document.querySelector<SVGSVGElement>("svg#vc-scatter-svg")
		if (!svg) return null
		const sb = svg.getBoundingClientRect()
		const t = [...svg.querySelectorAll<SVGTextElement>("text")].find((el) =>
			(el.textContent ?? "").includes(needle),
		)
		if (!t) return null
		const b = t.getBoundingClientRect()
		const wrap = svg.parentElement?.getBoundingClientRect() ?? sb
		return {
			wrapRight: wrap.right,
			svgLeft: sb.left,
			svgRight: sb.right,
			svgWidth: sb.width,
			labelLeft: b.left,
			labelRight: b.right,
			labelWidth: b.width,
		}
	}, needle)

test.describe("Data labels — end-of-line overflow reserve", () => {
	test("a label wider than the old 400px cap compresses the plot and stays inside the SVG", async ({
		page,
	}) => {
		const name =
			"Northeast Regional Ambulatory Care Network of Greater Boston"
		await openChart(page, lineFixture("dlo-long", name))
		const m = await measureLabel(page, "Northeast")
		if (SCRATCH) await page.screenshot({ path: `${SCRATCH}/dlo-long.png` })
		expect(m).not.toBeNull()
		if (!m) return
		// The case only exercises the fix when the label needs more than the
		// old cap allowed past BASE_MARGIN.right (24).
		expect(m.labelWidth + 6).toBeGreaterThan(400 + 24)
		expect(m.labelRight).toBeLessThanOrEqual(m.svgRight + 0.5)
	})

	test("a label wider than the viewport collapses the plot and never grows the canvas", async ({
		page,
	}) => {
		const name =
			"Northeast Regional Ambulatory Care Network of the Greater Metropolitan Area and Surrounding Counties, Townships and Boroughs Incorporated"
		await openChart(page, lineFixture("dlo-pathological", name))
		const m = await measureLabel(page, "Northeast")
		if (SCRATCH) await page.screenshot({ path: `${SCRATCH}/dlo-pathological.png` })
		expect(m).not.toBeNull()
		if (!m) return
		// Genuinely wider than the SVG can hold past the left chrome.
		expect(m.labelWidth + 6 + 76).toBeGreaterThan(m.svgWidth)
		// No floor: the plot gives way entirely (label anchor = last data point
		// sits at the left chrome edge, BASE_MARGIN.left = 76, ±rounding) …
		const anchorX = m.labelLeft - 6
		expect(Math.abs(anchorX - (m.svgLeft + 76))).toBeLessThanOrEqual(2)
		// … and fit mode never scrolls: the SVG still matches its container.
		expect(m.svgRight).toBeLessThanOrEqual(m.wrapRight + 0.5)
	})

	test("first-last, two-field template: the WIDEST last label fits, not just the longest by characters", async ({
		page,
	}) => {
		// Real-world repro (2026-09-15): coverage shares by year, first label
		// "{pct}%", last label "{pct}% {category}". "9.0% Medicare Traditional"
		// has more characters than "46.8% Employer-Sponsored" but measures
		// narrower; the reserve used to size for the former and clipped the
		// latter's final "d".
		const cats: Array<[string, number, number]> = [
			["Employer-Sponsored", 51.1, 46.8],
			["Medicaid", 21.7, 21.5],
			["Medicare Advantage", 5.0, 11.5],
			["Direct Purchase", 8.8, 9.2],
			["Medicare Traditional", 11.5, 9.0],
			["CHIP", 1.9, 2.1],
		]
		const rows: Array<Record<string, string>> = []
		for (const [cat, first, last] of cats) {
			for (let y = 2016; y <= 2034; y++) {
				const t = (y - 2016) / 18
				rows.push({
					series: cat,
					year: String(y),
					value: (first + (last - first) * t).toFixed(1),
				})
			}
		}
		const fx: SeedFixture = {
			...lineFixture("dlo-first-last-multi", "unused"),
			rows,
		}
		await openChart(
			page,
			fx,
			patchDataLabels(
				{ value: { field: null, multiField: true, fields: ["value", "series"] } },
				{
					labelPoints: "first-last",
					alignment: "left",
					xOffset: 8,
					firstLabel: { labelTemplate: "{value}%", alignment: "right", xOffset: -8 },
					lastLabel: { labelTemplate: "{value}% {series}" },
				},
			),
		)
		const employer = await measureLabel(page, "Employer-Sponsored")
		const traditional = await measureLabel(page, "Medicare Traditional")
		if (SCRATCH) await page.screenshot({ path: `${SCRATCH}/dlo-first-last-multi.png` })
		expect(employer).not.toBeNull()
		expect(traditional).not.toBeNull()
		if (!employer || !traditional) return
		// The trap must be live in this font for the case to mean anything:
		// fewer characters, wider glyphs.
		expect("46.8% Employer-Sponsored".length).toBeLessThan(
			"9.0% Medicare Traditional".length,
		)
		expect(employer.labelWidth).toBeGreaterThan(traditional.labelWidth)
		// And it fits.
		expect(employer.labelRight).toBeLessThanOrEqual(employer.svgRight + 0.5)
	})
})
