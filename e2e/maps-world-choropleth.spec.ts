import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { PLOT_SVG_ID } from "../src/contexts/chartBuilder/lib/captureThumbnail"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** End-to-end happy path for the WORLD-COUNTRY choropleth. Mirrors
 *  `maps-choropleth.spec.ts` (the states happy path): rather than driving a
 *  file-input upload, we seed a dataset + saved visual into localStorage via
 *  `seedFixtureScript`, then drive the real UI — mapping Connection + Color
 *  through the encoding shelves, flipping the Maps section to Geographic, and
 *  setting Geography level to "World Countries".
 *
 *  This exercises the full countries pipeline through the renderer: the
 *  world-atlas geometry loads (177 country features), `projection: auto`
 *  resolves to naturalEarth (albersUsa would null out every non-US country),
 *  and the ISO-3 join matches each fixture row. The fixture rows come straight
 *  from `e2e/fixtures/countries-value.csv` so the CSV is the single source of
 *  truth.
 *
 *  We pin the "Fill regions with no data" toggle ON (the default — check() is
 *  a no-op today) and assert the FULL world
 *  basemap draws (≥170 of 177 features). That is the most robust + meaningful
 *  assertion: it proves the entire countries geometry projects and renders, not
 *  just that a handful of matched features happened to draw. The Maps
 *  match-status separately confirms every fixture row joined. */

const FIXTURE_URL = new URL("./fixtures/countries-value.csv", import.meta.url)

/** Parse the tiny `country,value` fixture into the row/field shape the seed
 *  helper wants. Trivial CSV (no quoting/escaping) — a split is enough. */
const loadFixtureRows = () => {
	const text = readFileSync(fileURLToPath(FIXTURE_URL), "utf8").trim()
	const lines = text.split("\n")
	const header = lines[0]!.split(",")
	const rows = lines.slice(1).map((line) => {
		const cells = line.split(",")
		const row: Record<string, string> = {}
		header.forEach((col, i) => {
			row[col] = cells[i] ?? ""
		})
		return row
	})
	return { rows, rowCount: rows.length }
}

test("world choropleth happy path: map connection + color, go Geographic, World Countries", async ({
	page,
}) => {
	const { rows, rowCount } = loadFixtureRows()

	// Seed a dataset + saved visual with NO encodings (cartesian default).
	// We map the channels and toggle Geographic + World Countries below.
	const fx: SeedFixture = {
		visualId: "vis-world-choropleth",
		datasetId: "ds-world-choropleth",
		datasetName: "countries-value",
		fields: [
			{ name: "country", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
		],
		rows,
		encodings: {},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	// Map the region field to Connection and the measure to Color (hue), by the
	// visible option text — mirrors a user picking the column.
	await page.getByLabel("Connection", { exact: true }).selectOption("country")
	await page.getByLabel("Color", { exact: true }).selectOption("value")

	// The Maps section is `defaultCollapsed` — expand it, flip the
	// Coordinate-system radio to Geographic (the master switch the
	// geo-choropleth mode detects on), then pick the World Countries geography
	// level so the world-atlas geometry + naturalEarth projection load.
	await page.getByRole("button", { name: "Maps" }).click()
	await page.getByRole("radio", { name: "Geographic" }).click()
	await page
		.getByLabel("Geography level", { exact: true })
		.selectOption({ label: "World Countries" })

	// "Fill regions with no data" is on by default; pin it on (no-op check)
	// so the entire basemap draws (177 features in world-atlas countries-110m
	// → ≥170 paths, minus any the projection drops to null).
	await page.getByLabel(/Fill regions with no data/i).check()

	// Geometry loads async, then the renderer draws one <path> per feature
	// inside the plot SVG. Poll until the world basemap has painted.
	const paths = page.locator(`#${PLOT_SVG_ID} path`)
	await expect(async () => {
		expect(await paths.count()).toBeGreaterThanOrEqual(170)
	}).toPass({ timeout: 15_000 })

	// Match status in the Maps section: every fixture country (valid ISO-3)
	// should join the countries geometry, so it reads "{n} of {n} matched".
	const matchStatus = page.getByText(/\d+ of \d+ matched/)
	await expect(matchStatus).toBeVisible()
	await expect(matchStatus).toHaveText(
		new RegExp(`\\b${rowCount} of ${rowCount} matched\\b`)
	)
})
