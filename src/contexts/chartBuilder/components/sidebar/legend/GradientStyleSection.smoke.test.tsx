import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import { currentLegendConfigAtom } from "../../../store/atoms"

import { LegendPanel } from "../LegendPanel"

const DATASET_ID = "ds-legend-gradient"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "Tier", inferredType: "categorical" },
			{ name: "Score", inferredType: "quantitative" },
		],
		rows: [
			{ Tier: "A", Score: "0" },
			{ Tier: "B", Score: "7" },
			{ Tier: "C", Score: "14" },
		],
	})

afterEach(cleanup)

/** Mounts the whole panel (the subsections share one model) with the given
 *  channels mapped, and opens the subsection under test. */
const mount = (
	mapped: Partial<Encodings>,
	open: string | null,
	legend: Partial<LegendConfig> = {}
) => {
	const store = installInMemoryLocalStorage()
	const encodings = { ...emptyEncodings(), ...mapped }
	const legendCfg: LegendConfig = { ...DEFAULT_LEGEND_CONFIG, ...legend }
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentLegend", JSON.stringify(legendCfg))
	/* eslint-enable @vc/use-wrapped-json-functions */
	let snap: TestStore | null = null
	const init = (s: TestStore) => {
		snap = s
		s.set(currentLegendConfigAtom, legendCfg)
	}
	const utils = render(
		<TestProvider initializeState={init}>
			<LegendPanel />
		</TestProvider>
	)
	const openSection = (title: string) => fireEvent.click(utils.getByText(title))
	if (open) openSection(open)
	const cfg = () => (snap as TestStore | null)?.get(currentLegendConfigAtom)
	const input = (label: string) => utils.getByLabelText(label) as HTMLInputElement
	/** The "reset" link in the nearest row around `el`. */
	const resetBeside = (el: HTMLElement): HTMLElement => {
		for (let node = el.parentElement; node; node = node.parentElement) {
			const reset = within(node).queryByText("reset")
			if (reset) return reset
		}
		throw new Error("no reset link beside the control")
	}
	return { ...utils, cfg, input, openSection, resetBeside }
}

describe("LegendPanel — Gradient legend style", () => {
	it("is offered for a quantitative Color legend only", () => {
		const categorical = mount({ hue: { field: "Tier" } }, null)
		expect(categorical.queryByText("Gradient legend style")).toBeNull()
		cleanup()
		const quant = mount({ hue: { field: "Score" } }, null)
		expect(quant.queryByText("Gradient legend style")).toBeTruthy()
	})

	it("bar settings are sparse against the theme: the theme's own value clears the entry", () => {
		const { input, cfg, resetBeside } = mount({ hue: { field: "Score" } }, "Gradient legend style")
		const themeThickness = input("Bar thickness").value
		fireEvent.change(input("Bar thickness"), { target: { value: "31" } })
		expect(cfg()?.gradientBarThickness).toBe(31)
		fireEvent.change(input("Bar thickness"), { target: { value: themeThickness } })
		expect(cfg()?.gradientBarThickness).toBeNull()
		fireEvent.change(input("Corner radius"), { target: { value: "7" } })
		expect(cfg()?.gradientBarRadius).toBe(7)
		fireEvent.click(resetBeside(input("Corner radius")))
		expect(cfg()?.gradientBarRadius).toBeNull()
	})

	it("Bar length is blank on auto, stores a typed length and clears back", () => {
		const { input, cfg } = mount({ hue: { field: "Score" } }, "Gradient legend style")
		expect(input("Bar length").value).toBe("")
		fireEvent.change(input("Bar length"), { target: { value: "200" } })
		expect(cfg()?.gradientBarLength).toBe(200)
		fireEvent.change(input("Bar length"), { target: { value: "" } })
		expect(cfg()?.gradientBarLength).toBeNull()
	})

	it("the border and tick colors only show once there is a border / tick to color", () => {
		const { input, queryByText, cfg } = mount(
			{ hue: { field: "Score" } },
			"Gradient legend style",
			{ gradientBarBorderWidth: 0, gradientBarTickLength: 0 }
		)
		expect(queryByText("Border color")).toBeNull()
		expect(queryByText("Tick color")).toBeNull()
		fireEvent.change(input("Border thickness"), { target: { value: "2" } })
		expect(cfg()?.gradientBarBorderWidth).toBe(2)
		expect(queryByText("Border color")).toBeTruthy()
		fireEvent.change(input("Tick length"), { target: { value: "4" } })
		expect(cfg()?.gradientBarTickLength).toBe(4)
		expect(queryByText("Tick color")).toBeTruthy()
		expect(input("Tick thickness")).toBeTruthy()
	})

	it("switching to swatches drops the bar settings and adds the Color swatch subsection", () => {
		const { getByLabelText, queryByLabelText, queryByText, cfg } = mount(
			{ hue: { field: "Score" } },
			"Gradient legend style"
		)
		expect(queryByText("Color swatch")).toBeNull()
		fireEvent.click(getByLabelText("Show swatches"))
		expect(cfg()?.gradientLegendStyle).toBe("swatches")
		expect(queryByLabelText("Bar thickness")).toBeNull()
		expect(queryByText("Color swatch")).toBeTruthy()
	})

	it("a lone Opacity ramp gets its own bar / swatches choice and the shared Bar color", () => {
		const { getAllByLabelText, queryByText, cfg } = mount(
			{ opacity: { field: "Score" } },
			"Gradient legend style"
		)
		const swatches = getAllByLabelText("Show swatches")
		const bars = getAllByLabelText("Show gradient bar")
		expect(swatches).toHaveLength(1)
		// Whichever style is current, picking the other stores it and picking
		// the historical one back clears the entry (sparse).
		const wasBar = (bars[0] as HTMLInputElement).checked
		fireEvent.click(wasBar ? swatches[0] : bars[0])
		expect(cfg()?.gradientLegendStyles?.opacity).toBe(wasBar ? "swatches" : "bar")
		fireEvent.click(wasBar ? bars[0] : swatches[0])
		expect(cfg()?.gradientLegendStyles?.opacity).toBeUndefined()
		expect(!!queryByText("Bar color")).toBe(wasBar)
	})
})
