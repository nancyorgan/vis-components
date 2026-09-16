import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentLegendConfigAtom,
	currentRenderedLegendWidthAtom,
} from "../../store/atoms"

import { LegendPanel } from "./LegendPanel"

/** "Legend width" (Legend properties, between Position and Orientation):
 *  px-truth shown in px / in / cm, blank = auto with the rendered auto width
 *  as the placeholder. */

const DATASET_ID = "ds-legendpanel-width"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "tiers",
		filename: "tiers.csv",
		fields: [{ name: "Tier", inferredType: "categorical" }],
		rows: [{ Tier: "A" }, { Tier: "B" }],
	})

afterEach(cleanup)

const mount = (legend: Partial<LegendConfig> = {}) => {
	const store = installInMemoryLocalStorage()
	const encodings = { ...emptyEncodings(), hue: { field: "Tier" } }
	const legendCfg: LegendConfig = { ...DEFAULT_LEGEND_CONFIG, ...legend }
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentLegend", JSON.stringify(legendCfg))
	/* eslint-enable @th/use-wrapped-json-functions */
	let snap: TestStore | null = null
	const init = (s: TestStore) => {
		snap = s
		s.set(currentLegendConfigAtom, legendCfg)
		// Pretend the legend rendered 212px wide (the auto placeholder source).
		s.set(currentRenderedLegendWidthAtom, 212)
	}
	const utils = render(
		<TestProvider initializeState={init}>
			<LegendPanel />
		</TestProvider>
	)
	// Subsections start collapsed — open "Legend properties".
	fireEvent.click(within(utils.container).getByText("Legend properties"))
	const input = utils.getByLabelText("Legend width") as HTMLInputElement
	const unit = utils.getByLabelText("Legend width unit") as HTMLSelectElement
	const cfg = () => (snap as TestStore | null)?.get(currentLegendConfigAtom)
	return { ...utils, input, unit, cfg }
}

describe("LegendPanel — Legend width", () => {
	it("starts blank (auto) with the rendered width as placeholder, and sits between Position and Orientation", () => {
		const { input, container } = mount()
		expect(input.value).toBe("")
		expect(input.placeholder).toBe("212")
		const text = container.textContent ?? ""
		expect(text.indexOf("Position")).toBeLessThan(text.indexOf("Legend width"))
		expect(text.indexOf("Legend width")).toBeLessThan(text.indexOf("Orientation"))
	})

	it("typing a px value stores px", () => {
		const { input, cfg } = mount()
		fireEvent.change(input, { target: { value: "300" } })
		expect(cfg()?.width).toBe(300)
		expect(input.value).toBe("300")
	})

	it("inches convert at 96 px/in; the unit is display-only", () => {
		const { input, unit, cfg } = mount()
		fireEvent.change(unit, { target: { value: "in" } })
		expect(cfg()?.widthUnit).toBe("in")
		// Placeholder follows the unit: 212px ≈ 2.21in.
		expect(input.placeholder).toBe("2.21")
		fireEvent.change(input, { target: { value: "3" } })
		expect(cfg()?.width).toBe(288)
		expect(input.value).toBe("3")
		// Switching back to px shows the same width in pixels.
		fireEvent.change(unit, { target: { value: "px" } })
		expect(input.value).toBe("288")
		expect(cfg()?.width).toBe(288)
	})

	it("cm round-trips what was typed (unrounded px keeps 7.5 from becoming 7.49)", () => {
		const { input, unit, cfg } = mount()
		fireEvent.change(unit, { target: { value: "cm" } })
		fireEvent.change(input, { target: { value: "7.5" } })
		expect(cfg()?.width).toBeCloseTo(283.46, 1)
		fireEvent.blur(input)
		expect(input.value).toBe("7.5")
	})

	it("clearing the field returns to auto", () => {
		const { input, cfg } = mount({ width: 240 })
		expect(input.value).toBe("240")
		fireEvent.change(input, { target: { value: "" } })
		expect(cfg()?.width).toBeNull()
		expect(input.value).toBe("")
	})

	it("a blank field steps from the rendered auto width (placeholder), not from 0", () => {
		const { input, cfg } = mount()
		// Focus alone commits nothing — the field stays auto.
		fireEvent.focus(input)
		expect(cfg()?.width).toBeNull()
		// First arrow press: 212 + one 10px step.
		fireEvent.keyDown(input, { key: "ArrowUp" })
		expect(cfg()?.width).toBe(222)
		expect(input.value).toBe("222")
	})

	it("a blank field's spinner also steps from the placeholder", () => {
		const { input, cfg } = mount()
		// The ▼ button sits beside the input inside NumberInput's wrapper;
		// scope to it (the panel has several NumberInputs).
		const decrement = within(input.parentElement as HTMLElement).getByLabelText(
			"Decrement"
		)
		fireEvent.mouseDown(decrement)
		fireEvent.mouseUp(decrement)
		expect(cfg()?.width).toBe(202)
	})
})
