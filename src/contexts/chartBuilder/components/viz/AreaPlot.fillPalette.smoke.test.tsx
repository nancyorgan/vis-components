import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { LIGHT_THEME_BASE } from "../../lib/systemThemes"
import { emptyEncodings, type Dataset, type Encodings, type Theme } from "../../lib/types"
import { themeAtom } from "../../store/atoms"

import { ChartCanvas } from "./ChartCanvas"

/** An area chart with nothing on Color, in a theme that has a fill palette:
 *  left on the theme's color, the body takes the fill palette's pale twin
 *  and the line and points keep the series color — the look areas colored
 *  by a variable already have. It used to draw body, line and points in the
 *  one color. */

const ID = "ds-area-fill-palette"
const SERIES = "#1f77b4"
const TWIN = "#c6dbef"

const FILL_THEME: Theme = {
	...LIGHT_THEME_BASE,
	categoricalPalettes: [
		{ id: "marks", name: "Marks", colors: [SERIES, "#ff7f0e"] },
		{ id: "tints", name: "Tints", colors: [TWIN, "#ffd8b1"] },
	],
	defaultCategoricalPaletteId: "marks",
	defaultFillPaletteId: "tints",
	defaultFill: SERIES,
}

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "areas",
		filename: "areas.csv",
		fields: [
			{ name: "month", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: [
			{ month: "Jan", sales: "10", region: "north" },
			{ month: "Feb", sales: "20", region: "north" },
			{ month: "Mar", sales: "15", region: "north" },
		],
	})

const AREA: Partial<Encodings> = {
	x: { field: "month" },
	length: { field: "sales" },
	connection: { field: "region" },
}

const mount = ({
	theme = FILL_THEME,
	configs = {},
	encodings = {},
}: {
	theme?: Theme
	configs?: Record<string, unknown>
	encodings?: Partial<Encodings>
} = {}) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", { ...emptyEncodings(), ...AREA, ...encodings })
	set("vis-components:currentChannelConfigs", {
		// A new chart's fill is seeded from the theme.
		defaultFill: theme.defaultFill,
		connection: { fill: "area" },
		...configs,
	})
	set("vis-components:currentLabels", {
		_v: 1,
		data: { ...DEFAULT_LABELS_CONFIG, xAxisTitle: "", yAxisTitle: "" },
	})
	/* eslint-enable @vc/use-wrapped-json-functions */
	return render(
		// `currentThemeIdAtom` defaults null, so the chart reads `themeAtom`.
		<TestProvider initializeState={(snap: TestStore) => snap.set(themeAtom, theme)}>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	).container
}

const attrs = (els: Element[], name: string): Array<string | null> =>
	els.map((el) => el.getAttribute(name))
/** The area's body: the closed fill path (no stroke of its own). */
const bodies = (c: HTMLElement): Element[] =>
	[...c.querySelectorAll('svg path[stroke="none"]')].filter(
		(el) => (el.getAttribute("fill") ?? "none") !== "none"
	)
/** The area's Line: its top edge. */
const lines = (c: HTMLElement): Element[] => [
	...c.querySelectorAll('svg path[fill="none"][stroke-linejoin="round"]'),
]
const points = (c: HTMLElement): Element[] => [...c.querySelectorAll("[data-area-point]")]

describe("a lone area in a theme with a fill palette", () => {
	it("draws a pale body under a line and points in the series color", () => {
		const c = mount()
		expect(attrs(bodies(c), "fill")).toEqual([TWIN])
		expect(attrs(lines(c), "stroke")).toEqual([SERIES])
		expect(new Set(attrs(points(c), "fill"))).toEqual(new Set([SERIES]))
	})

	it("the same when the chart never stored a fill of its own", () => {
		const c = mount({ configs: { defaultFill: undefined } })
		expect(attrs(bodies(c), "fill")).toEqual([TWIN])
		expect(attrs(lines(c), "stroke")).toEqual([SERIES])
	})

	it("a fill the user picked is drawn as picked, body and line", () => {
		const c = mount({ configs: { defaultFill: "#aa0000" } })
		expect(attrs(bodies(c), "fill")).toEqual(["#aa0000"])
		expect(attrs(lines(c), "stroke")).toEqual(["#aa0000"])
	})

	it("a Line color the user picked stays, over the pale body", () => {
		const c = mount({ configs: { connection: { fill: "area", strokeColor: "#222222" } } })
		expect(attrs(bodies(c), "fill")).toEqual([TWIN])
		expect(attrs(lines(c), "stroke")).toEqual(["#222222"])
	})

	it("an area drawn as lines keeps the series color", () => {
		const c = mount({ configs: { connection: { fill: "line" } } })
		expect(bodies(c)).toEqual([])
		expect(attrs(lines(c), "stroke")).toEqual([SERIES])
	})
})

describe("a lone area in a theme with no fill palette", () => {
	it("draws body and line in the one color, as before", () => {
		const c = mount({ theme: { ...FILL_THEME, defaultFillPaletteId: null } })
		expect(attrs(bodies(c), "fill")).toEqual([SERIES])
		expect(attrs(lines(c), "stroke")).toEqual([SERIES])
	})
})
