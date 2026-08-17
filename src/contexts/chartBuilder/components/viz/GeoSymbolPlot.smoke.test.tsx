/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed and inspect localStorage deliberately */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach } from "vitest"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { GeoSymbolPlot } from "./GeoSymbolPlot"

/** Bubble map: one `<circle>` at each matched region's centroid, sized by the
 *  `area` channel. Optionally draws the geography outlines as a `<path>`
 *  backdrop (mapConfig.showBasemap, default true).
 *
 *  Geometry loads async (loadGeometry is a memoized promise), so tests await
 *  the marks appearing. Seeding mirrors GeoChoroplethPlot.smoke.test.tsx —
 *  through localStorage, because the atoms' persist effects re-read storage on
 *  first `get` and clobber any `initializeState` value. */

const DATASET_ID = "ds-geo-symbol"

const buildDataset = (
	rows: Record<string, string>[] = [
		{ state: "CA", pop: "100" },
		{ state: "TX", pop: "50" },
		{ state: "NY", pop: "25" },
	]
): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "pops",
		filename: "pops.csv",
		fields: [
			{ name: "state", inferredType: "categorical" },
			{ name: "pop", inferredType: "quantitative" },
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
		area: { field: "pop" },
	})
	set("vis-components:currentMapConfig", {
		...DEFAULT_MAP_CONFIG,
		coordSystem: "geographic",
		geographyLevel: "states",
		...mapConfigOverrides,
	})
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<svg width={800} height={600}>
				<GeoSymbolPlot />
			</svg>
		</TestProvider>
	)

afterEach(cleanup)

describe("GeoSymbolPlot (states bubble map)", () => {
	it("renders one <circle> per matched region with a positive radius", async () => {
		seed([
			{ state: "CA", pop: "100" },
			{ state: "TX", pop: "50" },
			{ state: "NY", pop: "25" },
		])
		const { container } = mount()
		// Geometry resolves on a microtask, so wait for the bubbles to draw.
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const radii = [...container.querySelectorAll("circle")].map((c) =>
			Number(c.getAttribute("r"))
		)
		// Every bubble has a positive radius from the area scale.
		expect(radii.every((r) => r > 0)).toBe(true)
	})

	it("draws the geography basemap behind the bubbles by default", async () => {
		// showBasemap defaults true → all state features draw as a backdrop.
		seed()
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		// Bubbles still render on top.
		expect(container.querySelectorAll("circle").length).toBe(3)
	})

	it("draws the world-countries backdrop under a world projection", async () => {
		// A world projection on a US-states map loads the countries backdrop
		// behind the states so neighbors (Canada/Mexico/etc.) fill the no-data
		// color. With no focus (no clip) the whole world draws: states (~50) +
		// countries (~176) → far more paths than the states-only basemap.
		seed(undefined, { projection: "naturalEarth" })
		const { container } = mount()
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(150)
		})
		expect(container.querySelectorAll("circle").length).toBe(3)
	})

	it("drops the world backdrop when showBasemap is false (even when focused)", async () => {
		// The world backdrop is part of the geography backdrop, so the basemap
		// toggle governs it too: no paths at all when the basemap is off.
		seed(undefined, { focusRegion: "northAmerica", showBasemap: false })
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		expect(container.querySelectorAll("path").length).toBe(0)
	})

	it("omits the basemap when showBasemap is false", async () => {
		seed(undefined, { showBasemap: false })
		const { container } = mount()
		// Wait for the bubbles (proves geometry resolved) then assert no paths.
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		expect(container.querySelectorAll("path").length).toBe(0)
	})

	it("sizes bubbles by the area value (larger pop → larger radius)", async () => {
		// Two regions with very different pops; the bigger one gets a bigger r.
		seed([
			{ state: "CA", pop: "1000" },
			{ state: "TX", pop: "1" },
		])
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

	it("drops bubbles for matched regions with no usable area value", async () => {
		// CA has a real pop; TX's pop is empty → unparseable by the area scale.
		// On a bubble map the size IS the measure, so TX gets NO circle (a
		// fixed-size bubble there would read as a real small data point).
		seed([
			{ state: "CA", pop: "1000" },
			{ state: "TX", pop: "" },
		])
		const { container } = mount()
		// Wait for the basemap (proves geometry resolved) then assert the count.
		await waitFor(() => {
			expect(
				container.querySelectorAll("path").length
			).toBeGreaterThanOrEqual(50)
		})
		// Only CA (a usable area value) draws a bubble; TX is dropped.
		expect(container.querySelectorAll("circle").length).toBe(1)
	})

	it("shows a tooltip with the row's fields when hovering a bubble", async () => {
		seed()
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const bubble = container.querySelector("circle")
		expect(bubble).toBeTruthy()
		// No tooltip before hovering.
		expect(document.querySelector(".vc-tooltip")).toBeNull()
		fireEvent.mouseEnter(bubble!)
		// HoverTooltip portals to document.body and shows every dataset field.
		const tip = document.querySelector(".vc-tooltip")
		expect(tip).toBeTruthy()
		expect(tip!.textContent).toContain("state")
		expect(tip!.textContent).toContain("pop")
	})

	it("colors REGIONS by hue and sizes bubbles by area (choropleth + points)", async () => {
		// New bubble-map model: `hue` is a CHOROPLETH measure driving per-REGION
		// fill (the basemap), while `area` drives bubble SIZE. The bubbles
		// themselves no longer read hue — they use the point-fill slot's default.
		// Seed connection→state, hue→region (categorical, varying), area→pop, and
		// assert: ≥2 distinct REGION (path) fills, bubbles vary in `r`, and the
		// bubble fill is the slot default (NOT one of the region/hue colors).
		installInMemoryLocalStorage()
		/* eslint-disable @th/use-wrapped-json-functions */
		const set = (k: string, v: unknown) =>
			localStorage.setItem(k, JSON.stringify(v))
		const dataset: Dataset = {
			id: DATASET_ID,
			name: "pops",
			fields: [
				{ name: "state", inferredType: "categorical" },
				{ name: "region", inferredType: "categorical" },
				{ name: "pop", inferredType: "quantitative" },
			],
			versions: [
				{
					id: "v1",
					filename: "pops.csv",
					rows: [
						{ state: "CA", region: "west", pop: "100" },
						{ state: "TX", region: "south", pop: "50" },
						{ state: "NY", region: "east", pop: "25" },
					],
					createdAt: 0,
				},
			],
			latestVersionId: "v1",
			createdAt: 0,
		}
		set("vis-components:datasets", { [DATASET_ID]: dataset })
		set("vis-components:currentDatasetId", DATASET_ID)
		set("vis-components:previewVersionId", null)
		set("vis-components:currentEncodings", {
			...emptyEncodings(),
			connection: { field: "state" },
			hue: { field: "region" },
			area: { field: "pop" },
		})
		set("vis-components:currentMapConfig", {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			geographyLevel: "states",
		})
		/* eslint-enable @th/use-wrapped-json-functions */

		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		// Hue drives the REGION fills (the basemap choropleth). The three matched
		// regions (CA/TX/NY) each take a distinct categorical hue color, so across
		// all region paths there are ≥2 distinct fills.
		const regionFills = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("fill")
		)
		expect(new Set(regionFills).size).toBeGreaterThan(1)
		const circles = [...container.querySelectorAll("circle")]
		const bubbleFills = circles.map((c) => c.getAttribute("fill"))
		const radii = circles.map((c) => Number(c.getAttribute("r")))
		// Area drives bubble size: more than one distinct radius across bubbles.
		expect(new Set(radii).size).toBeGreaterThan(1)
		// Bubbles no longer read hue: they all share the single slot-default fill,
		// distinct from the (varying) region hue colors.
		expect(new Set(bubbleFills).size).toBe(1)
	})

	it("fills bubbles with the geoPointFill slot single color (independent of regions)", async () => {
		// The point-fill color slot drives bubble fill, independent of the region
		// choropleth. With a single color set, every bubble uses it.
		installInMemoryLocalStorage()
		/* eslint-disable @th/use-wrapped-json-functions */
		const set = (k: string, v: unknown) =>
			localStorage.setItem(k, JSON.stringify(v))
		set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
		set("vis-components:currentDatasetId", DATASET_ID)
		set("vis-components:previewVersionId", null)
		set("vis-components:currentEncodings", {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		})
		set("vis-components:currentMapConfig", {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			geographyLevel: "states",
		})
		set("vis-components:currentChannelConfigs", {
			colorSlots: { geoPointFill: { singleColor: "#ff00ff" } },
		})
		/* eslint-enable @th/use-wrapped-json-functions */

		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const bubbleFills = [...container.querySelectorAll("circle")].map((c) =>
			c.getAttribute("fill")
		)
		expect(bubbleFills.every((f) => f === "#ff00ff")).toBe(true)
	})

	it("strokes bubbles with the geoPointStroke slot single color", async () => {
		installInMemoryLocalStorage()
		/* eslint-disable @th/use-wrapped-json-functions */
		const set = (k: string, v: unknown) =>
			localStorage.setItem(k, JSON.stringify(v))
		set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
		set("vis-components:currentDatasetId", DATASET_ID)
		set("vis-components:previewVersionId", null)
		set("vis-components:currentEncodings", {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		})
		set("vis-components:currentMapConfig", {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			geographyLevel: "states",
		})
		set("vis-components:currentChannelConfigs", {
			colorSlots: { geoPointStroke: { singleColor: "#00ff00" } },
		})
		/* eslint-enable @th/use-wrapped-json-functions */

		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const strokes = [...container.querySelectorAll("circle")].map((c) =>
			c.getAttribute("stroke")
		)
		expect(strokes.every((s) => s === "#00ff00")).toBe(true)
	})

	it("colors bubbles by a FIELD when the geoPointFill slot maps one", async () => {
		// The point-fill slot can map its own categorical field, independent of
		// the region hue. Three rows with distinct `cat` values → ≥2 bubble fills.
		installInMemoryLocalStorage()
		/* eslint-disable @th/use-wrapped-json-functions */
		const set = (k: string, v: unknown) =>
			localStorage.setItem(k, JSON.stringify(v))
		const dataset: Dataset = {
			id: DATASET_ID,
			name: "pops",
			fields: [
				{ name: "state", inferredType: "categorical" },
				{ name: "cat", inferredType: "categorical" },
				{ name: "pop", inferredType: "quantitative" },
			],
			versions: [
				{
					id: "v1",
					filename: "pops.csv",
					rows: [
						{ state: "CA", cat: "a", pop: "100" },
						{ state: "TX", cat: "b", pop: "50" },
						{ state: "NY", cat: "c", pop: "25" },
					],
					createdAt: 0,
				},
			],
			latestVersionId: "v1",
			createdAt: 0,
		}
		set("vis-components:datasets", { [DATASET_ID]: dataset })
		set("vis-components:currentDatasetId", DATASET_ID)
		set("vis-components:previewVersionId", null)
		set("vis-components:currentEncodings", {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		})
		set("vis-components:currentMapConfig", {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			geographyLevel: "states",
		})
		set("vis-components:currentChannelConfigs", {
			colorSlots: {
				geoPointFill: { field: "cat" },
			},
		})
		/* eslint-enable @th/use-wrapped-json-functions */

		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const bubbleFills = [...container.querySelectorAll("circle")].map((c) =>
			c.getAttribute("fill")
		)
		expect(new Set(bubbleFills).size).toBeGreaterThan(1)
	})

	it("clears the tooltip on mouse leave", async () => {
		seed()
		const { container } = mount()
		await waitFor(() => {
			expect(container.querySelectorAll("circle").length).toBe(3)
		})
		const bubble = container.querySelector("circle")!
		fireEvent.mouseEnter(bubble)
		expect(document.querySelector(".vc-tooltip")).toBeTruthy()
		// The onMouseLeave handler lives on the OUTER <g> (grandparent of the
		// circle: circle → bubbles <g> → outer <g>). Fire on that element
		// directly rather than relying on event bubbling from an inner group.
		const outerGroup = bubble.parentElement!.parentElement!
		fireEvent.mouseLeave(outerGroup)
		expect(document.querySelector(".vc-tooltip")).toBeNull()
	})
})
