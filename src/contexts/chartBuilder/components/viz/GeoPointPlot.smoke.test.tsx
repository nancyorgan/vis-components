import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach } from "vitest"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
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

const buildDataset = (rows: Record<string, string>[] = US_CITIES): Dataset => ({
	id: DATASET_ID,
	name: "cities",
	fields: [
		{ name: "city", inferredType: "categorical" },
		{ name: "lon", inferredType: "quantitative" },
		{ name: "lat", inferredType: "quantitative" },
		{ name: "pop", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "cities.csv",
			rows,
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const installInMemoryLocalStorage = (): Map<string, string> => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? store.get(k)! : null),
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	Object.defineProperty(window, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	return store
}

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
