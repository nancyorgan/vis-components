import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../lib/labelsConfig"
import { SYSTEM_LIGHT_THEME } from "../../lib/systemThemes"
import { emptyEncodings, type Dataset, type SavedTheme } from "../../lib/types"
import { currentLegendConfigAtom, currentThemeIdAtom, themesAtom } from "../../store/atoms"

import { LegendPanel } from "./LegendPanel"

/** Box → Margins: per-side padding between the legend box's edge and its
 *  contents. Blank = the theme's margin, else automatic (16 px outside,
 *  12 px inside), shown as the placeholder; a cleared side drops out of the
 *  sparse `padding` record. */

const DATASET_ID = "ds-legendpanel-margins"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "tiers",
		filename: "tiers.csv",
		fields: [{ name: "Tier", inferredType: "categorical" }],
		rows: [{ Tier: "A" }, { Tier: "B" }],
	})

afterEach(cleanup)

const mount = (legend: Partial<LegendConfig> = {}, themePatch: Partial<SavedTheme> = {}) => {
	const theme: SavedTheme = { ...SYSTEM_LIGHT_THEME, ...themePatch }
	const store = installInMemoryLocalStorage()
	const encodings = { ...emptyEncodings(), hue: { field: "Tier" } }
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
		s.set(themesAtom, [theme])
		s.set(currentThemeIdAtom, theme.id)
		s.set(currentLegendConfigAtom, legendCfg)
	}
	const utils = render(
		<TestProvider initializeState={init}>
			<LegendPanel />
		</TestProvider>
	)
	// Subsections start collapsed — open "Box".
	fireEvent.click(within(utils.container).getByText("Box"))
	const group = utils.container.querySelector("[data-legend-margins]") as HTMLElement
	const side = (label: string) => within(group).getByLabelText(label) as HTMLInputElement
	const cfg = () => (snap as TestStore | null)?.get(currentLegendConfigAtom)
	return { ...utils, group, side, cfg }
}

describe("LegendPanel — Box margins", () => {
	it("lists Top / Right / Bottom / Left under a Margins heading, blank with the automatic amount", () => {
		const { group, side } = mount({ position: "right" })
		expect(within(group).getByText("Margins")).toBeTruthy()
		for (const label of ["Top", "Right", "Bottom", "Left"]) {
			expect(side(label).value).toBe("")
			expect(side(label).placeholder).toBe("16")
		}
	})

	it("a theme margin shows as that side's placeholder (and is where a step starts)", () => {
		const { side, cfg } = mount({}, { legendPadding: { left: 6 } })
		expect(side("Left").placeholder).toBe("6")
		expect(side("Top").placeholder).toBe("16")
		fireEvent.keyDown(side("Left"), { key: "ArrowUp" })
		expect(cfg()?.padding).toEqual({ left: 7 })
	})

	it("an inside legend's placeholder is its tighter 12 px", () => {
		const { side } = mount({ position: "inside" })
		expect(side("Top").placeholder).toBe("12")
	})

	it("typing a side stores just that side", () => {
		const { side, cfg } = mount()
		fireEvent.change(side("Left"), { target: { value: "24" } })
		expect(cfg()?.padding).toEqual({ left: 24 })
		fireEvent.change(side("Top"), { target: { value: "0" } })
		expect(cfg()?.padding).toEqual({ left: 24, top: 0 })
	})

	it("clearing a side (or its reset link) returns it to automatic", () => {
		const { side, cfg, group } = mount({ padding: { left: 24, top: 4 } })
		expect(side("Left").value).toBe("24")
		fireEvent.change(side("Left"), { target: { value: "" } })
		expect(cfg()?.padding).toEqual({ top: 4 })
		fireEvent.click(within(group).getByLabelText("Reset top margin"))
		expect(cfg()?.padding).toBeUndefined()
	})

	it("a blank side steps from the automatic amount, not from 0", () => {
		const { side, cfg } = mount({ position: "bottom" })
		fireEvent.keyDown(side("Bottom"), { key: "ArrowUp" })
		expect(cfg()?.padding).toEqual({ bottom: 17 })
	})
})
