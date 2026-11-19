import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import { currentLegendConfigAtom } from "../../../store/atoms"

import { LegendPanel } from "../LegendPanel"

const DATASET_ID = "ds-legend-swatches"

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

describe("LegendPanel — swatch subsections", () => {
	it("a categorical Color legend gets a Color swatch subsection; size is sparse against the theme", () => {
		const { input, cfg, resetBeside } = mount({ hue: { field: "Tier" } }, "Color swatch")
		const themeSize = Number(input("Swatch size").value)
		fireEvent.change(input("Swatch size"), { target: { value: String(themeSize + 4) } })
		expect(cfg()?.swatchSizes?.hue).toBe(themeSize + 4)
		fireEvent.click(resetBeside(input("Swatch size")))
		expect(cfg()?.swatchSizes?.hue).toBeUndefined()
	})

	it("Outline thickness on a Color swatch stores per section and resets", () => {
		const { input, resetBeside } = mount({ hue: { field: "Tier" } }, "Color swatch")
		const auto = input("Outline thickness").value
		fireEvent.change(input("Outline thickness"), { target: { value: "3" } })
		expect(input("Outline thickness").value).toBe("3")
		fireEvent.click(resetBeside(input("Outline thickness")))
		expect(input("Outline thickness").value).toBe(auto)
	})

	it("channels sharing a variable fold into one subsection named for both", () => {
		const { queryByText } = mount(
			{ hue: { field: "Tier" }, pattern: { field: "Tier" } },
			null
		)
		expect(queryByText("Color · Pattern swatch")).toBeTruthy()
		expect(queryByText("Pattern swatch")).toBeNull()
	})

	it("a standalone Pattern legend offers the tile Background and Pattern color, each resettable", () => {
		const { getByText, cfg, getAllByText, resetBeside } = mount(
			{ pattern: { field: "Tier" } },
			"Pattern swatch",
			{ patternLegendBgColor: "#123456", patternLegendInkColor: "#654321" }
		)
		expect(getByText("Background")).toBeTruthy()
		expect(getByText("Pattern color")).toBeTruthy()
		fireEvent.click(resetBeside(getByText("Background")))
		expect(cfg()?.patternLegendBgColor).toBeNull()
		expect(cfg()?.patternLegendInkColor).toBe("#654321")
		fireEvent.click(resetBeside(getByText("Pattern color")))
		expect(cfg()?.patternLegendInkColor).toBeNull()
		expect(getAllByText("Background")).toHaveLength(1)
	})

	it("a quantitative Size legend gets a Size swatch subsection with its outline and break rows", () => {
		const { input, getByText, cfg, resetBeside } = mount(
			{ area: { field: "Score" } },
			"Size swatch",
			// Size starts hidden in some chart modes; show it explicitly.
			{ hidden: { area: false } }
		)
		expect(getByText("Swatch shape")).toBeTruthy()
		fireEvent.change(input("Outline thickness"), { target: { value: "2" } })
		expect(cfg()?.auxLegendSwatchStrokeWidth).toBe(2)
		fireEvent.click(resetBeside(input("Outline thickness")))
		expect(cfg()?.auxLegendSwatchStrokeWidth).toBeNull()
		// The Size legend draws at least 3 stops; its breaks live here, not
		// under Label format.
		expect(Number(input("Swatches").value)).toBeGreaterThanOrEqual(3)
		fireEvent.change(input("Swatches"), { target: { value: "5" } })
		expect(cfg()?.channels?.area?.breaks).toHaveLength(5)
	})

	it("Length alone is a line swatch: a color, but no shape or outline rows", () => {
		const { getByText, queryByText, queryByLabelText } = mount(
			{ length: { field: "Score" } },
			null
		)
		fireEvent.click(getByText("Length swatch"))
		expect(getByText("Swatch color")).toBeTruthy()
		expect(queryByText("Swatch shape")).toBeNull()
		expect(queryByLabelText("Outline thickness")).toBeNull()
	})

	it("the Shape legend gets its own subsection; outline thickness stores and resets", () => {
		const { input, cfg, resetBeside } = mount({ shape: { field: "Tier" } }, "Shape swatch")
		expect(input("Outline thickness").value).toBe("1")
		fireEvent.change(input("Outline thickness"), { target: { value: "2.5" } })
		expect(cfg()?.shapeLegendStrokeWidth).toBe(2.5)
		fireEvent.click(resetBeside(input("Outline thickness")))
		expect(cfg()?.shapeLegendStrokeWidth).toBeNull()
		fireEvent.change(input("Swatch size"), { target: { value: "11" } })
		expect(cfg()?.swatchSizes?.shape).toBe(11)
	})

	it("Size on the Shape variable folds into one Shape · Size subsection, which drops the swatch size", () => {
		const { queryByText, getByText, queryByLabelText } = mount(
			{ shape: { field: "Tier" }, area: { field: "Tier" } },
			null,
			{ hidden: { area: false } }
		)
		expect(queryByText("Size swatch")).toBeNull()
		fireEvent.click(getByText("Shape · Size swatch"))
		expect(queryByLabelText("Swatch size")).toBeNull()
	})
})
