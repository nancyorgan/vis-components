import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import {
	DEFAULT_FACET_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { FacetOptionsPanel } from "./FacetOptionsPanel"

/** Smoke coverage for the Facet panel's two-variable body
 *  (`FacetGridPanel`, rendered while `facetRow` / `facetCol` is mapped):
 *  Rows then Columns subsections writing the grid-wide share bits, the
 *  per-group range editor keyed off facet values, the panel-dim inputs
 *  following the focus-fill pattern, and the row/col asymmetry (pies
 *  have no row axis). */

// Explicit cleanup: this file imports vitest APIs directly (no globals), so
// testing-library's automatic afterEach unmount never registers.
afterEach(cleanup)

const ID = "ds-facet-axis-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "facetaxis",
		filename: "facetaxis.csv",
		fields: [
			{ name: "rowcat", inferredType: "categorical" },
			{ name: "colcat", inferredType: "categorical" },
			{ name: "xv", inferredType: "quantitative" },
			{ name: "yv", inferredType: "quantitative" },
		],
		rows: [
			{ rowcat: "North", colcat: "Left", xv: "1", yv: "2" },
			{ rowcat: "North", colcat: "Right", xv: "2", yv: "3" },
			{ rowcat: "South", colcat: "Left", xv: "3", yv: "4" },
			{ rowcat: "South", colcat: "Right", xv: "4", yv: "5" },
		],
	})

const scatterEncodings = (overrides: Partial<Encodings> = {}): Encodings => ({
	...emptyEncodings(),
	x: { field: "xv" },
	y: { field: "yv" },
	facetRow: { field: "rowcat" },
	facetCol: { field: "colcat" },
	...overrides,
})

const facetConfigs = (facet: Partial<FacetConfig> = {}): Partial<ChannelConfigs> => ({
	...EMPTY_CHANNEL_CONFIGS,
	facet: { ...DEFAULT_FACET_CONFIG, ...facet },
})

/** The Jotai store behind the most recent `mount`, for reading written
 *  configs back. */
let lastStore: TestStore | undefined

const mount = (
	encodings: Encodings,
	configs: Partial<ChannelConfigs>,
	children: React.ReactNode,
) => {
	// Atom storage effects re-load from localStorage on init and would reset a
	// snapshot-only seed to defaults, so the fixture goes into BOTH.
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	/* eslint-enable @vc/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		lastStore = snap
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(<TestProvider initializeState={init}>{children}</TestProvider>)
}

const expand = (
	utils: ReturnType<typeof render>,
	title: string | RegExp,
	index = 0,
) => {
	const header = utils.getAllByRole("button", { name: title })[index]!
	fireEvent.click(header)
}

describe("FacetOptionsPanel (two variables) — both axes", () => {
	it("offers Rows, then Columns, then spacing — one panel writing the grid-wide share bits", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		const headers = utils
			.getAllByRole("button", { name: /^(rows|columns|panel spacing and sizing)$/i })
			.map((b) => b.textContent?.trim())
		expect(headers).toEqual(["Rows", "Columns", "Panel spacing and sizing"])
		expand(utils, /^rows$/i)
		expand(utils, /^columns$/i)

		const yGroup = utils.getByRole("radiogroup", { name: "Share Y axis" })
		const xGroup = utils.getByRole("radiogroup", { name: "Share X axis" })
		// 2x2 grid → the per-group option surfaces on both, axis-named.
		expect(within(yGroup).getByRole("radio", { name: "Per row" })).toBeTruthy()
		expect(within(xGroup).getByRole("radio", { name: "Per column" })).toBeTruthy()

		// Clicking "None" on the Y picker writes shareY and leaves shareX.
		fireEvent.click(within(yGroup).getByRole("radio", { name: "None" }))
		expect(
			within(yGroup).getByRole("radio", { name: "None" }).getAttribute("aria-checked"),
		).toBe("true")
		expect(
			within(xGroup)
				.getByRole("radio", { name: "All panels" })
				.getAttribute("aria-checked"),
		).toBe("true")
		expect(lastStore!.get(currentChannelConfigsAtom).facet?.shareY).toBe("none")
		expect(lastStore!.get(currentChannelConfigsAtom).facet?.shareX).toBe("all")
	})

	it("shows the overall range under share=all and the per-group editor under perGroup", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs({ shareY: "perGroup" }),
			<FacetOptionsPanel />,
		)
		expand(utils, /^rows$/i)
		expand(utils, /^columns$/i)

		// Row axis (perGroup): per-row editor keyed by facet values.
		expect(utils.getByText("Y axis range per row")).toBeTruthy()
		expect(utils.getByText("North")).toBeTruthy()
		expect(utils.getByText("South")).toBeTruthy()
		// Col axis (default all): overall X range.
		expect(utils.getByText("X axis range")).toBeTruthy()
	})

	it("row-only grid with an unshared x axis offers an X range per panel (one per row)", () => {
		// One column, 2+ rows, share X = None: every row panel has its own
		// x axis and there's no column value to key a group bound on, so
		// the editor lists each panel.
		const utils = mount(
			scatterEncodings({ facetCol: { field: null } }),
			facetConfigs({ shareX: "none" }),
			<FacetOptionsPanel />,
		)
		expand(utils, /^columns$/i)
		expect(utils.getByText("X axis range per panel")).toBeTruthy()
		expand(utils, /X axis range per panel/i)
		expect(utils.getByText("North")).toBeTruthy()
		expect(utils.getByText("South")).toBeTruthy()
		// Two panels → two min inputs; editing the first commits a value.
		const mins = utils.getAllByLabelText("Min") as HTMLInputElement[]
		expect(mins).toHaveLength(2)
		fireEvent.change(mins[0]!, { target: { value: "0" } })
		expect(mins[0]!.value).toBe("0")
	})

	it("2D grid with an unshared y axis offers a Y range per panel keyed row · column", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs({ shareY: "none" }),
			<FacetOptionsPanel />,
		)
		expand(utils, /^rows$/i)
		expect(utils.getByText("Y axis range per panel")).toBeTruthy()
		expand(utils, /Y axis range per panel/i)
		expect(utils.getByText("North · Left")).toBeTruthy()
		expect(utils.getByText("South · Right")).toBeTruthy()
	})

	it("a grid panel's bound is stored under its row value, then its column value — never a joined key", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs({
				shareY: "none",
				// What a build before the nested map saved for the same panel:
				// the first edit replaces it, so one source of truth remains.
				panelAxisOverrides: { "North|Left": { yMax: 9 } },
			}),
			<FacetOptionsPanel />,
		)
		expand(utils, /^rows$/i)
		expand(utils, /Y axis range per panel/i)
		const mins = utils.getAllByLabelText("Min") as HTMLInputElement[]
		// Four panels (North/South × Left/Right), listed row-major.
		expect(mins).toHaveLength(4)
		fireEvent.change(mins[0]!, { target: { value: "0" } })
		const facet = lastStore!.get(currentChannelConfigsAtom).facet
		expect(facet?.gridPanelAxisOverrides).toEqual({
			North: { Left: { yMin: 0, yMax: 9 } },
		})
		expect(facet?.panelAxisOverrides).toEqual({})
		// The editor reads the stored value back the same way.
		expect(mins[0]!.value).toBe("0")
	})

	it("Replace ticks: checking opens a Ticks at box whose values store on that panel; unchecking drops them", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs({ shareY: "none" }),
			<FacetOptionsPanel />,
		)
		expand(utils, /^rows$/i)
		expand(utils, /Y axis range per panel/i)
		// One checkbox per listed panel; no tick box until one is checked.
		const boxes = utils.getAllByLabelText(/^Replace ticks for /)
		expect(boxes).toHaveLength(4)
		expect(utils.queryByLabelText("Ticks at")).toBeNull()
		fireEvent.click(utils.getByLabelText("Replace ticks for North · Left"))
		// Checked with nothing typed: stored as an empty list (renders auto).
		const facet = () => lastStore!.get(currentChannelConfigsAtom).facet
		expect(facet()?.gridPanelAxisOverrides).toEqual({
			North: { Left: { yTicks: [] } },
		})
		const ticks = utils.getByLabelText("Ticks at") as HTMLInputElement
		fireEvent.change(ticks, { target: { value: "0, 2.5, 5" } })
		fireEvent.blur(ticks)
		expect(facet()?.gridPanelAxisOverrides).toEqual({
			North: { Left: { yTicks: [0, 2.5, 5] } },
		})
		// Unchecking clears the list — and the now-empty entry with it.
		fireEvent.click(utils.getByLabelText("Replace ticks for North · Left"))
		expect(facet()?.gridPanelAxisOverrides).toEqual({})
		expect(utils.queryByLabelText("Ticks at")).toBeNull()
	})

	it("Replace ticks on the overall range keep the bounds beside them", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs({ shareY: "all", overallYRange: { min: 0 } }),
			<FacetOptionsPanel />,
		)
		expand(utils, /^rows$/i)
		fireEvent.click(utils.getByRole("checkbox", { name: /replace ticks/i }))
		const ticks = utils.getByLabelText("Ticks at") as HTMLInputElement
		fireEvent.change(ticks, { target: { value: "0, 10" } })
		fireEvent.keyDown(ticks, { key: "Enter" })
		expect(lastStore!.get(currentChannelConfigsAtom).facet?.overallYRange).toEqual({
			min: 0,
			ticks: [0, 10],
		})
	})

	it("panel height input steps from the auto value, not from min=1", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		expand(utils, /panel spacing and sizing/i)
		const input = utils.getByLabelText(/Panel height/) as HTMLInputElement
		// No solver-published dims in this jsdom mount → the placeholder reads
		// "auto" and the step base falls back to 200. Focus commits nothing;
		// the first arrow press lands one step above the base instead of at 2.
		expect(input.value).toBe("")
		fireEvent.focus(input)
		expect(input.value).toBe("")
		fireEvent.keyDown(input, { key: "ArrowUp" })
		expect(input.value).toBe("201")
	})

	it("panel height shows a reset link only while set; clicking it returns to auto", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		expand(utils, /panel spacing and sizing/i)
		// Auto (null) → no reset link to click.
		expect(utils.queryByLabelText("Reset panel height")).toBeNull()

		const input = utils.getByLabelText(/Panel height/) as HTMLInputElement
		fireEvent.change(input, { target: { value: "300" } })
		expect(input.value).toBe("300")
		const reset = utils.getByLabelText("Reset panel height")
		expect(reset).toBeTruthy()

		// Reset commits null (= auto): the field empties, the placeholder shows
		// through again, and the link disappears.
		fireEvent.click(reset)
		expect(input.value).toBe("")
		expect(utils.queryByLabelText("Reset panel height")).toBeNull()
	})
})

describe("FacetOptionsPanel (two variables) — preserved asymmetries", () => {
	it("shows the no-row-axis hint on pies but still offers the Columns (angle) picker", () => {
		const utils = mount(
			{
				...emptyEncodings(),
				angle: { field: "colcat" },
				facetRow: { field: "rowcat" },
				facetCol: { field: "colcat" },
			},
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		expect(utils.getByText(/no row axis to configure/i)).toBeTruthy()
		expect(utils.queryByRole("button", { name: /^rows$/i })).toBeNull()
		// Spacing still applies to pies.
		expand(utils, /panel spacing and sizing/i)
		expect(utils.getByLabelText(/Vertical gap/)).toBeTruthy()
		expand(utils, /^columns$/i)
		expect(utils.getByRole("radiogroup", { name: "Share Angle axis" })).toBeTruthy()
	})

	it("shows the map-a-variable hint when no facet channel is mapped", () => {
		const utils = mount(
			scatterEncodings({ facetRow: { field: null }, facetCol: { field: null } }),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		expect(utils.getByText(/Map a categorical or ordinal variable to Facet/)).toBeTruthy()
	})

	it("the Row / Column pickers head the panel; Columns never offers Rows' variable", () => {
		const utils = mount(scatterEncodings(), facetConfigs(), <FacetOptionsPanel />)
		const rows = utils.getByLabelText("Row") as HTMLSelectElement
		const cols = utils.getByLabelText("Column") as HTMLSelectElement
		expect(rows.value).toBe("rowcat")
		expect(cols.value).toBe("colcat")
		expect(Array.from(cols.options).map((o) => o.textContent)).toEqual([
			"— none —",
			"colcat",
		])
		fireEvent.change(cols, { target: { value: "" } })
		const after = lastStore!.get(currentEncodingsAtom)
		expect([after.facet.field, after.facetRow.field, after.facetCol.field]).toEqual([
			null,
			"rowcat",
			null,
		])
	})

	it("a half pair (Rows only) still gets the full two-variable panel", () => {
		const utils = mount(
			scatterEncodings({ facetCol: { field: null } }),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		const headers = utils
			.getAllByRole("button", { name: /^(rows|columns|dimension|panel spacing and sizing)$/i })
			.map((b) => b.textContent?.trim())
		expect(headers).toEqual(["Rows", "Columns", "Panel spacing and sizing"])
	})
})

describe("FacetOptionsPanel (two variables) — hide empty panels", () => {
	it("surfaces the checkbox when both facet channels are mapped", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		expand(utils, /panel spacing and sizing/i)
		const box = utils.getByLabelText("Hide empty panels") as HTMLInputElement
		expect(box.checked).toBe(false)
	})

	it("does NOT render when only one facet channel is mapped", () => {
		const utils = mount(
			scatterEncodings({ facetCol: { field: null } }),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		expand(utils, /panel spacing and sizing/i)
		// Empty cells only exist in the row × col cross-product; a single
		// facet direction derives its domain from the data, so the toggle
		// would be a no-op.
		expect(utils.queryByLabelText("Hide empty panels")).toBeNull()
	})

	it("clicking it writes channelConfigs.facet.hideEmptyPanels", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<FacetOptionsPanel />,
		)
		expand(utils, /panel spacing and sizing/i)
		const box = utils.getByLabelText("Hide empty panels") as HTMLInputElement
		fireEvent.click(box)
		expect(box.checked).toBe(true)
		expect(lastStore!.get(currentChannelConfigsAtom).facet?.hideEmptyPanels).toBe(true)
	})
})
