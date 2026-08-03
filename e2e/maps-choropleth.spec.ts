import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { PLOT_SVG_ID } from "../src/contexts/chartBuilder/lib/captureThumbnail"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** End-to-end happy path for the states choropleth (Task 12 of the
 *  maps-choropleth plan). Mirrors the repo's e2e convention: rather than
 *  driving a file-input upload (the app has no upload affordance in the
 *  editor route), we seed a dataset + saved visual into localStorage via
 *  `seedFixtureScript`, then drive the real UI — mapping the Connection and
 *  Color channels through the encoding shelves and flipping the Maps
 *  section's Coordinate-system toggle to Geographic. The fixture rows come
 *  straight from `e2e/fixtures/states-rate.csv` so the CSV is the single
 *  source of truth for the data under test.
 *
 *  Asserts the geo-choropleth mode resolves and renders the full US basemap
 *  inside the plot SVG, and that the Maps match-status reflects all 50
 *  fixture states matched. By default only regions WITH data draw, so the
 *  spec turns the "Fill regions with no data" toggle ON to force the whole
 *  basemap (states-10m has 56 features → ≥50 paths incl. territories/DC). */

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

test("states choropleth happy path: map connection + color, go Geographic", async ({
	page,
}) => {
	const { rows, rowCount } = loadFixtureRows()

	// Seed a dataset + saved visual with NO encodings (cartesian default).
	// We map the channels and toggle Geographic through the real UI below.
	const fx: SeedFixture = {
		visualId: "vis-choropleth",
		datasetId: "ds-choropleth",
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

	// Map the region field to the Connection channel and the measure to the
	// Color (hue) channel. The encoding shelves render labeled <select>s
	// ("Connection", "Color"); selecting by the visible option text mirrors
	// a user picking the column.
	await page.getByLabel("Connection", { exact: true }).selectOption("state")
	await page.getByLabel("Color", { exact: true }).selectOption("rate")

	// The Maps section is `defaultCollapsed` — expand it via its header
	// button, then flip the Coordinate-system radio to Geographic. That is
	// the master switch the geo-choropleth mode detects on.
	await page.getByRole("button", { name: "Maps" }).click()
	await page.getByRole("radio", { name: "Geographic" }).click()

	// Default behavior draws ONLY the matched regions. Turn on "Fill regions
	// with no data" so the entire basemap (incl. territories/DC with no row)
	// draws — that's what the ≥50-path assertion below verifies.
	await page.getByLabel(/Fill regions with no data/i).check()

	// Geometry (states-10m) loads async, then the renderer draws one <path>
	// per feature inside the plot SVG. Poll until the choropleth has painted
	// at least 50 paths (56 features in states-10m, minus any the projection
	// drops to null).
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
})
