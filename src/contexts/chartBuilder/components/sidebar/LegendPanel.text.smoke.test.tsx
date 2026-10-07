import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import {
	DEFAULT_LABELS_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	type LabelsConfig,
	type LegendConfig,
} from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { currentLabelsAtom, currentLegendConfigAtom } from "../../store/atoms"

import { LegendPanel } from "./LegendPanel"

/** "Legend text" (Legend panel, below Legend properties): font family /
 *  color / size / weight / style + alignment for the labels beside each
 *  swatch. Sparse — blank fields inherit the theme's legend-text defaults,
 *  which the controls surface as their placeholders. */

const DATASET_ID = "ds-legendpanel-text"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "tiers",
		filename: "tiers.csv",
		fields: [{ name: "Tier", inferredType: "categorical" }],
		rows: [{ Tier: "A" }, { Tier: "B" }],
	})

/** A theme whose legend-text slot differs from the shared body text, so the
 *  tests can tell which rung of the fallback chain the panel reads. */
const labelsWithLegendText = (): LabelsConfig => ({
	...DEFAULT_LABELS_CONFIG,
	baseFont: {
		...DEFAULT_LABELS_CONFIG.baseFont,
		text: {
			...DEFAULT_LABELS_CONFIG.baseFont.text,
			family: "system-ui, sans-serif",
			size: 12,
			color: "#111111",
			legendSize: 10,
			legendColor: "#0000aa",
			legendWeight: 600,
			legendFamily: "Inter, system-ui, sans-serif",
		},
	},
})

afterEach(cleanup)

const mount = (legend: Partial<LegendConfig> = {}) => {
	const store = installInMemoryLocalStorage()
	const encodings = { ...emptyEncodings(), hue: { field: "Tier" } }
	const legendCfg: LegendConfig = { ...DEFAULT_LEGEND_CONFIG, ...legend }
	const labels = labelsWithLegendText()
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
		s.set(currentLabelsAtom, labels)
	}
	const utils = render(
		<TestProvider initializeState={init}>
			<LegendPanel />
		</TestProvider>
	)
	// Subsections start collapsed — open "Legend text".
	fireEvent.click(within(utils.container).getByText("Legend text"))
	const cfg = () => (snap as TestStore | null)?.get(currentLegendConfigAtom)
	return { ...utils, cfg }
}

describe("LegendPanel — Legend text", () => {
	it("sits between Legend properties and Label formatting", () => {
		const { container } = mount()
		const text = container.textContent ?? ""
		expect(text.indexOf("Legend properties")).toBeLessThan(
			text.indexOf("Legend text")
		)
	})

	it("starts blank, showing the theme's legend-text defaults as the inherited values", () => {
		const utils = mount()
		const size = utils.getByLabelText("Size") as HTMLInputElement
		expect(size.value).toBe("")
		expect(size.placeholder).toBe("10")
		// Family / Weight name what they inherit in their "(…)" entry.
		const family = utils.getByLabelText("Family") as HTMLSelectElement
		expect(family.value).toBe("")
		expect(family.options[0].text).toBe("(Inter)")
		const weight = utils.getByLabelText("Weight") as HTMLSelectElement
		expect(weight.value).toBe("")
		expect(weight.options[0].text).toBe("(Semibold)")
		// The color swatch previews the inherited legend color.
		// The Color row is a ColorInput: its <label> names the swatch "Color".
		const swatch = utils.getByLabelText("Color") as HTMLInputElement
		expect(swatch.type).toBe("color")
		expect(swatch.value).toBe("#0000aa")
	})

	it("size, family, weight and color write into the sparse textFont override", () => {
		const utils = mount()
		fireEvent.change(utils.getByLabelText("Size"), { target: { value: "16" } })
		expect(utils.cfg()?.textFont).toEqual({ size: 16 })
		fireEvent.change(utils.getByLabelText("Family"), {
			target: { value: "Georgia, 'Times New Roman', serif" },
		})
		fireEvent.change(utils.getByLabelText("Weight"), { target: { value: "700" } })
		fireEvent.change(utils.getByLabelText("Color"), {
			target: { value: "#ff0000" },
		})
		expect(utils.cfg()?.textFont).toEqual({
			size: 16,
			family: "Georgia, 'Times New Roman', serif",
			weight: 700,
			// ColorInput normalizes swatch picks to uppercase hex.
			color: "#FF0000",
		})
	})

	it("a size reset drops just that field, leaving the rest of the override", () => {
		const utils = mount({ textFont: { size: 16, color: "#ff0000" } })
		const size = utils.getByLabelText("Size") as HTMLInputElement
		expect(size.value).toBe("16")
		// Both Size and Color are overridden here, so each shows its own
		// "reset" — pick the one sharing a row with the Size input.
		const sizeReset = utils
			.getAllByText("reset")
			.find((b) => b.parentElement?.contains(size))
		fireEvent.click(sizeReset as HTMLElement)
		expect(utils.cfg()?.textFont).toEqual({ color: "#ff0000" })
	})

	it("clearing the last overridden field leaves no stale keys behind", () => {
		const utils = mount({ textFont: { size: 16 } })
		const size = utils.getByLabelText("Size") as HTMLInputElement
		// NumberInput's clear path writes the field back as `undefined`; the
		// panel strips it so the subsection's "changed" dot goes out too.
		fireEvent.change(size, { target: { value: "" } })
		expect(utils.cfg()?.textFont).toEqual({})
		expect(Object.keys(utils.cfg()?.textFont ?? {})).toHaveLength(0)
	})

	it("alignment stores center / right and clears back to null on left", () => {
		const utils = mount()
		fireEvent.click(utils.getByLabelText("Center"))
		expect(utils.cfg()?.textAlign).toBe("center")
		fireEvent.click(utils.getByLabelText("Align right"))
		expect(utils.cfg()?.textAlign).toBe("right")
		// Left IS the historical layout, so it clears rather than storing.
		fireEvent.click(utils.getByLabelText("Align left"))
		expect(utils.cfg()?.textAlign).toBeNull()
	})
})
