import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { PLOT_SVG_ID } from "../src/contexts/chartBuilder/lib/captureThumbnail"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** End-to-end happy path for the BUBBLE MAP (proportional symbols at region
 *  centroids). Mirrors `maps-choropleth.spec.ts`: rather than driving a
 *  file-input upload, we seed a dataset + saved visual into localStorage via
 *  `seedFixtureScript`, then drive the real UI.
 *
 *  What makes this a bubble map rather than a choropleth is the channel
 *  mapping: we map the region field to Connection and the MEASURE to the
 *  `area` channel (shelf label "Area") — NOT Color. With geographic +
 *  connection + area mapped (no x/y), `chartMode` resolves `geo-symbols`, and
 *  the `GeoSymbolPlot` renderer draws one sized `<circle>` at each matched
 *  region's centroid.
 *
 *  Asserts:
 *   - the bubbles render: ≥10 `<circle>` elements inside the plot SVG (50
 *     states in the fixture → ~50 matched bubbles).
 *   - the geography basemap renders by default (showBasemap defaults true):
 *     the state outlines draw as `<path>` elements behind the bubbles.
 *   - toggling "Show basemap" OFF (the checkbox that appears only in
 *     symbols mode) removes the `<path>` basemap while the `<circle>`
 *     bubbles remain.
 *   - the Maps match-status reflects all 50 fixture states matched.
 *
 *  The fixture rows come straight from `e2e/fixtures/states-rate.csv` so the
 *  CSV is the single source of truth for the data under test (rate = the
 *  area measure). */

const FIXTURE_URL = new URL("./fixtures/states-rate.csv", import.meta.url)

/** Parse the tiny `state,rate` fixture into the row/field shape the seed
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

test("bubble map happy path: map connection + area, go Geographic, symbols render", async ({
	page,
}) => {
	const { rows, rowCount } = loadFixtureRows()

	// Seed a dataset + saved visual with NO encodings (no-map default).
	// We map the channels and toggle Geographic through the real UI below.
	const fx: SeedFixture = {
		visualId: "vis-bubble-map",
		datasetId: "ds-bubble-map",
		datasetName: "states-rate",
		fields: [
			{ name: "state", inferredType: "categorical" },
			{ name: "rate", inferredType: "quantitative" },
		],
		rows,
		encodings: {},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	// Map the region field to Connection and the MEASURE to the Area channel
	// (shelf label "Area") — NOT Color. This is what makes it a bubble map
	// (sized symbols) rather than a choropleth (filled polygons). Do NOT map
	// x/y — the geo-symbols mode requires connection + area with no x/y.
	await page.getByLabel("Connection", { exact: true }).selectOption("state")
	await page.getByLabel("Area", { exact: true }).selectOption("rate")

	// The Maps section is `defaultCollapsed` — expand it, then flip the
	// Coordinate-system radio to Geographic (the master switch the geo modes
	// detect on). Geography level auto-resolves to states for the fixture.
	await page.getByRole("button", { name: "Maps" }).click()
	await page.getByRole("radio", { name: "Geographic" }).click()

	// Geometry (states-10m) loads async, then the renderer draws one <circle>
	// per matched region with a usable area value. Poll until the bubbles have
	// painted — 50 fixture states should each match the states geometry, so
	// expect ≥10 (and in practice ~50).
	const circles = page.locator(`#${PLOT_SVG_ID} circle`)
	await expect(async () => {
		expect(await circles.count()).toBeGreaterThanOrEqual(10)
	}).toPass({ timeout: 15_000 })

	// Basemap is on by default (showBasemap defaults true): the state outlines
	// draw as <path> elements behind the bubbles.
	const paths = page.locator(`#${PLOT_SVG_ID} path`)
	await expect(async () => {
		expect(await paths.count()).toBeGreaterThanOrEqual(50)
	}).toPass({ timeout: 15_000 })

	// Match status in the Maps section: every fixture state should join the
	// states geometry, so it reads "{rowCount} of {rowCount} matched".
	const matchStatus = page.getByText(/\d+ of \d+ matched/)
	await expect(matchStatus).toBeVisible()
	await expect(matchStatus).toHaveText(
		new RegExp(`\\b${rowCount} of ${rowCount} matched\\b`)
	)

	// Toggle "Show basemap" OFF — this checkbox appears only in symbols mode,
	// which we're now in. The <path> basemap should disappear while the
	// <circle> bubbles remain.
	await page.getByLabel(/Show basemap/i).uncheck()
	await expect(async () => {
		expect(await paths.count()).toBe(0)
	}).toPass({ timeout: 10_000 })
	// Bubbles still render on top.
	expect(await circles.count()).toBeGreaterThanOrEqual(10)
})
