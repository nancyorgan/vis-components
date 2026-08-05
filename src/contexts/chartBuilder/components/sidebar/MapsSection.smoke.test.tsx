import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { emptyEncodings } from "../../lib/types"

import { MapsSection } from "./MapsSection"

/** The Maps section is the user-facing control surface for geographic charts.
 *  Its master switch is the Coordinate system toggle; the projection / level /
 *  key / match-status / no-data controls only appear once the system is
 *  Geographic.
 *
 *  Seeding goes through localStorage (not `initializeState`) because the
 *  atoms' persist effects re-read storage on first `get`, clobbering any
 *  `initializeState` value — mirror the other `*.smoke.test.tsx` here. */

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

/** Active-mode-gated toggles need the right encodings to resolve a mode:
 *  - geo-choropleth: connection mapped, NO area → "Fill regions with no data"
 *  - geo-symbols: connection + area mapped → "Show basemap"
 *  Without encodings the active mode is scatter, so neither toggle shows.
 *  Seed encodings through the same raw-localStorage key the viz smoke tests
 *  use (`vis-components:currentEncodings`). */
const seed = (
	coordSystem: "noMap" | "cartesian" | "geographic",
	overrides: Partial<typeof DEFAULT_MAP_CONFIG> = {},
	encodings?: Partial<Record<string, { field: string }>>
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	localStorage.setItem(
		"vis-components:currentMapConfig",
		JSON.stringify({ ...DEFAULT_MAP_CONFIG, coordSystem, ...overrides })
	)
	if (encodings) {
		localStorage.setItem(
			"vis-components:currentEncodings",
			JSON.stringify({ ...emptyEncodings(), ...encodings })
		)
	}
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
		seed("cartesian")
		mount()
		expect(screen.getByRole("radio", { name: /No map/i })).toBeTruthy()
		expect(screen.getByRole("radio", { name: /Cartesian/i })).toBeTruthy()
		expect(screen.getByRole("radio", { name: /Geographic/i })).toBeTruthy()
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

	it("hides the projection control in Cartesian mode", () => {
		seed("cartesian")
		mount()
		expect(screen.queryByLabelText(/Projection/i)).toBeNull()
	})

	it("reveals the projection control in Geographic mode", () => {
		seed("geographic")
		mount()
		expect(screen.getByLabelText(/Projection/i)).toBeTruthy()
	})

	it("reveals the projection control after toggling to Geographic", () => {
		seed("cartesian")
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

	it("omits the coming-soon note for countries (implemented)", () => {
		seed("geographic", { geographyLevel: "countries" })
		mount()
		expect(screen.queryByText(/isn't available yet/i)).toBeNull()
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

	it("still shows the coming-soon note for zcta, but not counties (implemented)", () => {
		seed("geographic", { geographyLevel: "zcta" })
		mount()
		expect(screen.getByText(/isn't available yet/i)).toBeTruthy()
		cleanup()
		seed("geographic", { geographyLevel: "counties" })
		mount()
		expect(screen.queryByText(/isn't available yet/i)).toBeNull()
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

	it("reveals the fill-regions-with-no-data toggle in choropleth mode, default off", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Fill regions with no data/i
		) as HTMLInputElement
		expect(toggle).toBeTruthy()
		expect(toggle.checked).toBe(false)
	})

	it("hides the fill-regions toggle in Cartesian mode", () => {
		seed("cartesian")
		mount()
		expect(screen.queryByLabelText(/Fill regions with no data/i)).toBeNull()
	})

	it("reflects a seeded showNoDataRegions: true as checked", () => {
		seed("geographic", { showNoDataRegions: true }, CHOROPLETH_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Fill regions with no data/i
		) as HTMLInputElement
		expect(toggle.checked).toBe(true)
	})

	it("flips showNoDataRegions on when the toggle is clicked", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		const toggle = screen.getByLabelText(
			/Fill regions with no data/i
		) as HTMLInputElement
		expect(toggle.checked).toBe(false)
		fireEvent.click(toggle)
		expect(toggle.checked).toBe(true)
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
		expect(screen.getByLabelText(/No-data fill/i)).toBeTruthy()
	})

	it("hides the no-data-fill color in symbols mode when the basemap is off", () => {
		seed("geographic", { showBasemap: false }, SYMBOLS_ENC)
		mount()
		expect(screen.queryByLabelText(/No-data fill/i)).toBeNull()
	})

	it("shows the no-data-fill color in choropleth mode", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		expect(screen.getByLabelText(/No-data fill/i)).toBeTruthy()
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
})
