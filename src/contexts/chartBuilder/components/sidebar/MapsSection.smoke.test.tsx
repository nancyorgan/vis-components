import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { setZctaTopologyLoader } from "../../lib/geo/zctaTopology"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { MAP_CONFIG_VERSION } from "../../lib/storage/migrations"
import { emptyEncodings } from "../../lib/types"

import { MapsSection } from "./MapsSection"

/** ZCTA availability needs no stubbing: the shipped source is a served sidecar
 *  file, which vite.config.ts switches off under Vitest, so an unregistered
 *  seam IS an asset-less build and `setZctaTopologyLoader` IS an
 *  asset-bearing one. Both branches of the sidebar note are covered below. */

/** Active-mode-gated toggles need the right encodings to resolve a mode:
 *  - geo-choropleth: connection mapped, NO area → "Fill regions with no data"
 *  - geo-symbols: connection + area mapped → "Show basemap"
 *  Without encodings the active mode is scatter, so neither toggle shows.
 *  Seed encodings through the same raw-localStorage key the viz smoke tests
 *  use (`vis-components:currentEncodings`). */
const seed = (
	coordSystem: "noMap" | "geographic",
	overrides: Partial<typeof DEFAULT_MAP_CONFIG> = {},
	encodings?: Partial<Record<string, { field: string }>>
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	// Wrapped in the current-version envelope so overrides are taken literally
	// — a bare (v0) object would run the migration chain, whose v5→v6 step
	// resets an explicit `showNoDataRegions: false` back to true.
	localStorage.setItem(
		"vis-components:currentMapConfig",
		JSON.stringify({
			_v: MAP_CONFIG_VERSION,
			data: { ...DEFAULT_MAP_CONFIG, coordSystem, ...overrides },
		})
	)
	if (encodings) {
		localStorage.setItem(
			"vis-components:currentEncodings",
			JSON.stringify({ ...emptyEncodings(), ...encodings })
		)
	}
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

/** Seed a lon/lat dataset for the outside-the-projection hint tests. Must run
 *  AFTER `seed(...)` (which resets the in-memory localStorage). Mirrors the
 *  viz smoke tests' dataset seeding (GeoPointPlot.smoke.test.tsx). */
const OUTSIDE_DATASET_ID = "ds-maps-outside"
const seedPointDataset = (rows: Record<string, string>[]) => {
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", {
		[OUTSIDE_DATASET_ID]: buildDatasetFixture({
			id: OUTSIDE_DATASET_ID,
			name: "cities",
			filename: "cities.csv",
			fields: [
				{ name: "city", inferredType: "categorical" },
				{ name: "lon", inferredType: "quantitative" },
				{ name: "lat", inferredType: "quantitative" },
			],
			rows,
		}),
	})
	set("vis-components:currentDatasetId", OUTSIDE_DATASET_ID)
	set("vis-components:previewVersionId", null)
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

/** Encoding shorthands for the two geographic modes. */
const CHOROPLETH_ENC = { connection: { field: "state" } }
const SYMBOLS_ENC = {
	connection: { field: "state" },
	area: { field: "pop" },
}
const X_Y_ENC = {
	x: { field: "lon" },
	y: { field: "lat" },
}

const mount = () =>
	render(
		<TestProvider>
			<MapsSection />
		</TestProvider>
	)

afterEach(cleanup)

describe("MapsSection", () => {
	it("renders the coordinate-system toggle without throwing", () => {
		seed("noMap")
		mount()
		expect(screen.getByRole("radio", { name: /No map/i })).toBeTruthy()
		expect(screen.getByRole("radio", { name: /Geographic/i })).toBeTruthy()
		// The retired Cartesian option must not come back.
		expect(screen.queryByRole("radio", { name: /Cartesian/i })).toBeNull()
	})

	it("defaults to No map (the neutral default), hiding the projection control", () => {
		seed(DEFAULT_MAP_CONFIG.coordSystem)
		mount()
		expect(DEFAULT_MAP_CONFIG.coordSystem).toBe("noMap")
		expect(
			(screen.getByRole("radio", { name: /No map/i }) as HTMLInputElement)
				.getAttribute("aria-checked")
		).toBe("true")
		expect(screen.queryByLabelText(/Projection/i)).toBeNull()
	})

	it("hides the projection control in No-map mode", () => {
		seed("noMap")
		mount()
		expect(screen.queryByLabelText(/Projection/i)).toBeNull()
	})

	it("reveals the projection control in Geographic mode", () => {
		seed("geographic")
		mount()
		expect(screen.getByLabelText(/Projection/i)).toBeTruthy()
	})

	it("reveals the projection control after toggling to Geographic", () => {
		seed("noMap")
		mount()
		expect(screen.queryByLabelText(/Projection/i)).toBeNull()
		fireEvent.click(screen.getByRole("radio", { name: /Geographic/i }))
		expect(screen.getByLabelText(/Projection/i)).toBeTruthy()
	})

	it("notes that world projections are best for country maps when selected", () => {
		seed("geographic")
		mount()
		// Auto (Albers USA) → no world-projection note.
		expect(screen.queryByText(/world projections/i)).toBeNull()
		// Selecting Mercator (a world projection) surfaces the note.
		fireEvent.change(screen.getByLabelText(/Projection/i), {
			target: { value: "mercator" },
		})
		expect(screen.getByText(/world projections/i)).toBeTruthy()
	})

	it("omits the US-tiny note when mapping countries with a world projection", () => {
		// Countries + a world projection (mercator) is the CORRECT pairing —
		// the "US geographies render best with Albers USA" note is misleading.
		seed("geographic", { geographyLevel: "countries", projection: "mercator" })
		mount()
		expect(screen.queryByText(/world projections/i)).toBeNull()
	})

	it("omits the zcta-unavailable note for countries (implemented)", () => {
		seed("geographic", { geographyLevel: "countries" })
		mount()
		expect(screen.queryByText(/isn't available in this build/i)).toBeNull()
	})

	it("shows the country-name hint for countries, not for US states", () => {
		seed("geographic", { geographyLevel: "countries" })
		mount()
		expect(screen.getByText(/ISO codes/i)).toBeTruthy()
		cleanup()
		seed("geographic", { geographyLevel: "states" })
		mount()
		expect(screen.queryByText(/ISO codes/i)).toBeNull()
	})

	it("explains an UNSOURCED zcta level (no topology asset), but not counties", () => {
		// An asset-less build (no sidecar file, no registered loader): the level
		// is real but sourceless → the "isn't available" note.
		seed("geographic", { geographyLevel: "zcta" })
		mount()
		expect(screen.getByText(/isn't available in this build/i)).toBeTruthy()
		// The join hint is reserved for a USABLE zcta level.
		expect(screen.queryByText(/ZCTAs join by 5-digit ZIP code/i)).toBeNull()
		cleanup()
		seed("geographic", { geographyLevel: "counties" })
		mount()
		expect(screen.queryByText(/isn't available in this build/i)).toBeNull()
	})

	it("shows the ZIP join hint (not the unavailable note) once a zcta source exists", () => {
		// Registering a source the way a served build (or a host deployment)
		// does flips the sidebar to the leading-zeros join hint, never the
		// "can't draw" note.
		setZctaTopologyLoader(async () => {
			throw new Error("never loaded by this render-only test")
		})
		try {
			seed("geographic", { geographyLevel: "zcta" })
			mount()
			expect(screen.queryByText(/isn't available in this build/i)).toBeNull()
			expect(screen.getByText(/ZCTAs join by 5-digit ZIP code/i)).toBeTruthy()
		} finally {
			setZctaTopologyLoader(null)
		}
	})

	it("shows the county-name hint for counties, not for US states", () => {
		seed("geographic", { geographyLevel: "counties" })
		mount()
		expect(screen.getByText(/County names repeat across states/i)).toBeTruthy()
		cleanup()
		seed("geographic", { geographyLevel: "states" })
		mount()
		expect(
			screen.queryByText(/County names repeat across states/i)
		).toBeNull()
	})

	it("reveals the fill-regions-with-no-data toggle in choropleth mode, default on", () => {
		// Default ON: regions absent from the dataset paint with the no-data
		// fill unless the user opts out.
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Fill regions with no data/i
		) as HTMLInputElement
		expect(toggle).toBeTruthy()
		expect(toggle.checked).toBe(true)
	})

	it("hides the fill-regions toggle in No-map mode", () => {
		seed("noMap")
		mount()
		expect(screen.queryByLabelText(/Fill regions with no data/i)).toBeNull()
	})

	it("reflects a seeded showNoDataRegions: false as unchecked", () => {
		seed("geographic", { showNoDataRegions: false }, CHOROPLETH_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Fill regions with no data/i
		) as HTMLInputElement
		expect(toggle.checked).toBe(false)
	})

	it("flips showNoDataRegions off when the toggle is clicked", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Fill regions with no data/i
		) as HTMLInputElement
		expect(toggle.checked).toBe(true)
		fireEvent.click(toggle)
		expect(toggle.checked).toBe(false)
	})

	it("no-data pattern chips: None selected by default; ink input hidden until a pattern is picked", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		// The chip row renders wherever the no-data fill color does.
		const none = screen.getByRole("button", { name: "None" })
		expect(none.getAttribute("aria-pressed")).toBe("true")
		// Ink color is inert without a pattern → hidden.
		expect(screen.queryByLabelText("Pattern ink")).toBeNull()
		// Picking a pattern selects its chip and reveals the ink input.
		const chip = screen.getByRole("button", {
			name: /No-data pattern option 2/i,
		})
		fireEvent.click(chip)
		expect(chip.getAttribute("aria-pressed")).toBe("true")
		expect(none.getAttribute("aria-pressed")).toBe("false")
		expect(screen.getByLabelText("Pattern ink")).toBeTruthy()
	})

	it("reflects a seeded noDataPattern as the selected chip", () => {
		seed("geographic", { noDataPattern: 0 }, CHOROPLETH_ENC)
		mount()
		expect(
			screen
				.getByRole("button", { name: /No-data pattern option 1/i })
				.getAttribute("aria-pressed")
		).toBe("true")
	})

	it("hides the no-data pattern chips in No-map mode (no no-data fill painted)", () => {
		seed("noMap")
		mount()
		expect(screen.queryByRole("button", { name: "None" })).toBeNull()
	})

	// --- Contextual gating: each toggle shows only in its own mode. ---

	it("reveals the show-basemap toggle in symbols (bubble-map) mode, default on", () => {
		seed("geographic", {}, SYMBOLS_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Show basemap/i
		) as HTMLInputElement
		expect(toggle).toBeTruthy()
		expect(toggle.checked).toBe(true)
	})

	it("reflects a seeded showBasemap: false as unchecked", () => {
		seed("geographic", { showBasemap: false }, SYMBOLS_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Show basemap/i
		) as HTMLInputElement
		expect(toggle.checked).toBe(false)
	})

	it("flips showBasemap off when the toggle is clicked", () => {
		seed("geographic", {}, SYMBOLS_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Show basemap/i
		) as HTMLInputElement
		expect(toggle.checked).toBe(true)
		fireEvent.click(toggle)
		expect(toggle.checked).toBe(false)
	})

	it("hides the show-basemap toggle in choropleth mode", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		expect(screen.queryByLabelText(/Show basemap/i)).toBeNull()
	})

	it("hides the fill-regions toggle in symbols (bubble-map) mode", () => {
		seed("geographic", {}, SYMBOLS_ENC)
		mount()
		expect(screen.queryByLabelText(/Fill regions with no data/i)).toBeNull()
	})

	// --- No-data fill COLOR follows the pixels: it's reachable in choropleth
	// mode AND in a bubble map whose basemap is on (GeoSymbolPlot paints the
	// basemap with noDataFill), but NOT when the bubble-map basemap is off. ---

	it("shows the no-data-fill color in symbols mode when the basemap is on (default)", () => {
		seed("geographic", {}, SYMBOLS_ENC)
		mount()
		// The toggle is choropleth-only and must stay hidden here…
		expect(screen.queryByLabelText(/Fill regions with no data/i)).toBeNull()
		// …but the color control IS present (the basemap renders noDataFill).
		expect(screen.getByLabelText("No-data fill")).toBeTruthy()
	})

	it("hides the no-data-fill color in symbols mode when the basemap is off", () => {
		seed("geographic", { showBasemap: false }, SYMBOLS_ENC)
		mount()
		expect(screen.queryByLabelText("No-data fill")).toBeNull()
	})

	it("shows the no-data-fill color in choropleth mode", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		expect(screen.getByLabelText("No-data fill")).toBeTruthy()
	})

	// --- Point map (geo-points): X = longitude, Y = latitude. The lon/lat hint
	// explains the axis meaning; the Show basemap toggle is shared with symbols. ---

	it("shows the lon/lat hint and the show-basemap toggle in point-map mode", () => {
		seed("geographic", {}, X_Y_ENC)
		mount()
		expect(screen.getByText(/X = longitude and Y = latitude/i)).toBeTruthy()
		expect(screen.getByLabelText(/Show basemap/i)).toBeTruthy()
	})

	it("omits the lon/lat hint in choropleth mode", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		expect(screen.queryByText(/X = longitude and Y = latitude/i)).toBeNull()
	})

	// --- Outside-the-projection hint: albersUsa returns null for points
	// outside the US, so they silently vanish from the dot map. The hint says
	// so, with counts, and names the fix. Rendered only when a mark dropped. ---

	it("warns when points fall outside the mapped area (albersUsa drops them)", () => {
		// Explicit states level: no async auto-detection, so the count (and
		// the resolved albersUsa projection) is available synchronously.
		seed("geographic", { geographyLevel: "states" }, X_Y_ENC)
		seedPointDataset([
			{ city: "NYC", lon: "-74", lat: "40.7" },
			{ city: "LA", lon: "-118", lat: "34" },
			{ city: "Tokyo", lon: "139.7", lat: "35.7" },
		])
		mount()
		expect(
			screen.getByText(/1 of 3 points falls outside the mapped area/i)
		).toBeTruthy()
		// The fix is named: albersUsa is the projection doing the clipping.
		expect(screen.getByText(/Albers USA covers only the US/i)).toBeTruthy()
	})

	it("hides the outside-points hint when every point projects (inert control)", () => {
		seed("geographic", { geographyLevel: "states" }, X_Y_ENC)
		seedPointDataset([
			{ city: "NYC", lon: "-74", lat: "40.7" },
			{ city: "LA", lon: "-118", lat: "34" },
		])
		mount()
		expect(screen.queryByText(/outside the mapped area/i)).toBeNull()
	})

	it("hides the outside-points hint under a world projection (nothing drops)", () => {
		seed(
			"geographic",
			{ geographyLevel: "states", projection: "naturalEarth" },
			X_Y_ENC
		)
		seedPointDataset([
			{ city: "NYC", lon: "-74", lat: "40.7" },
			{ city: "Tokyo", lon: "139.7", lat: "35.7" },
		])
		mount()
		expect(screen.queryByText(/outside the mapped area/i)).toBeNull()
	})
})
