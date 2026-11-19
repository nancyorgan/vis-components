import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import { currentLegendConfigAtom } from "../../../store/atoms"

import { LegendPanel } from "../LegendPanel"

const DATASET_ID = "ds-legend-properties"

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

describe("LegendPanel — Legend properties", () => {
	it("shows X / Y only for an inside legend; X stores and resets to auto", () => {
		const outside = mount({ hue: { field: "Tier" } }, "Legend properties")
		expect(outside.queryByLabelText("X")).toBeNull()
		expect(outside.queryByLabelText("Y")).toBeNull()
		cleanup()
		const { input, cfg, resetBeside } = mount({ hue: { field: "Tier" } }, "Legend properties", {
			position: "inside",
		})
		expect(input("X").value).toBe("")
		expect(input("X").placeholder).toBe("Auto")
		fireEvent.change(input("X"), { target: { value: "0.4" } })
		expect(cfg()?.insideX).toBe(0.4)
		fireEvent.click(resetBeside(input("X")))
		expect(cfg()?.insideX).toBeNull()
	})

	it("Y resets to the default", () => {
		const { input, cfg, resetBeside } = mount({ hue: { field: "Tier" } }, "Legend properties", {
			position: "inside",
		})
		fireEvent.change(input("Y"), { target: { value: "0.5" } })
		expect(cfg()?.insideY).toBe(0.5)
		fireEvent.click(resetBeside(input("Y")))
		expect(cfg()?.insideY).toBe(DEFAULT_LEGEND_CONFIG.insideY)
	})

	it("Orientation switches between Stacked and Horizontal", () => {
		const { getByText, cfg } = mount({ hue: { field: "Tier" } }, "Legend properties")
		fireEvent.click(getByText("Horizontal"))
		expect(cfg()?.orientation).toBe("horizontal")
		fireEvent.click(getByText("Stacked"))
		expect(cfg()?.orientation).toBe("vertical")
	})

	it("Column gap appears once there is more than one column", () => {
		const { input, queryByLabelText, cfg, resetBeside } = mount(
			{ hue: { field: "Tier" } },
			"Legend properties"
		)
		expect(queryByLabelText("Column gap")).toBeNull()
		fireEvent.change(input("Legend columns"), { target: { value: "2" } })
		expect(cfg()?.columns).toBe(2)
		fireEvent.change(input("Column gap"), { target: { value: "40" } })
		expect(cfg()?.columnGap).toBe(40)
		fireEvent.click(resetBeside(input("Column gap")))
		expect(cfg()?.columnGap).toBe(DEFAULT_LEGEND_CONFIG.columnGap)
		fireEvent.click(resetBeside(input("Legend columns")))
		expect(queryByLabelText("Column gap")).toBeNull()
	})
})
