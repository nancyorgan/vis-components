import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach } from "vitest"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_FILL } from "../../lib/channelConfig"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { GeoPointPlot } from "./GeoPointPlot"

/** Lat/long dot map: one `<circle>` at each data row's PROJECTED [lon, lat]
 *  position (no region join — points come straight from the data). Optionally
 *  sized by the `area` channel (proportional symbols); when `area` is unmapped
 *  every point is a uniform dot. Optionally draws the geography outlines as a
 *  `<path>` backdrop (mapConfig.showBasemap, default true).
 *
 *  Geometry loads async (loadGeometry is a memoized promise), so tests await
 *  the marks appearing. Seeding mirrors GeoSymbolPlot.smoke.test.tsx —
 *  through localStorage, because the atoms' persist effects re-read storage on
 *  first `get` and clobber any `initializeState` value. */

const DATASET_ID = "ds-geo-point"

// A few US cities (lon, lat) that all project under albersUsa, plus a pop col.
const US_CITIES: Record<string, string>[] = [
	{ city: "NYC", lon: "-74", lat: "40.7", pop: "8400000" },
	{ city: "LA", lon: "-118", lat: "34", pop: "3900000" },
	{ city: "Chicago", lon: "-87.6", lat: "41.8", pop: "2700000" },
]

const buildDataset = (rows: Record<string, string>[] = US_CITIES): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "cities",
		filename: "cities.csv",
		fields: [
			{ name: "city", inferredType: "categorical" },
			{ name: "lon", inferredType: "quantitative" },
			{ name: "lat", inferredType: "quantitative" },
			{ name: "pop", inferredType: "quantitative" },
		],
		rows,
	})

const seed = (
	rows?: Record<string, string>[],
	encodingOverrides: Record<string, unknown> = {},
	mapConfigOverrides: Partial<typeof DEFAULT_MAP_CONFIG> = {}
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset(rows) })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "lon" },
		y: { field: "lat" },
		...encodingOverrides,
	})
	set("vis-components:currentMapConfig", {
		...DEFAULT_MAP_CONFIG,
		coordSystem: "geographic",
		geographyLevel: "states",
		...mapConfigOverrides,
	})
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<svg width={800} height={600}>
				<GeoPointPlot />
			</svg>
		</TestProvider>
	)

// Rows with an extra categorical column, so `hue` has something to map while
// `area` sizes the same dots. Chicago's pop is tiny on purpose — the radius
// ordering below has to be unambiguous.
const CITIES_WITH_CATEGORY: Record<string, string>[] = [
	{ city: "NYC", region: "east", lon: "-74", lat: "40.7", pop: "8400000" },
	{ city: "LA", region: "west", lon: "-118", lat: "34", pop: "3900000" },
	{ city: "Chicago", region: "midwest", lon: "-87.6", lat: "41.8", pop: "100" },
]

/** Seed a dataset that also carries the categorical `region` field (the base
 *  `seed` helper's dataset has no categorical column besides `city`). */
const seedWithCategory = (
	encodingOverrides: Record<string, unknown> = {},
	mapConfigOverrides: Partial<typeof DEFAULT_MAP_CONFIG> = {},
	rows: Record<string, string>[] = CITIES_WITH_CATEGORY
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	const dataset: Dataset = buildDatasetFixture({
		id: DATASET_ID,
		name: "cities",
		filename: "cities.csv",
		fields: [
			{ name: "city", inferredType: "categorical" },
			{ name: "region", inferredType: "categorical" },
			{ name: "lon", inferredType: "quantitative" },
			{ name: "lat", inferredType: "quantitative" },
			{ name: "pop", inferredType: "quantitative" },
		],
		rows,
	})
	set("vis-components:datasets", { [DATASET_ID]: dataset })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "lon" },
		y: { field: "lat" },
		...encodingOverrides,
	})
	set("vis-components:currentMapConfig", {
		...DEFAULT_MAP_CONFIG,
		coordSystem: "geographic",
		geographyLevel: "states",
		...mapConfigOverrides,
	})
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

/** Mark circles only — `<pattern>` defs contain circles of their own. */
const dotCircles = (container: HTMLElement): SVGCircleElement[] =>
	[...container.querySelectorAll("circle")].filter(
		(c) => c.closest("defs") === null
	)

afterEach(cleanup)

describe("GeoPointPlot (lat/long dot map)", () => {
	it("renders one <circle> per row that projects within the geography", async () => {
		// All 3 US cities project under albersUsa → 3 dots.
		seed(US_CITIES)
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const radii = [...container.querySelectorAll("circle")].map((c) =>
			Number(c.getAttribute("r"))
		)
		// Uniform dots (no area mapped) — every one has a positive radius.
		expect(radii.every((r) => r > 0)).toBe(true)
	})

	it("draws the geography basemap behind the points by default", async () => {
		// showBasemap defaults true → all state features draw as a backdrop.
		seed()
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		// Points still render on top.
		expect(container.querySelectorAll("circle").length).toBe(3)
	})

	it("omits the basemap when showBasemap is false", async () => {
		seed(undefined, {}, { showBasemap: false })
		const { container } = mount()
		// Wait for the points (proves geometry resolved) then assert no paths.
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		expect(container.querySelectorAll("path").length).toBe(0)
	})

	it("sizes points by the area value when area is mapped (larger pop → larger radius)", async () => {
		// Two cities with very different pops; the bigger one gets a bigger r.
		seed(
			[
				{ city: "NYC", lon: "-74", lat: "40.7", pop: "8400000" },
				{ city: "Chicago", lon: "-87.6", lat: "41.8", pop: "100" },
			],
			{ area: { field: "pop" } }
		)
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(2)
		})
		const radii = [...container.querySelectorAll("circle")]
			.map((c) => Number(c.getAttribute("r")))
			.sort((a, b) => a - b)
		// Distinct radii, ascending — the area scale spread the two values.
		expect(radii[1]).toBeGreaterThan(radii[0])
	})

	it("skips points whose [lon, lat] projects outside the geography", async () => {
		// Tokyo (lon 140, lat 35) projects to null under albersUsa → no dot.
		seed([
			{ city: "NYC", lon: "-74", lat: "40.7", pop: "1" },
			{ city: "LA", lon: "-118", lat: "34", pop: "1" },
			{ city: "Tokyo", lon: "140", lat: "35", pop: "1" },
		])
		const { container } = mount()
		// Wait for the basemap (proves geometry resolved) then assert the count.
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		// Only the 2 US cities draw; Tokyo is dropped (projected null).
		expect(container.querySelectorAll("circle").length).toBe(2)
	})

	it("shows a tooltip with the row's fields when hovering a point", async () => {
		seed()
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const point = container.querySelector("circle")
		expect(point).toBeTruthy()
		// No tooltip before hovering.
		expect(document.querySelector(".vc-tooltip")).toBeNull()
		fireEvent.mouseEnter(point!)
		// HoverTooltip portals to document.body and shows every dataset field.
		const tip = document.querySelector(".vc-tooltip")
		expect(tip).toBeTruthy()
		expect(tip!.textContent).toContain("city")
		expect(tip!.textContent).toContain("lon")
	})

	it("colors dots by hue AND sizes them by area at the same time", async () => {
		// Two independent scales over the same rows: `hue` drives fill, `area`
		// drives radius. On a DOT map (unlike the bubble map, where hue is a
		// choropleth measure on the regions) hue paints the marks themselves.
		// Identify each dot by its cx: albersUsa x grows eastward, so sorting by
		// cx gives LA (-118) → Chicago (-87.6) → NYC (-74), which pins the radius
		// assertions to specific ROWS instead of just "some spread".
		seedWithCategory({ hue: { field: "region" }, area: { field: "pop" } })
		const { container } = mount()
		await waitFor(() => {
			expect(dotCircles(container).length).toBe(3)
		})
		const byLon = dotCircles(container)
			.map((c) => ({
				cx: Number(c.getAttribute("cx")),
				r: Number(c.getAttribute("r")),
				fill: c.getAttribute("fill"),
			}))
			.sort((a, b) => a.cx - b.cx)
		const [la, chicago, nyc] = byLon
		// Hue: each of the three distinct `region` values took its own color.
		expect(new Set(byLon.map((d) => d.fill)).size).toBe(3)
		// Area: radii follow each row's own pop (NYC 8.4M > LA 3.9M > Chicago 100).
		expect(nyc.r).toBeGreaterThan(la.r)
		expect(la.r).toBeGreaterThan(chicago.r)
	})

	it("keeps the hue fills off the default mark fill (hue actually applied)", async () => {
		// Guard against the scales silently no-op'ing: with hue + area mapped, no
		// dot may still be painted the default fill.
		seedWithCategory({ hue: { field: "region" }, area: { field: "pop" } })
		const { container } = mount()
		await waitFor(() => {
			expect(dotCircles(container).length).toBe(3)
		})
		const fills = dotCircles(container).map((c) => c.getAttribute("fill"))
		expect(fills.some((f) => f === DEFAULT_FILL)).toBe(false)
	})

	describe("countries level", () => {
		// World cities, all far outside the US: under the states default
		// (albersUsa) every one of these projects to null and NO dot draws, so a
		// full set of dots is proof the countries level resolved its own
		// projection (auto → naturalEarth) end to end.
		const WORLD_CITIES: Record<string, string>[] = [
			{
				city: "Sao Paulo",
				region: "americas",
				lon: "-46.6",
				lat: "-23.5",
				pop: "12300000",
			},
			{
				city: "Paris",
				region: "europe",
				lon: "2.35",
				lat: "48.85",
				pop: "2100000",
			},
			{
				city: "Tokyo",
				region: "asia",
				lon: "139.7",
				lat: "35.7",
				pop: "13900000",
			},
		]

		it("projects world lon/lat under the world projection and draws the countries basemap", async () => {
			seedWithCategory({}, { geographyLevel: "countries" }, WORLD_CITIES)
			const { container } = mount()
			await waitFor(() => {
				expect(dotCircles(container).length).toBe(3)
			})
			// world-atlas countries-110m ships 177 features — far more than the
			// ~50 states basemap, so this also proves the right bundle loaded.
			expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(
				150
			)
		})

		it("drops those same points at the states level (albersUsa clips them)", async () => {
			// The control for the test above: identical rows, states level → the
			// basemap draws but not a single dot.
			seedWithCategory({}, { geographyLevel: "states" }, WORLD_CITIES)
			const { container } = mount()
			await waitFor(() => {
				expect(
					container.querySelectorAll("path").length
				).toBeGreaterThanOrEqual(50)
			})
			expect(dotCircles(container).length).toBe(0)
		})

		it("applies hue + area to countries-level dots", async () => {
			seedWithCategory(
				{ hue: { field: "region" }, area: { field: "pop" } },
				{ geographyLevel: "countries" },
				WORLD_CITIES
			)
			const { container } = mount()
			await waitFor(() => {
				expect(dotCircles(container).length).toBe(3)
			})
			// naturalEarth x also grows eastward: Sao Paulo → Paris → Tokyo.
			const byLon = dotCircles(container)
				.map((c) => ({
					cx: Number(c.getAttribute("cx")),
					r: Number(c.getAttribute("r")),
					fill: c.getAttribute("fill"),
				}))
				.sort((a, b) => a.cx - b.cx)
			const [sao, paris, tokyo] = byLon
			expect(new Set(byLon.map((d) => d.fill)).size).toBe(3)
			// Tokyo 13.9M > Sao Paulo 12.3M > Paris 2.1M.
			expect(tokyo.r).toBeGreaterThan(sao.r)
			expect(sao.r).toBeGreaterThan(paris.r)
		})
	})

	it("pattern channel: dots fill with pattern refs and emit <pattern> defs", async () => {
		seed(undefined, { pattern: { field: "city" } })
		const { container } = mount()
		// The <pattern> defs themselves contain circles (the dots pattern), so
		// count only the mark circles OUTSIDE <defs>.
		const markCircles = () =>
			[...container.querySelectorAll("circle")].filter(
				(c) => c.closest("defs") === null
			)
		await waitFor(() => {
			expect(markCircles().length).toBe(3)
		})
		const fills = markCircles().map((c) => c.getAttribute("fill"))
		// Every dot draws through a pattern paint server…
		expect(fills.every((f) => f?.startsWith("url(#vc-pat-"))).toBe(true)
		// …and every referenced def actually exists in the SVG.
		for (const f of fills) {
			const id = f!.slice("url(#".length, -1)
			expect(container.querySelector(`pattern[id="${id}"]`)).not.toBeNull()
		}
	})
})
