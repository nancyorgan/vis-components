import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CUSTOM_PATTERN_BASE } from "../../lib/customPatternSlots"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from "../../lib/systemThemes"
import {
	currentChannelConfigsAtom,
	currentMapConfigAtom,
	currentThemeIdAtom,
	themesAtom,
} from "../../store/atoms"
import {
	CHANNEL_CONFIGS_VERSION,
	MAP_CONFIG_VERSION,
} from "../../lib/storage/migrations"
import { emptyEncodings } from "../../lib/types"

import { MapsSection } from "./MapsSection"

/** The "+" upload reads the file through `fileToCustomPattern` (FileReader,
 *  an <img>, a canvas — none of which happy-dom draws); stand in for it so
 *  the no-data row's upload flow can run end to end. */
const UPLOADED = vi.hoisted(() => ({
	svg: "data:image/svg+xml,%3Csvg%20id%3D%22uploaded%22%2F%3E",
}))
vi.mock("../../lib/customPatterns", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/customPatterns")>()),
	fileToCustomPattern: vi.fn(() => Promise.resolve(UPLOADED)),
}))

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
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
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
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
}

/** Seed a lon/lat dataset for the outside-the-projection hint tests. Must run
 *  AFTER `seed(...)` (which resets the in-memory localStorage). Mirrors the
 *  viz smoke tests' dataset seeding (GeoPointPlot.smoke.test.tsx). */
const OUTSIDE_DATASET_ID = "ds-maps-outside"
const seedPointDataset = (rows: Record<string, string>[]) => {
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
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
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
}

/** Encoding shorthands for the two geographic modes. */
const CHOROPLETH_ENC = { connection: { field: "state" } }
/** Choropleth with a hue measure: a blank cell is then "missing data". */
const CHOROPLETH_HUE_ENC = {
	connection: { field: "state" },
	hue: { field: "rate" },
}
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

	it("shows the country-name hint for countries, not for US states", () => {
		seed("geographic", { geographyLevel: "countries" })
		mount()
		expect(screen.getByText(/ISO codes/i)).toBeTruthy()
		cleanup()
		seed("geographic", { geographyLevel: "states" })
		mount()
		expect(screen.queryByText(/ISO codes/i)).toBeNull()
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

	// --- No-data reset links return to the THEME's defaults, not the built-in
	// gray (System Dark ships its own no-data fill + ink). ---

	const mountWithTheme = (themeId: string) => {
		let store: TestStore | null = null
		render(
			<TestProvider
				initializeState={(s) => {
					s.set(themesAtom, [SYSTEM_LIGHT_THEME, SYSTEM_DARK_THEME])
					s.set(currentThemeIdAtom, themeId)
					store = s
				}}
			>
				<MapsSection />
			</TestProvider>
		)
		return store as unknown as TestStore
	}

	it("no-data resets compare against and restore the current theme's colors", () => {
		const darkFill = SYSTEM_DARK_THEME.mapNoDataFill!
		const darkInk = SYSTEM_DARK_THEME.mapNoDataPatternInk!
		// The built-in colors under System Dark read as an edit.
		seed("geographic", { noDataPattern: 0 }, CHOROPLETH_ENC)
		const store = mountWithTheme(SYSTEM_DARK_THEME.id)
		fireEvent.click(screen.getByRole("button", { name: "Reset no-data fill" }))
		fireEvent.click(screen.getByRole("button", { name: "Reset pattern ink" }))
		expect(store.get(currentMapConfigAtom).noDataFill).toBe(darkFill)
		expect(store.get(currentMapConfigAtom).noDataPatternInk).toBe(darkInk)
		expect(screen.queryByRole("button", { name: "Reset no-data fill" })).toBeNull()
		expect(screen.queryByRole("button", { name: "Reset pattern ink" })).toBeNull()
	})

	it("shows no no-data reset when the colors match the theme's", () => {
		seed(
			"geographic",
			{
				noDataPattern: 0,
				noDataFill: SYSTEM_DARK_THEME.mapNoDataFill!,
				noDataPatternInk: SYSTEM_DARK_THEME.mapNoDataPatternInk!,
			},
			CHOROPLETH_ENC
		)
		mountWithTheme(SYSTEM_DARK_THEME.id)
		expect(screen.queryByRole("button", { name: "Reset no-data fill" })).toBeNull()
		expect(screen.queryByRole("button", { name: "Reset pattern ink" })).toBeNull()
	})

	it("shows the no-data-fill color in choropleth mode", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		expect(screen.getByLabelText("No-data fill")).toBeTruthy()
	})

	// --- Point map (geo-points): the Show basemap toggle is shared with
	// symbols. ---

	it("shows the show-basemap toggle in point-map mode", () => {
		seed("geographic", {}, X_Y_ENC)
		mount()
		expect(screen.getByLabelText(/Show basemap/i)).toBeTruthy()
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

/** The chart's custom patterns, seeded through the channel configs the
 *  Pattern menu stores them in. Must run AFTER `seed(...)`. */
const SAVED = { svg: "data:image/svg+xml,%3Csvg%20id%3D%22saved%22%2F%3E" }
const seedCustomPatterns = (customPatterns: unknown[]) => {
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	localStorage.setItem(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			_v: CHANNEL_CONFIGS_VERSION,
			data: { pattern: { customPatterns } },
		})
	)
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
}

const mountWithStore = () => {
	let store: TestStore | null = null
	render(
		<TestProvider
			initializeState={(s) => {
				store = s
			}}
		>
			<MapsSection />
		</TestProvider>
	)
	return store as unknown as TestStore
}

describe("MapsSection — no-data pattern row", () => {
	it("starts the chips on the label's line, in the control column", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		mount()
		// The chips are one group named by the label beside them…
		const chips = screen.getByRole("group", { name: "No-data pattern" })
		const row = chips.parentElement as HTMLElement
		expect(row.firstElementChild?.textContent).toBe("No-data pattern")
		expect(row.lastElementChild).toBe(chips)
		// …None, the built-ins and the "+" all on one wrapping line, so a
		// wrapped chip starts under the first one, not under the label.
		const line = within(chips).getByRole("button", { name: "None" }).parentElement
		expect(line?.className).toContain("flex-wrap")
		expect(
			within(line as HTMLElement).getByRole("button", { name: /No-data pattern option 1/ })
		).toBeTruthy()
		expect(
			within(line as HTMLElement).getByRole("button", { name: "Add custom pattern" })
		).toBeTruthy()
	})

	it("offers the chart's custom patterns and picks one", () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		seedCustomPatterns([SAVED])
		const store = mountWithStore()
		const chip = screen.getByRole("button", {
			name: "No-data pattern option custom 1",
		})
		expect(chip.getAttribute("aria-pressed")).toBe("false")
		fireEvent.click(chip)
		expect(store.get(currentMapConfigAtom).noDataPattern).toBe(CUSTOM_PATTERN_BASE)
		expect(chip.getAttribute("aria-pressed")).toBe("true")
		// A custom pick is a pattern like any other: its ink follows.
		expect(screen.getByLabelText("Pattern ink")).toBeTruthy()
	})

	it('"+" uploads a pattern into the chart\'s list and picks it for no data', async () => {
		seed("geographic", {}, CHOROPLETH_ENC)
		const store = mountWithStore()
		fireEvent.click(screen.getByRole("button", { name: "Add custom pattern" }))
		// The Pattern menu's upload editor, minus its pointer to a Scale box
		// the no-data row doesn't have.
		const editor = screen.getByText("upload image")
		expect(document.body.textContent).toContain("black-and-white SVG, PNG or JPEG")
		expect(document.body.textContent).not.toContain("Use Scale")
		const input = editor.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, {
			target: { files: [new File(["<svg/>"], "tile.svg", { type: "image/svg+xml" })] },
		})
		await waitFor(() =>
			expect(store.get(currentMapConfigAtom).noDataPattern).toBe(CUSTOM_PATTERN_BASE)
		)
		// Stored where every pattern picker reads it, and the editor closed.
		expect(store.get(currentChannelConfigsAtom).pattern?.customPatterns).toEqual([UPLOADED])
		expect(screen.queryByText("upload image")).toBeNull()
		expect(
			screen
				.getByRole("button", { name: "No-data pattern option custom 1" })
				.getAttribute("aria-pressed")
		).toBe("true")
	})

	it("deleting the picked custom pattern puts the no-data pattern back to None", () => {
		seed("geographic", { noDataPattern: CUSTOM_PATTERN_BASE }, CHOROPLETH_ENC)
		seedCustomPatterns([SAVED])
		const store = mountWithStore()
		fireEvent.click(screen.getByRole("button", { name: "Delete custom pattern 1" }))
		expect(store.get(currentMapConfigAtom).noDataPattern).toBeNull()
		expect(store.get(currentChannelConfigsAtom).pattern?.customPatterns).toEqual([null])
		expect(
			screen.getByRole("button", { name: "None" }).getAttribute("aria-pressed")
		).toBe("true")
	})
})

/** Seed a state-keyed dataset for the Custom-seeding tests. Must run AFTER
 *  `seed(...)` (which resets the in-memory localStorage). */
const STATE_DATASET_ID = "ds-maps-states"
const seedStateDataset = (rows: Record<string, string>[]) => {
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", {
		[STATE_DATASET_ID]: buildDatasetFixture({
			id: STATE_DATASET_ID,
			name: "rates",
			filename: "rates.csv",
			fields: [
				{ name: "state", inferredType: "categorical" },
				{ name: "rate", inferredType: "quantitative" },
			],
			rows,
		}),
	})
	set("vis-components:currentDatasetId", STATE_DATASET_ID)
	set("vis-components:previewVersionId", null)
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
}

/** The persisted `customViewport`, read back through the versioned envelope
 *  the map-config atom writes (bare object tolerated). */
const storedCustomViewport = (): Record<string, number> | null => {
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try */
	const raw = localStorage.getItem("vis-components:currentMapConfig")
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try */
	if (!raw) return null
	const parsed = JSON.parse(raw) as {
		data?: { customViewport?: Record<string, number> | null }
		customViewport?: Record<string, number> | null
	}
	return parsed.data?.customViewport ?? parsed.customViewport ?? null
}

describe("MapsSection — Custom focus seeding", () => {
	it("seeds Custom from the data frame when auto frames only the data regions", async () => {
		// Choropleth, "Fill regions with no data" off, Washington-only data: auto
		// frames just Washington, so switching to Custom must start THERE — not
		// jump back to the continental-US default.
		seed("geographic", { showNoDataRegions: false }, CHOROPLETH_HUE_ENC)
		// With a hue measure mapped, the blank-value CA row joins but paints as
		// no-data, so it is neither drawn nor framed — the seed must follow
		// Washington alone.
		seedStateDataset([
			{ state: "WA", rate: "1" },
			{ state: "CA", rate: "" },
		])
		mount()
		// Geometry + join resolve async; the note under Focus appears once auto
		// is framing the data regions.
		await screen.findByText(/Framing just the regions with data/i)
		fireEvent.change(screen.getByLabelText("Focus"), {
			target: { value: "custom" },
		})
		await waitFor(() => {
			const vp = storedCustomViewport()
			expect(vp).not.toBeNull()
			// Brackets Washington (−124.8…−116.9 lon, 45.5…49 lat) with the 1°
			// floor margin — nowhere near the CONUS default (−128…−66, 23…50).
			expect(vp!.west).toBeGreaterThan(-127)
			expect(vp!.west).toBeLessThan(-124.8)
			expect(vp!.east).toBeGreaterThan(-116.9)
			expect(vp!.east).toBeLessThan(-114)
			expect(vp!.south).toBeGreaterThan(43)
			expect(vp!.south).toBeLessThan(45.5)
			expect(vp!.north).toBeGreaterThan(49)
			expect(vp!.north).toBeLessThan(52)
		})
	})

	it("seeds Custom from the level default while every region draws", async () => {
		// Same data, toggle ON: auto frames the whole US, so Custom starts from
		// the continental-US default exactly as before, and no framing note.
		seed("geographic", { showNoDataRegions: true }, CHOROPLETH_ENC)
		seedStateDataset([{ state: "WA", rate: "1" }])
		mount()
		await screen.findByText(/1 of 1 matched/i)
		expect(
			screen.queryByText(/Framing just the regions with data/i)
		).toBeNull()
		fireEvent.change(screen.getByLabelText("Focus"), {
			target: { value: "custom" },
		})
		await waitFor(() => {
			expect(storedCustomViewport()).toEqual({
				west: -128,
				south: 23,
				east: -66,
				north: 50,
			})
		})
	})
})
