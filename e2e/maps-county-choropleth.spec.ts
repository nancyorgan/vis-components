import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

import { PLOT_SVG_ID } from "../src/contexts/chartBuilder/lib/captureThumbnail"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** End-to-end happy path for the US counties choropleth (the deferred Phase 4
 *  of the maps plan). Mirrors maps-choropleth.spec.ts: seed a dataset + saved
 *  visual, then drive the real UI — map Connection + Color, flip the
 *  Coordinate system to Geographic, and pick the "US Counties" geography
 *  level (counties are never the auto level; states are).
 *
 *  The fixture joins by 5-digit county FIPS and deliberately includes one
 *  UNPADDED code ("6073" -> San Diego 06073) to exercise the 5-digit-aware
 *  input padding, plus an independent city (Baltimore city 24510).
 *
 *  Asserts the matched counties paint, the match status reads all rows
 *  matched, and — with "Fill regions with no data" pinned on (the default;
 *  check() is a no-op today) — the full
 *  counties-10m basemap (3231 features) draws. The counties TopoJSON is a
 *  dynamic import, so this also proves the lazy chunk loads in the dev
 *  server the e2e suite runs against. */

const FIXTURE_URL = new URL("./fixtures/counties-rate.csv", import.meta.url)

/** Parse the tiny `county,rate` fixture into the row/field shape the seed
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

test("counties choropleth happy path: county FIPS join at the counties level", async ({
	page,
}) => {
	const { rows, rowCount } = loadFixtureRows()

	const fx: SeedFixture = {
		visualId: "vis-county-choropleth",
		datasetId: "ds-county-choropleth",
		datasetName: "counties-rate",
		fields: [
			{ name: "county", inferredType: "categorical" },
			{ name: "rate", inferredType: "quantitative" },
		],
		rows,
		encodings: {},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	await page.getByLabel("Connection", { exact: true }).selectOption("county")
	await page.getByLabel("Color", { exact: true }).selectOption("rate")

	// Expand the (defaultCollapsed) Maps section, go Geographic, and pick the
	// counties level — "auto" resolves to states, so counties is an explicit
	// choice.
	await page.getByRole("button", { name: "Maps" }).click()
	await page.getByRole("radio", { name: "Geographic" }).click()
	await page
		.getByLabel("Geography level", { exact: true })
		.selectOption({ label: "US Counties" })

	// The matched counties paint once the lazily-imported counties TopoJSON
	// resolves (the default also fills no-data regions, so the count can be
	// far above rowCount — the ≥ assertion tolerates both).
	const paths = page.locator(`#${PLOT_SVG_ID} path`)
	await expect(async () => {
		expect(await paths.count()).toBeGreaterThanOrEqual(rowCount)
	}).toPass({ timeout: 15_000 })

	// Every fixture county (incl. the unpadded "6073" and Baltimore city)
	// joins the counties geometry.
	const matchStatus = page.getByText(/\d+ of \d+ matched/)
	await expect(matchStatus).toBeVisible()
	await expect(matchStatus).toHaveText(
		new RegExp(`\\b${rowCount} of ${rowCount} matched\\b`)
	)

	// The counties-level name hint steers users toward FIPS / qualified names.
	await expect(
		page.getByText(/County names repeat across states/i)
	).toBeVisible()

	// Pin fill-no-data on (the default; no-op check) -> the whole
	// 3231-feature basemap paints.
	await page.getByLabel(/Fill regions with no data/i).check()
	await expect(async () => {
		expect(await paths.count()).toBeGreaterThanOrEqual(3000)
	}).toPass({ timeout: 20_000 })
})

test("auto geography level detects counties from county FIPS values", async ({
	page,
}) => {
	const { rows, rowCount } = loadFixtureRows()

	const fx: SeedFixture = {
		visualId: "vis-county-auto",
		datasetId: "ds-county-auto",
		datasetName: "counties-rate-auto",
		fields: [
			{ name: "county", inferredType: "categorical" },
			{ name: "rate", inferredType: "quantitative" },
		],
		rows,
		encodings: {},
	}
	await page.addInitScript(seedFixtureScript(fx))
	await page.goto(`/editor/${fx.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })

	await page.getByLabel("Connection", { exact: true }).selectOption("county")
	await page.getByLabel("Color", { exact: true }).selectOption("rate")

	await page.getByRole("button", { name: "Maps" }).click()
	await page.getByRole("radio", { name: "Geographic" }).click()

	// Geography level stays on "Auto" — detection must resolve counties from
	// the FIPS values and paint the matched counties, no explicit pick needed
	// (the original bug report: this used to resolve to states and go blank).
	const paths = page.locator(`#${PLOT_SVG_ID} path`)
	await expect(async () => {
		expect(await paths.count()).toBeGreaterThanOrEqual(rowCount)
	}).toPass({ timeout: 15_000 })

	const matchStatus = page.getByText(/\d+ of \d+ matched/)
	await expect(matchStatus).toHaveText(
		new RegExp(`\\b${rowCount} of ${rowCount} matched\\b`)
	)

	// The dropdown surfaces what Auto resolved to.
	await expect(
		page.getByLabel("Geography level", { exact: true }).locator("option", {
			hasText: "Auto (US Counties)",
		})
	).toHaveCount(1)
})
