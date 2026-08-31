import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { PLOT_SVG_ID } from "../src/contexts/chartBuilder/lib/captureThumbnail"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** End-to-end happy path for the lat/long DOT MAP (geographic point map).
 *  Mirrors `maps-bubble-map.spec.ts` / `maps-choropleth.spec.ts`: rather than
 *  driving a file-input upload, we seed a dataset + saved visual into
 *  localStorage via `seedFixtureScript`, then drive the real UI.
 *
 *  What makes this a dot map (mode `geo-points`) is the channel mapping: with
 *  the coordinate system flipped to Geographic and BOTH `x` (shelf label "X
 *  position") and `y` (shelf label "Y position") mapped to raw lon/lat
 *  columns — and NO connection — `chartMode` resolves `geo-points`, and the
 *  `GeoPointPlot` renderer projects each data row's [lon, lat] to a `<circle>`
 *  over an optional geography basemap.
 *
 *  Asserts:
 *   - the dots render: one `<circle>` per city that projects within the US.
 *     All 10 fixture cities are continental-US, so expect ≥10 circles.
 *   - the geography basemap renders by default (showBasemap defaults true):
 *     the state outlines draw as `<path>` elements (≥50) behind the dots.
 *   - toggling "Show basemap" OFF (the checkbox that appears only in
 *     geo-points / geo-symbols mode) removes the `<path>` basemap while the
 *     `<circle>` dots remain.
 *   - the lon/lat hint ("X = longitude and Y = latitude") is visible in the
 *     Maps section in this mode.
 *
 *  The fixture rows come straight from `e2e/fixtures/cities-lonlat.csv` so the
 *  CSV is the single source of truth for the data under test. */

const FIXTURE_URL = new URL("./fixtures/cities-lonlat.csv", import.meta.url)

/** Parse the tiny `city,lon,lat,pop` fixture into the row/field shape the seed
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

test("dot map happy path: map X/Y lon/lat, go Geographic, points render", async ({
	page,
}) => {
	const { rows, rowCount } = loadFixtureRows()
	expect(rowCount).toBe(10)

	// Seed a dataset + saved visual with NO encodings (no-map default).
	// We map the channels and toggle Geographic through the real UI below.
	const fx: SeedFixture = {
		visualId: "vis-dot-map",
		datasetId: "ds-dot-map",
		datasetName: "cities-lonlat",
		fields: [
			{ name: "city", inferredType: "categorical" },
			{ name: "lon", inferredType: "quantitative" },
			{ name: "lat", inferredType: "quantitative" },
			{ name: "pop", inferredType: "quantitative" },
		],
		rows,
		encodings: {},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	// Map X → lon and Y → lat (the x/y channels carry raw longitude/latitude on
	// a dot map). Do NOT map connection — a region-keyed bubble/choropleth
	// requires NO x/y; here x/y position is what activates geo-points.
	await page.getByLabel("X position", { exact: true }).selectOption("lon")
	await page.getByLabel("Y position", { exact: true }).selectOption("lat")

	// The Maps section is `defaultCollapsed` — expand it, then flip the
	// Coordinate-system radio to Geographic (the master switch the geo modes
	// detect on). Geography level auto-resolves to states + albersUsa.
	await page.getByRole("button", { name: "Maps" }).click()
	await page.getByRole("radio", { name: "Geographic" }).click()

	// The lon/lat hint appears only in geo-points mode — confirms the mode is
	// active and tells the user X = longitude / Y = latitude.
	await expect(
		page.getByText(/X = longitude and Y = latitude/i)
	).toBeVisible()

	// Geometry (states-10m) loads async, then the renderer projects each row's
	// [lon, lat] to one <circle>. All 10 fixture cities are continental-US, so
	// each projects within albersUsa → expect ≥10 dots. Poll until painted.
	const circles = page.locator(`#${PLOT_SVG_ID} circle`)
	await expect(async () => {
		expect(await circles.count()).toBeGreaterThanOrEqual(10)
	}).toPass({ timeout: 15_000 })

	// Basemap is on by default (showBasemap defaults true): the state outlines
	// draw as <path> elements behind the dots.
	const paths = page.locator(`#${PLOT_SVG_ID} path`)
	await expect(async () => {
		expect(await paths.count()).toBeGreaterThanOrEqual(50)
	}).toPass({ timeout: 15_000 })

	// Toggle "Show basemap" OFF — this checkbox appears only in geo-points /
	// geo-symbols mode, which we're now in. The <path> basemap should disappear
	// while the <circle> dots remain.
	await page.getByLabel(/Show basemap/i).uncheck()
	await expect(async () => {
		expect(await paths.count()).toBe(0)
	}).toPass({ timeout: 10_000 })
	// Dots still render on top.
	expect(await circles.count()).toBeGreaterThanOrEqual(10)
})
