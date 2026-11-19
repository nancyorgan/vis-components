/** The safety net for publishing totals instead of rows
 *  (lib/embedAggregate.ts): a chart whose rows collapse must render, and
 *  hover, exactly as it does from its rows. A reader of the rows that the
 *  collapse doesn't know about shows up here as a different chart. Run over
 *  every bundled example that collapses, and over made-up bars, pies and
 *  areas for the families and cell kinds the examples lack. */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { Provider } from "jotai"
import { afterEach, describe, expect, it } from "vitest"

import { composeVisual, type ChartSpec } from "../contexts/chartBuilder/lib/chartSpec"
import { aggregateEmbedRecords } from "../contexts/chartBuilder/lib/embedAggregate"
import { pruneEmbedRecords } from "../contexts/chartBuilder/lib/embedColumns"
import { clearExampleOverlay } from "../contexts/chartBuilder/lib/exampleOverlay"
import { DEFAULT_TOOLTIP_CONFIG } from "../contexts/chartBuilder/lib/labelsConfig"
import { LIGHT_THEME_BASE } from "../contexts/chartBuilder/lib/systemThemes"
import type { Dataset, SavedTheme, Visual } from "../contexts/chartBuilder/lib/types"
import examples from "../seed/examples.json"
import { buildDataset } from "../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../testSupport/localStorageShim"
import { bootEmbedRuntime } from "./boot"
import { EmbedRoot } from "./EmbedRoot"
import { buildPublicEmbedPayload } from "./payload"

const library = examples as unknown as {
	visuals: Visual[]
	datasets: Record<string, Dataset>
	themes: SavedTheme[]
}

/** The example's records as a publish prunes them, with every row repeated
 *  three times (so a chart drawn one row per mark still has rows to merge),
 *  and the same after the collapse. */
const published = (visual: Visual) => {
	const stored = library.datasets[visual.datasetId ?? ""]
	if (!stored) throw new Error(`${visual.name}: no data set`)
	const version = stored.versions.find((v) => v.id === stored.latestVersionId) ?? stored.versions[0]
	if (!version) throw new Error(`${visual.name}: no version`)
	const dataset: Dataset = {
		...stored,
		latestVersionId: version.id,
		versions: [{ ...version, rows: version.rows.flatMap((row) => [row, { ...row }, { ...row }]) }],
	}
	const pruned = pruneEmbedRecords(visual, dataset)
	return { pruned, collapsed: aggregateEmbedRecords(pruned.visual, pruned.dataset) }
}

type Drawn = { html: string; hovers: string[] }

const ROW_COUNT_NOTE = /the underlying data has [\d,]+ rows?/g
const SCALE_ROWS = /data-(x|y)-scale-rows="\d+"/g

/** The chart's markup once it has settled, and what hovering each of its
 *  marks prints (every tooltip, in mark order). */
const draw = async (visual: Visual, dataset: Dataset): Promise<Drawn> => {
	installInMemoryLocalStorage()
	const theme = library.themes.find((t) => t.id === visual.themeId) ?? null
	const payload = buildPublicEmbedPayload({ visual, dataset, theme, fonts: [] })
	const { container } = render(
		<Provider store={bootEmbedRuntime(payload)}>
			<div style={{ width: 800, height: 600 }}>
				<EmbedRoot part="full" visualId={payload.visual.id} />
			</div>
		</Provider>
	)
	await waitFor(() => expect(container.querySelector("svg")).not.toBeNull(), { timeout: 5000 })
	// Let the layout passes that follow the first paint finish: the markup
	// must hold still for five checks.
	let html = ""
	let still = 0
	await waitFor(
		() => {
			const now = container.innerHTML
			still = now === html ? still + 1 : 0
			html = now
			expect(still).toBeGreaterThanOrEqual(5)
		},
		{ timeout: 15_000, interval: 100 }
	)
	const hovers: string[] = []
	for (const mark of Array.from(container.querySelectorAll("svg rect, svg path, svg circle"))) {
		fireEvent.mouseEnter(mark, { clientX: 100, clientY: 100 })
		fireEvent.mouseMove(mark, { clientX: 100, clientY: 100 })
		const tip = document.body.querySelector(".vc-tooltip")
		// The markup, not the text: the rows' structure is part of the hover.
		if (tip) hovers.push(tip.innerHTML)
		fireEvent.mouseLeave(mark)
	}
	cleanup()
	clearExampleOverlay()
	return {
		hovers,
		html: html
			// React numbers its generated ids per mount (":r8:", "…-r9").
			.replace(/:r[0-9a-z]+:/g, ":r:")
			.replace(/-r[0-9a-z]+(?=["#)])/g, "-r")
			// The one stated difference: the data table's note counts the
			// rows the page holds.
			.replace(ROW_COUNT_NOTE, "the underlying data has N rows")
			// Diagnostic attributes on each panel: how many rows fed its scales.
			.replace(SCALE_ROWS, "data-scale-rows"),
	}
}

afterEach(() => {
	cleanup()
	clearExampleOverlay()
})

const collapsing = library.visuals.filter((v) => published(v).collapsed.aggregation.aggregated)

describe("an embed published as totals", () => {
	it("applies to the bundled sum charts", () => {
		expect(collapsing.length).toBeGreaterThan(0)
	})

	for (const example of collapsing) {
		it(`draws "${example.name}" exactly as from its rows`, async () => {
			const { pruned, collapsed } = published(example)
			const { aggregation } = collapsed
			if (!aggregation.aggregated) throw new Error("expected a collapse")
			expect(aggregation.rowsAfter).toBeLessThan(aggregation.rowsBefore)
			expect(collapsed.dataset.versions[0]?.rows.length).toBe(aggregation.rowsAfter)
			const fromRows = await draw(pruned.visual, pruned.dataset)
			const fromTotals = await draw(pruned.visual, collapsed.dataset)
			expect(fromRows.html.length).toBeGreaterThan(500)
			expect(fromTotals.html).toBe(fromRows.html)
			expect(fromTotals.hovers).toEqual(fromRows.hovers)
		}, 30_000)
	}
})

describe("a labelled bar chart published as totals", () => {
	// The bundled labelled bars print a grouping and the bar total. These
	// print the MEASURE on each segment: alone, and beside the grouping.
	const labelled = library.visuals.find(
		(v) => v.encodings.length?.field === "Number" && v.dataLabelsEncodings?.value?.multiField
	)
	const variants: Array<[string, NonNullable<Visual["dataLabelsEncodings"]>["value"]]> = [
		["the measure", { field: "Number", multiField: false, fields: [] }],
		["a grouping and the measure", { field: null, multiField: true, fields: ["Rating", "Number"] }],
	]
	for (const [what, value] of variants) {
		it(`draws labels of ${what} exactly as from its rows`, async () => {
			if (!labelled?.dataLabelsEncodings) throw new Error("the labelled bar example is gone")
			const visual: Visual = {
				...labelled,
				dataLabelsEncodings: { ...labelled.dataLabelsEncodings, value },
			}
			const { pruned, collapsed } = published(visual)
			expect(collapsed.aggregation).toMatchObject({ aggregated: true, measure: "Number" })
			const fromRows = await draw(pruned.visual, pruned.dataset)
			const fromTotals = await draw(pruned.visual, collapsed.dataset)
			// The labels are on the page: the tripled rows' totals, as text.
			expect(fromRows.html).toMatch(/<text[^>]*data-label|data-labels/i)
			expect(fromTotals.html).toBe(fromRows.html)
			expect(fromTotals.hovers).toEqual(fromRows.hovers)
		}, 30_000)
	}
})

// ── Made-up charts: the families and cell kinds the bundled examples lack ──

/** Three sales per region and quarter, by different reps: every mark adds
 *  up three rows. Rep and Note are on no channel, so only the hover reads
 *  them. Sales is typed as dollars and Share as percents; one Sales cell is
 *  blank and one is text. */
const salesRows = (): Array<Record<string, string>> => {
	const rows: Array<Record<string, string>> = []
	let n = 0
	for (const region of ["West", "East", "North"]) {
		for (const quarter of ["Q1", "Q2", "Q3"]) {
			for (const rep of ["Ana", "Ben", "Cy"]) {
				n += 1
				rows.push({
					Region: region,
					Quarter: quarter,
					Rep: rep,
					Note: "note " + String(n),
					Sales: "$" + (1000 + n * 137.5).toLocaleString("en-US"),
					Share: (n * 1.25).toFixed(2) + "%",
				})
			}
		}
	}
	const blank = rows[4]
	const text = rows[11]
	if (blank) blank.Sales = ""
	if (text) text.Sales = "n/a"
	return rows
}

const sales = buildDataset({
	id: "ds-sales",
	name: "sales",
	fields: [
		{ name: "Region", inferredType: "categorical" },
		{ name: "Quarter", inferredType: "ordinal" },
		{ name: "Rep", inferredType: "categorical" },
		{ name: "Note", inferredType: "categorical" },
		{ name: "Sales", inferredType: "quantitative" },
		{ name: "Share", inferredType: "quantitative" },
	],
	rows: salesRows(),
})

type Spec = Omit<ChartSpec, "datasetId" | "folderId">

const compose = (spec: Spec): Visual => {
	const { visual, problems } = composeVisual(
		{ datasetId: sales.id, folderId: null, ...spec },
		{
			fields: sales.fields.map((f) => ({ name: f.name, type: f.inferredType })),
			theme: LIGHT_THEME_BASE,
		}
	)
	expect(problems).toEqual([])
	return visual
}

const MADE_UP: Array<[string, Spec]> = [
	["vertical bars", { family: "bar", encodings: { x: "Region", length: "Sales" } }],
	[
		"stacked bars, split by quarter",
		{ family: "bar", encodings: { x: "Region", length: "Sales", hue: "Quarter" } },
	],
	[
		"horizontal bars in facets",
		{ family: "bar", encodings: { y: "Quarter", length: "Sales", facet: "Region" } },
	],
	[
		"bars of a percent column",
		{ family: "bar", encodings: { x: "Region", length: "Share", hue: "Quarter" } },
	],
	["a pie", { family: "pie", encodings: { angle: "Sales", hue: "Region" } }],
	[
		"a pie per quarter",
		{ family: "pie", encodings: { angle: "Sales", hue: "Region", facet: "Quarter" } },
	],
	[
		"stacked areas",
		{ family: "area", encodings: { x: "Quarter", length: "Sales", connection: "Region" } },
	],
	[
		"stacked areas colored by layer",
		{
			family: "area",
			encodings: { x: "Quarter", length: "Sales", connection: "Region", hue: "Region" },
		},
	],
	[
		"overlaid areas of a percent column",
		{
			family: "area",
			variation: "Overlay area",
			encodings: { x: "Quarter", length: "Share", connection: "Region", hue: "Region" },
		},
	],
]

/** The hover's Fields shown without the measure: what lets an area chart
 *  publish totals (its layer hover prints one row's value of a ticked
 *  measure). */
const withoutInHover = (visual: Visual, measure: string): Visual => ({
	...visual,
	tooltipConfig: {
		...DEFAULT_TOOLTIP_CONFIG,
		...visual.tooltipConfig,
		visibleFields: sales.fields.map((f) => f.name).filter((name) => name !== measure),
	},
})

describe("a made-up sum chart published as totals", () => {
	for (const [what, spec] of MADE_UP) {
		it(`draws and hovers ${what} exactly as from its rows`, async () => {
			const composed = compose(spec)
			const measure = spec.encodings.length ?? spec.encodings.angle ?? ""
			const visual = spec.family === "area" ? withoutInHover(composed, measure) : composed
			const pruned = pruneEmbedRecords(visual, sales)
			const collapsed = aggregateEmbedRecords(pruned.visual, pruned.dataset)
			expect(collapsed.aggregation).toMatchObject({ aggregated: true, rowsBefore: 27, measure })
			const fromRows = await draw(pruned.visual, pruned.dataset)
			const fromTotals = await draw(pruned.visual, collapsed.dataset)
			expect(fromRows.html.length).toBeGreaterThan(500)
			expect(fromRows.hovers.length).toBeGreaterThan(0)
			expect(fromTotals.html).toBe(fromRows.html)
			expect(fromTotals.hovers).toEqual(fromRows.hovers)
		}, 30_000)
	}
})
