import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import { currentLegendConfigAtom } from "../../../store/atoms"

import { LegendPanel } from "../LegendPanel"

const DATASET_ID = "ds-legend-shown"

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

describe("LegendPanel — Legends shown", () => {
	it("lists a checkbox per mapped legend channel, checked", () => {
		const { getByLabelText, queryByLabelText } = mount(
			{ hue: { field: "Tier" }, pattern: { field: "Score" } },
			"Legends shown"
		)
		expect((getByLabelText("Color") as HTMLInputElement).checked).toBe(true)
		expect((getByLabelText("Pattern") as HTMLInputElement).checked).toBe(true)
		expect(queryByLabelText("Shape")).toBeNull()
	})

	it("unchecking a channel hides its legend; hiding the last one drops the legend's own subsections", () => {
		const { getByLabelText, queryByText, cfg } = mount({ hue: { field: "Tier" } }, "Legends shown")
		expect(queryByText("Legend properties")).toBeTruthy()
		fireEvent.click(getByLabelText("Color"))
		expect(cfg()?.hidden?.hue).toBe(true)
		expect(queryByText("Legend properties")).toBeNull()
		expect(queryByText("Box")).toBeNull()
		expect(queryByText("Legend text")).toBeNull()
	})

	it("offers the combine toggle only when two legend channels share a variable", () => {
		const alone = mount({ hue: { field: "Tier" } }, "Legends shown")
		expect(alone.queryByLabelText("Combine legends with same variables")).toBeNull()
		cleanup()
		const shared = mount(
			{ hue: { field: "Tier" }, pattern: { field: "Tier" } },
			"Legends shown"
		)
		const combine = shared.getByLabelText(
			"Combine legends with same variables"
		) as HTMLInputElement
		expect(combine.checked).toBe(true)
		fireEvent.click(combine)
		expect(shared.cfg()?.combineSameVariable).toBe(false)
	})
})
