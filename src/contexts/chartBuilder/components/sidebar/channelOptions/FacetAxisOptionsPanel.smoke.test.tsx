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
	datasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { FacetColOptionsPanel } from "./FacetColOptionsPanel"
import { FacetRowOptionsPanel } from "./FacetRowOptionsPanel"

/** Smoke coverage for the shared `FacetAxisOptionsPanel` core behind the
 *  facetRow / facetCol wrappers: the mirrored share pickers target their
 *  own axis, the per-group range editor keys off facet values, the
 *  panel-dim input follows the focus-fill pattern, and the intentional
 *  row/col asymmetry (pies have no row axis) survives. */

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

const mount = (
	encodings: Encodings,
	configs: Partial<ChannelConfigs>,
	children: React.ReactNode,
) => {
	// Atom storage effects re-load from localStorage on init and would reset a
	// snapshot-only seed to defaults, so the fixture goes into BOTH.
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [ID]: buildDataset() })
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

describe("FacetAxisOptionsPanel — mirrored row / col share controls", () => {
	it("row and col panels surface their own axis picker and write independently", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<>
				<FacetRowOptionsPanel />
				<FacetColOptionsPanel />
			</>,
		)
		expand(utils, /rows/i)
		expand(utils, /columns/i)

		const rowGroup = utils.getByRole("group", { name: "Share Y axis" })
		const colGroup = utils.getByRole("group", { name: "Share X axis" })
		// 2x2 grid → the per-group option surfaces on both, axis-named.
		expect(within(rowGroup).getByRole("button", { name: "Per row" })).toBeTruthy()
		expect(
			within(colGroup).getByRole("button", { name: "Per column" }),
		).toBeTruthy()

		// Clicking "None" on the ROW panel must not disturb the col panel's
		// share mode (they write shareY vs shareX).
		fireEvent.click(within(rowGroup).getByRole("button", { name: "None" }))
		expect(
			within(rowGroup)
				.getByRole("button", { name: "None" })
				.getAttribute("aria-pressed"),
		).toBe("true")
		expect(
			within(colGroup)
				.getByRole("button", { name: "All panels" })
				.getAttribute("aria-pressed"),
		).toBe("true")
	})

	it("shows the overall range under share=all and the per-group editor under perGroup", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs({ shareY: "perGroup" }),
			<>
				<FacetRowOptionsPanel />
				<FacetColOptionsPanel />
			</>,
		)
		expand(utils, /rows/i)
		expand(utils, /columns/i)

		// Row axis (perGroup): per-row editor keyed by facet values.
		expect(utils.getByText("Y axis range per row")).toBeTruthy()
		expect(utils.getByText("North")).toBeTruthy()
		expect(utils.getByText("South")).toBeTruthy()
		// Col axis (default all): overall X range.
		expect(utils.getByText("X axis range")).toBeTruthy()
	})

	it("panel height input focus-fills from the displayed auto value", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<FacetRowOptionsPanel />,
		)
		expand(utils, /custom sizing/i)
		const input = utils.getByLabelText(/Panel height/) as HTMLInputElement
		// No solver-published dims in this jsdom mount → falls back to 200,
		// but the point is it fills on focus instead of stepping from min=1.
		expect(input.value).toBe("")
		fireEvent.focus(input)
		expect(input.value).toBe("200")
	})
})

describe("FacetAxisOptionsPanel — preserved asymmetries", () => {
	it("row panel shows the no-row-axis hint on pies; col panel still offers the angle picker", () => {
		const utils = mount(
			{
				...emptyEncodings(),
				angle: { field: "colcat" },
				facetRow: { field: "rowcat" },
				facetCol: { field: "colcat" },
			},
			facetConfigs(),
			<>
				<FacetRowOptionsPanel />
				<FacetColOptionsPanel />
			</>,
		)
		expect(
			utils.getByText(/no row axis to configure/i).textContent,
		).toContain("Use the column panel")
		// The row panel still surfaces Gap Y (panel layout applies to pies).
		expect(utils.getByLabelText(/Gap Y/)).toBeTruthy()

		expand(utils, /columns/i)
		expect(
			utils.getByRole("group", { name: "Share angle axis" }),
		).toBeTruthy()
	})

	it("shows the map-a-field hint when the facet channel is unmapped", () => {
		const utils = mount(
			scatterEncodings({ facetRow: undefined }),
			facetConfigs(),
			<FacetRowOptionsPanel />,
		)
		expect(utils.getByText(/Map a categorical field to Facet \(row\)/)).toBeTruthy()
	})
})

describe("FacetAxisOptionsPanel — hide empty panels", () => {
	it("surfaces the checkbox in both mirrored panels when both facet channels are mapped", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<>
				<FacetRowOptionsPanel />
				<FacetColOptionsPanel />
			</>,
		)
		expand(utils, /custom sizing/i, 0)
		expand(utils, /custom sizing/i, 1)
		const boxes = utils.getAllByLabelText(
			"Hide empty panels",
		) as HTMLInputElement[]
		// One code site, same config bit — the control mirrors by design.
		expect(boxes).toHaveLength(2)
		expect(boxes.every((b) => !b.checked)).toBe(true)
	})

	it("does NOT render when only one facet channel is mapped", () => {
		const utils = mount(
			scatterEncodings({ facetCol: undefined }),
			facetConfigs(),
			<FacetRowOptionsPanel />,
		)
		expand(utils, /custom sizing/i)
		// Empty cells only exist in the row × col cross-product; a single
		// facet direction derives its domain from the data, so the toggle
		// would be a no-op.
		expect(utils.queryByLabelText("Hide empty panels")).toBeNull()
	})

	it("clicking it writes channelConfigs.facet.hideEmptyPanels (shared bit — both panels flip)", () => {
		const utils = mount(
			scatterEncodings(),
			facetConfigs(),
			<>
				<FacetRowOptionsPanel />
				<FacetColOptionsPanel />
			</>,
		)
		expand(utils, /custom sizing/i, 0)
		expand(utils, /custom sizing/i, 1)
		const [rowBox, colBox] = utils.getAllByLabelText(
			"Hide empty panels",
		) as HTMLInputElement[]
		fireEvent.click(rowBox!)
		// Checked state derives from cfg.hideEmptyPanels === true, so both
		// mirrored panels flipping proves the write hit the shared
		// channelConfigs.facet config bit (not local component state).
		expect(rowBox!.checked).toBe(true)
		expect(colBox!.checked).toBe(true)
	})
})
