import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import { currentLegendConfigAtom } from "../../../store/atoms"

import { LegendPanel } from "../LegendPanel"

const DATASET_ID = "ds-legend-format"

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

describe("LegendPanel — Label format", () => {
	it("is offered for a quantitative legend, named by its channel and data range", () => {
		const categorical = mount({ hue: { field: "Tier" } }, null)
		expect(categorical.queryByText("Label format")).toBeNull()
		cleanup()
		const { getByText } = mount({ hue: { field: "Score" } }, "Label format")
		expect(getByText("Color legend formatting")).toBeTruthy()
		expect(getByText(/data range 0 — 14/)).toBeTruthy()
	})

	it("channels on one variable share a single editor whose edits fan out", () => {
		const { getByText, input, cfg } = mount(
			{ hue: { field: "Score" }, length: { field: "Score" } },
			"Label format",
			// Combining off keeps both as bar / standalone legends on the field.
			{ combineSameVariable: false }
		)
		expect(getByText(/Color · Length legend formatting|Length · Color legend formatting/)).toBeTruthy()
		const breaks = input("Custom breaks")
		fireEvent.change(breaks, { target: { value: "0, 5, 10" } })
		fireEvent.blur(breaks)
		expect(cfg()?.channels?.hue?.breaks).toEqual([0, 5, 10])
		expect(cfg()?.channels?.length?.breaks).toEqual([0, 5, 10])
	})

	it("the Breaks count fills exactly that many custom breaks, and reset clears them", () => {
		const { input, cfg, resetBeside } = mount({ hue: { field: "Score" } }, "Label format")
		expect(input("Custom breaks").value).toBe("")
		fireEvent.change(input("Breaks"), { target: { value: "4" } })
		expect(cfg()?.channels?.hue?.breakCount).toBe(4)
		expect(cfg()?.channels?.hue?.breaks).toHaveLength(4)
		expect(input("Custom breaks").value).not.toBe("")
		fireEvent.click(resetBeside(input("Breaks")))
		expect(cfg()?.channels?.hue?.breaks).toEqual([])
		expect(input("Custom breaks").value).toBe("")
	})

	it("Enter commits typed custom breaks", () => {
		const { input, cfg } = mount({ hue: { field: "Score" } }, "Label format")
		const breaks = input("Custom breaks")
		fireEvent.change(breaks, { target: { value: "0 7 14" } })
		expect(cfg()?.channels?.hue?.breaks ?? []).toEqual([])
		fireEvent.keyDown(breaks, { key: "Enter" })
		expect(cfg()?.channels?.hue?.breaks).toEqual([0, 7, 14])
	})
})
