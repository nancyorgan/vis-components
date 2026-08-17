/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed and inspect localStorage deliberately */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach } from "vitest"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { MAP_CONFIG_VERSION } from "../../lib/storage/migrations"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { GeoChoroplethPlot } from "./GeoChoroplethPlot"

/** First geographic renderer: one `<path>` per state feature, filled by a
 *  measure joined from the data via the `connection` (region) channel.
 *  Geometry loads async (loadGeometry is a memoized promise), so the test
 *  awaits the paths appearing. states-10m ships 56 features.
 *
 *  Seeding goes through localStorage (not `initializeState`) because the
 *  atoms' persist effects re-read storage on first `get`, clobbering any
 *  `initializeState` value — mirror the other `*.smoke.test.tsx` here. */

const DATASET_ID = "ds-geo-choropleth"

const buildDataset = (
	rows: Record<string, string>[] = [
		{ state: "CA", rate: "1" },
		{ state: "TX", rate: "2" },
		{ state: "NY", rate: "3" },
		{ state: "FL", rate: "4" },
	]
): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "rates",
		filename: "rates.csv",
		fields: [
			{ name: "state", inferredType: "categorical" },
			{ name: "rate", inferredType: "quantitative" },
		],
		rows,
	})

const seed = (
	rows?: Record<string, string>[],
	mapConfigOverrides: Partial<typeof DEFAULT_MAP_CONFIG> = {}
) => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset(rows) })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		connection: { field: "state" },
		hue: { field: "rate" },
	})
	// Wrapped in the current-version envelope so overrides are taken literally
	// — a bare (v0) object would run the full migration chain, whose v5→v6
	// step resets an explicit `showNoDataRegions: false` back to true.
	set("vis-components:currentMapConfig", {
		_v: MAP_CONFIG_VERSION,
		data: {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			...mapConfigOverrides,
		},
	})
	/* eslint-enable @th/use-wrapped-json-functions */
}

/** Seed with the full basemap drawn (showNoDataRegions on — the default,
 *  set explicitly for clarity): ≥50 paths, no-data fill present. */
const seedFullBasemap = (rows?: Record<string, string>[]) =>
	seed(rows, { showNoDataRegions: true })

/** Like `seed`, but also writes a `shape` channelConfig (outline color /
 *  width) so the region-border tests can assert the controls take effect.
 *  Seeded as a bare object — `loadVersioned`'s identity migration passes it
 *  through unchanged, matching how `seed` writes encodings / mapConfig.
 *  The full basemap is drawn (showNoDataRegions on) so the border assertions
 *  span the whole geometry, not just the handful of matched regions. */
const seedWithShape = (
	shape: Record<string, unknown>,
	rows?: Record<string, string>[]
) => {
	seed(rows, { showNoDataRegions: true })
	/* eslint-disable @th/use-wrapped-json-functions */
	localStorage.setItem(
		"vis-components:currentChannelConfigs",
		JSON.stringify({ shape })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<svg width={800} height={600}>
				<GeoChoroplethPlot />
			</svg>
		</TestProvider>
	)

afterEach(cleanup)

describe("GeoChoroplethPlot (states choropleth)", () => {
	it("renders one <path> per state feature when filling no-data regions", async () => {
		seedFullBasemap()
		const { container } = mount()
		// Geometry resolves on a microtask, so wait for the basemap to draw.
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
	})

	it("by DEFAULT fills regions absent from the dataset with the no-data color", async () => {
		// The user-reported gap: a geography missing from the dataset entirely
		// (no row at all, not just a blank measure) must still paint with the
		// missing-data color. Default config, four matched states → the full
		// basemap draws, unmatched states in the no-data fill.
		seed()
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		expect(fills).toContain(DEFAULT_MAP_CONFIG.noDataFill)
		// The matched states are still scale-colored.
		expect(
			fills.some((f) => f !== null && f !== DEFAULT_MAP_CONFIG.noDataFill)
		).toBe(true)
	})

	it("with showNoDataRegions off draws ONLY matched regions", async () => {
		// Toggle off: only the four states with data should draw — no full
		// basemap, and no path painted with the no-data fill.
		seed(
			[
				{ state: "CA", rate: "1" },
				{ state: "TX", rate: "2" },
				{ state: "NY", rate: "3" },
				{ state: "FL", rate: "4" },
			],
			{ showNoDataRegions: false }
		)
		const { container } = mount()
		// Wait for geometry to resolve and the matched regions to paint.
		await waitFor(() => {
			expect(container.querySelectorAll("path").length).toBe(4)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		// No matched region carries data with a null measure here, so none
		// uses the no-data fill — every drawn region is scale-colored.
		expect(fills).not.toContain(DEFAULT_MAP_CONFIG.noDataFill)
		expect(fills.length).toBe(4)
	})

	it("a focus region fills non-data regions even with showNoDataRegions off", async () => {
		// Reported bug: focusing a region left the non-data land blank. Focusing
		// implies "show this area as a filled map", so non-data regions take the
		// no-data fill regardless of the showNoDataRegions toggle (explicitly
		// off here). The four matched states stay scale-colored.
		seed(
			[
				{ state: "CA", rate: "1" },
				{ state: "TX", rate: "2" },
				{ state: "NY", rate: "3" },
				{ state: "FL", rate: "4" },
			],
			{ focusRegion: "northAmerica", showNoDataRegions: false }
		)
		const { container } = mount()
		// Many more than the 4 matched states draw now (the rest of the states
		// in no-data fill, plus the world backdrop countries).
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		expect(fills).toContain(DEFAULT_MAP_CONFIG.noDataFill)
		expect(
			fills.some((f) => f !== null && f !== DEFAULT_MAP_CONFIG.noDataFill)
		).toBe(true)
		// A NAMED region is interactive too — users can drag/zoom to fine-tune
		// it (the gesture promotes it to a custom viewport). So the interactive
		// group + capture rect are present, not just in "custom" mode.
		const interactive = container.querySelector('[role="application"]')
		expect(interactive?.getAttribute("tabindex")).toBe("0")
		expect(
			container.querySelector('rect[pointer-events="all"]')
		).not.toBeNull()
	})

	it("custom focus frames the map to the dragged viewport box", async () => {
		// focusRegion "custom" COVERS the plot rect with the stored customViewport
		// (here a North-America-ish box) and clips to the rect — a fixed frame.
		// Cover crops the box's looser axis, so not every state is visible; the
		// point is that the focused land renders + fills. The <g role=application>
		// carries the pan/zoom affordances.
		seed(
			[
				{ state: "CA", rate: "1" },
				{ state: "TX", rate: "2" },
			],
			{
				focusRegion: "custom",
				customViewport: { west: -128, south: 23, east: -66, north: 50 },
			}
		)
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(10)
		})
		// Non-data states fill the no-data color (focus implies a filled map).
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		expect(fills).toContain(DEFAULT_MAP_CONFIG.noDataFill)
		// The map group is interactive in custom mode (focusable + role).
		const interactive = container.querySelector('[role="application"]')
		expect(interactive).not.toBeNull()
		expect(interactive?.getAttribute("tabindex")).toBe("0")
		// A transparent capture rect covers the plot so wheel/drag over empty
		// areas still reach the handlers (events bubble from it to the group).
		expect(
			container.querySelector('rect[pointer-events="all"]')
		).not.toBeNull()
	})

	it("fills matched regions via the scale and unmatched with noDataFill", async () => {
		// Asserts the no-data fill is present → needs the no-data basemap on.
		seedFullBasemap()
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		// Most states carry no data → the no-data fill is present.
		expect(fills).toContain(DEFAULT_MAP_CONFIG.noDataFill)
		// The four matched states are colored via the hue scale (not no-data).
		expect(
			fills.some((f) => f !== null && f !== DEFAULT_MAP_CONFIG.noDataFill)
		).toBe(true)
	})

	it("falls back to noDataFill for an explicitly-unmatched region value", async () => {
		// "ZZ" is not a real state abbreviation — it joins to no feature, so the
		// renderer must draw the basemap and fall back to the no-data fill rather
		// than crash on the unmatched value. With the no-data basemap on we can
		// assert the no-data fill is present across the unmatched regions.
		seedFullBasemap([
			{ state: "CA", rate: "1" },
			{ state: "ZZ", rate: "9" },
		])
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		// The unmatched ("ZZ") and the many states without data all use no-data.
		expect(fills).toContain(DEFAULT_MAP_CONFIG.noDataFill)
	})

	it("no-data pattern: absent AND blank-measure regions fill with the pattern ref", async () => {
		// A pattern picked for the no-data fill: regions absent from the dataset
		// AND a matched row with a blank measure cell both paint with the
		// url(#vc-pat-nodata) paint server; the states with data keep their
		// scale colors. The def itself must be registered in the SVG.
		seed(
			[
				{ state: "CA", rate: "1" },
				{ state: "TX", rate: "" }, // explicit blank → missing data
			],
			{ noDataPattern: 1 }
		)
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		const markFills = [...container.querySelectorAll("path")]
			.filter((p) => p.closest("defs") === null)
			.map((p) => p.getAttribute("fill"))
		expect(markFills).toContain("url(#vc-pat-nodata)")
		// Solid no-data fill is fully replaced by the pattern paint.
		expect(markFills).not.toContain(DEFAULT_MAP_CONFIG.noDataFill)
		// CA still scale-colored (not the pattern, not the no-data fill).
		expect(
			markFills.some(
				(f) => f !== null && f !== "url(#vc-pat-nodata)"
			)
		).toBe(true)
		expect(
			container.querySelector('pattern[id="vc-pat-nodata"]')
		).not.toBeNull()
	})

	it("shows a tooltip with the row's fields when hovering a matched region", async () => {
		// Full basemap so the ≥50 wait holds; matched regions still draw.
		seedFullBasemap()
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		// Pick a MATCHED region: one whose fill is NOT the no-data fill.
		const matched = [...container.querySelectorAll("path")].find(
			(p) =>
				p.getAttribute("fill") !== null &&
				p.getAttribute("fill") !== DEFAULT_MAP_CONFIG.noDataFill
		)
		expect(matched).toBeTruthy()
		// No tooltip before hovering.
		expect(document.querySelector(".vc-tooltip")).toBeNull()
		fireEvent.mouseEnter(matched!)
		// HoverTooltip portals to document.body and shows every dataset field.
		const tip = document.querySelector(".vc-tooltip")
		expect(tip).toBeTruthy()
		expect(tip!.textContent).toContain("rate")
		expect(tip!.textContent).toContain("state")
	})

	it("clears the tooltip on mouse leave", async () => {
		seedFullBasemap()
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		const matched = [...container.querySelectorAll("path")].find(
			(p) =>
				p.getAttribute("fill") !== null &&
				p.getAttribute("fill") !== DEFAULT_MAP_CONFIG.noDataFill
		)
		expect(matched).toBeTruthy()
		fireEvent.mouseEnter(matched!)
		expect(document.querySelector(".vc-tooltip")).toBeTruthy()
		// Leaving the marks group clears the hover state → no tooltip.
		const group = matched!.parentElement!
		fireEvent.mouseLeave(group)
		expect(document.querySelector(".vc-tooltip")).toBeNull()
	})

	it("shows NO tooltip when hovering an unmatched (no-data) region", async () => {
		// No-data regions only exist when the basemap is drawn → toggle on.
		seedFullBasemap([
			{ state: "CA", rate: "1" },
			{ state: "TX", rate: "2" },
		])
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		// A no-data region (most states have no row).
		const noData = [...container.querySelectorAll("path")].find(
			(p) => p.getAttribute("fill") === DEFAULT_MAP_CONFIG.noDataFill
		)
		expect(noData).toBeTruthy()
		fireEvent.mouseEnter(noData!)
		expect(document.querySelector(".vc-tooltip")).toBeNull()
	})

	it("applies the Shape panel outline width to region borders", async () => {
		seedWithShape({ outlineWidth: 4 })
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		// React's `strokeWidth` renders to the `stroke-width` DOM attribute.
		const widths = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("stroke-width")
		)
		expect(widths).toContain("4")
		// The old hardcoded hairline must be gone.
		expect(widths).not.toContain("0.5")
	})

	it("applies the base outline color when no outline field is mapped", async () => {
		seedWithShape({ outlineColor: "#ff0000" })
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		const strokes = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("stroke")
		)
		// Every region border uses the configured base color, not the old
		// hardcoded white.
		expect(strokes).toContain("#ff0000")
		expect(strokes).not.toContain("#ffffff")
	})
})

/** World-country choropleth: verifies the FULL countries pipeline through the
 *  renderer — `geographyLevel: "countries"` loads the world-atlas geometry
 *  (177 features), `projection: "auto"` resolves to naturalEarth (albersUsa
 *  would null out every non-US country), and the ISO join matches data rows by
 *  country code. Mirrors the states seeders above but with a country region
 *  column and the countries map config. */
const COUNTRIES_DATASET_ID = "ds-geo-choropleth-countries"

const buildCountriesDataset = (
	rows: Record<string, string>[] = [
		{ country: "USA", val: "1" },
		{ country: "CAN", val: "2" },
		{ country: "MEX", val: "3" },
	]
): Dataset => ({
	id: COUNTRIES_DATASET_ID,
	name: "country values",
	fields: [
		{ name: "country", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "countries.csv",
			rows,
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

/** Mirror of `seed`, but seeds the countries dataset + a `countries` map
 *  config. `connection` → country code, `hue` → measure. Same versioned
 *  envelope as `seed` so overrides are taken literally. */
const seedCountries = (
	rows?: Record<string, string>[],
	mapConfigOverrides: Partial<typeof DEFAULT_MAP_CONFIG> = {}
) => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", {
		[COUNTRIES_DATASET_ID]: buildCountriesDataset(rows),
	})
	set("vis-components:currentDatasetId", COUNTRIES_DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		connection: { field: "country" },
		hue: { field: "val" },
	})
	set("vis-components:currentMapConfig", {
		_v: MAP_CONFIG_VERSION,
		data: {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			geographyLevel: "countries",
			...mapConfigOverrides,
		},
	})
	/* eslint-enable @th/use-wrapped-json-functions */
}

describe("GeoChoroplethPlot (world-country choropleth)", () => {
	it("with showNoDataRegions off draws ONLY matched countries", async () => {
		// Three countries by ISO-3 (USA/CAN/MEX). With the no-data basemap off,
		// exactly those three features draw — proving the countries geometry
		// loaded, the naturalEarth projection produced paths (albersUsa would
		// drop CAN/MEX to null), and the ISO-3 join matched all three.
		seedCountries(
			[
				{ country: "USA", val: "1" },
				{ country: "CAN", val: "2" },
				{ country: "MEX", val: "3" },
			],
			{ showNoDataRegions: false }
		)
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("path").length).toBe(3)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		// All three carry a measure → the hue scale colors them (none uses the
		// no-data fill), so the join + scale both worked end to end.
		expect(fills).not.toContain(DEFAULT_MAP_CONFIG.noDataFill)
		expect(
			fills.some((f) => f !== null && f !== DEFAULT_MAP_CONFIG.noDataFill)
		).toBe(true)
		expect(fills.length).toBe(3)
	})

	it("draws the full world basemap when filling no-data regions (the default)", async () => {
		// Same three matched countries with the default config → the whole
		// world-atlas basemap draws (177 country features). The unmatched
		// countries carry the no-data fill; the three matched ones are
		// scale-colored.
		seedCountries([
			{ country: "USA", val: "1" },
			{ country: "CAN", val: "2" },
			{ country: "MEX", val: "3" },
		])
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(170)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		// Most countries have no data → the no-data fill is present.
		expect(fills).toContain(DEFAULT_MAP_CONFIG.noDataFill)
		// The three matched countries are colored via the hue scale.
		expect(
			fills.some((f) => f !== null && f !== DEFAULT_MAP_CONFIG.noDataFill)
		).toBe(true)
	})

	it("joins countries given as ISO-2 codes", async () => {
		// "US" / "CA" / "MX" are alpha-2 codes — auto key-type detection must
		// recognize them as ISO and join through the renderer, drawing exactly
		// three matched countries (no-data regions off to isolate the join).
		// Proves the ISO auto-detect (not just ISO-3) works end to end.
		seedCountries(
			[
				{ country: "US", val: "1" },
				{ country: "CA", val: "2" },
				{ country: "MX", val: "3" },
			],
			{ showNoDataRegions: false }
		)
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("path").length).toBe(3)
		})
		const fills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		expect(fills).not.toContain(DEFAULT_MAP_CONFIG.noDataFill)
		expect(fills.length).toBe(3)
	})

	it("pattern channel: matched regions fill with pattern refs and emit <pattern> defs", async () => {
		// No-data regions off so ONLY the four matched (pattern-filled) marks
		// draw — the every-fill-is-a-pattern-ref assertion below needs that.
		seed(
			[
				{ state: "CA", rate: "1", kind: "west" },
				{ state: "TX", rate: "2", kind: "south" },
				{ state: "NY", rate: "3", kind: "east" },
				{ state: "FL", rate: "4", kind: "south" },
			],
			{ showNoDataRegions: false }
		)
		// The stock dataset has no pattern-able column — extend the seeded
		// fields and map the pattern channel on top of the stock seed.
		/* eslint-disable @th/use-wrapped-json-functions */
		const ds = JSON.parse(localStorage.getItem("vis-components:datasets")!)
		ds[DATASET_ID].fields.push({ name: "kind", inferredType: "categorical" })
		localStorage.setItem("vis-components:datasets", JSON.stringify(ds))
		const enc = JSON.parse(
			localStorage.getItem("vis-components:currentEncodings")!
		)
		enc.pattern = { field: "kind" }
		localStorage.setItem("vis-components:currentEncodings", JSON.stringify(enc))
		/* eslint-enable @th/use-wrapped-json-functions */
		const { container } = mount()
		// The <pattern> defs themselves contain paths/circles, so count only
		// the mark paths OUTSIDE <defs>.
		const markPaths = () =>
			[...container.querySelectorAll("path")].filter(
				(p) => p.closest("defs") === null
			)
		await waitFor(() => {
			expect(markPaths().length).toBe(4)
		})
		const fills = markPaths().map((p) => p.getAttribute("fill"))
		// Every matched region draws through a pattern paint server…
		expect(fills.every((f) => f?.startsWith("url(#vc-pat-"))).toBe(true)
		// …and every referenced def actually exists in the SVG.
		for (const f of fills) {
			const id = f!.slice("url(#".length, -1)
			expect(container.querySelector(`pattern[id="${id}"]`)).not.toBeNull()
		}
	})
})
