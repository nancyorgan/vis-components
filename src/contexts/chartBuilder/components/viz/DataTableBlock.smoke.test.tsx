import { cleanup, fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { buildDataset } from "../../../../testSupport/fixtures"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { DEFAULT_AXIS_CONFIG, EMPTY_CHANNEL_CONFIGS } from "../../lib/channelConfig"
import {
	DEFAULT_DATA_TABLE_CONFIG,
	type DataTableConfig,
} from "../../lib/dataTableConfig"
import { emptyEncodings } from "../../lib/types"
import { LIGHT_THEME_BASE } from "../../lib/systemThemes"
import {
	currentChannelConfigsAtom,
	currentDataTableConfigAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentVisualNameAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	themeAtom,
} from "../../store/atoms"

import {
	ChartWithDataTable,
	DataTableBlock,
	DataTableTabs,
	ExportTableLayout,
} from "./DataTableBlock"

afterEach(cleanup)

const ID = "ds-data-table"

const mount = (
	cfg: Partial<DataTableConfig>,
	ui: ReactNode = <DataTableBlock />
) => {
	installInMemoryLocalStorage()
	const init = (s: TestStore) => {
		// `currentThemeIdAtom` defaults null, so `useCurrentTheme` falls back to
		// the legacy `themeAtom`. Pin the NEUTRAL base there: these tests describe
		// the table against a theme that sets nothing, and the bundled system
		// themes pin several data-table rows of their own.
		s.set(themeAtom, LIGHT_THEME_BASE)
		s.set(
			loadedDatasetsAtom,
			{
				[ID]: buildDataset({
					id: ID,
					name: "sales",
					fields: [
						{ name: "region", inferredType: "categorical" },
						{ name: "sales", inferredType: "quantitative" },
						{ name: "unused", inferredType: "categorical" },
					],
					rows: [
						{ region: "West", sales: "1200", unused: "a" },
						{ region: "East", sales: "300", unused: "b" },
						{ region: "North", sales: "50", unused: "c" },
					],
				}),
			}
		)
		s.set(currentDatasetIdAtom, ID)
		s.set(previewVersionIdAtom, null)
		s.set(currentEncodingsAtom, {
			...emptyEncodings(),
			x: { field: "region" },
			y: { field: "sales" },
		})
		s.set(currentChannelConfigsAtom, {
			...EMPTY_CHANNEL_CONFIGS,
			y: { ...DEFAULT_AXIS_CONFIG, customFormat: "$,.0f" },
		})
		s.set(currentFieldOverridesAtom, {})
		s.set(currentFieldLevelOrdersAtom, {})
		s.set(currentVisualNameAtom, "Regional sales")
		s.set(currentDataTableConfigAtom, { ...DEFAULT_DATA_TABLE_CONFIG, ...cfg })
	}
	return render(
		<TestProvider initializeState={init}>{ui}</TestProvider>
	)
}

describe("DataTableBlock", () => {
	it("renders nothing while disabled", () => {
		const utils = mount({ enabled: false })
		expect(utils.container.innerHTML).toBe("")
	})

	it("renders a semantic table: caption, column headers, formatted cells", () => {
		const utils = mount({ enabled: true })
		const table = utils.getByRole("table")
		expect(table.querySelector("caption")?.textContent).toBe(
			"Data for Regional sales"
		)
		const headers = [...table.querySelectorAll("thead th")]
		expect(headers.map((h) => h.textContent)).toEqual(["region", "sales"])
		expect(headers.every((h) => h.getAttribute("scope") === "col")).toBe(true)
		// The y axis's Format reaches the cells, as it reaches the tooltip.
		expect(utils.getByText("$1,200")).toBeTruthy()
		// Numbers right-align by default.
		expect(utils.getByText("$1,200").className).toContain("vc-data-table-align-right")
		expect(utils.getByRole("button", { name: "Download CSV" })).toBeTruthy()
	})

	it('"Select variables" shows only the checked ones, in the data\'s order', () => {
		const utils = mount({
			enabled: true,
			columns: "select",
			selectedColumns: ["unused", "region"],
		})
		expect(utils.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
			"region",
			"unused",
		])
	})

	it('"All variables" shows every column', () => {
		const utils = mount({ enabled: true, columns: "all" })
		expect(utils.getAllByRole("columnheader")).toHaveLength(3)
	})

	it("puts the title above (as the table's caption element) and the caption below", () => {
		const utils = mount({ enabled: true, title: "Sales table", caption: "Source: survey" })
		const table = utils.getByRole("table")
		expect(table.querySelector("caption")?.textContent).toBe("Sales table")
		const below = utils.getByText("Source: survey")
		expect(below.tagName).toBe("P")
		expect(table.getAttribute("aria-describedby")).toContain(below.id)
	})

	it("renders no caption paragraph when the caption is empty", () => {
		const utils = mount({ enabled: true })
		expect(utils.container.querySelector(".vc-data-table-caption")).toBeNull()
	})

	it("aligns text columns left and number columns right by default, header included", () => {
		const utils = mount({ enabled: true })
		const [regionHead, salesHead] = utils.getAllByRole("columnheader")
		expect(regionHead!.className).toBe("vc-data-table-align-left")
		expect(salesHead!.className).toBe("vc-data-table-align-right")
		expect(utils.getByText("$1,200").className).toBe("vc-data-table-align-right")
	})

	it("styles the first column's body cells on their own only when unchecked", () => {
		const same = mount({ enabled: true })
		expect(same.container.querySelector(".vc-data-table-first")).toBeNull()
		cleanup()
		const own = mount({ enabled: true, firstColumnLikeOthers: false, firstColumnFontWeight: 700 })
		expect(own.getByText("West").classList.contains("vc-data-table-first")).toBe(true)
		expect(own.getByText("$1,200").classList.contains("vc-data-table-first")).toBe(false)
		const block = own.container.querySelector<HTMLElement>("[data-data-table]")!
		expect(block.style.getPropertyValue("--vc-dt-first-weight")).toBe("700")
	})

	it("a column's own alignment wins", () => {
		const utils = mount({ enabled: true, columnAlign: { region: "center", sales: "left" } })
		const [regionHead, salesHead] = utils.getAllByRole("columnheader")
		expect(regionHead!.className).toBe("vc-data-table-align-center")
		expect(salesHead!.className).toBe("vc-data-table-align-left")
		expect(utils.getByText("West").className).toBe("vc-data-table-align-center")
	})

	it("cuts at Max rows and offers the rest", () => {
		const utils = mount({ enabled: true, maxRows: 2, showDownload: false })
		expect(utils.getAllByRole("row")).toHaveLength(3) // header + 2
		expect(utils.queryByRole("button", { name: "Download CSV" })).toBeNull()
		fireEvent.click(utils.getByRole("button", { name: "Show all 3 rows" }))
		expect(utils.getAllByRole("row")).toHaveLength(4)
		// …and back to the cut, from the same button.
		fireEvent.click(utils.getByRole("button", { name: "Show first 2 rows" }))
		expect(utils.getAllByRole("row")).toHaveLength(3)
		expect(utils.getByRole("button", { name: "Show all 3 rows" })).toBeTruthy()
	})

	it("for screen readers only: the table is in the page, off screen, and nothing in it takes focus", () => {
		const utils = mount({
			enabled: true,
			placement: "hidden",
			maxRows: 2,
			showDownload: true,
		})
		const table = utils.getByRole("table")
		expect(table.closest("[data-data-table]")?.classList.contains("sr-only")).toBe(true)
		expect(utils.getAllByRole("row")).toHaveLength(3) // header + 2
		expect(utils.queryByRole("button")).toBeNull()
		expect(utils.container.querySelector("[tabindex]")).toBeNull()
		expect(utils.getByText("First 2 of 3 rows")).toBeTruthy()
	})

	it("behind a button: a real toggle wired with aria-expanded / aria-controls", () => {
		const utils = mount({ enabled: true, placement: "button" })
		const button = utils.getByRole("button", { name: "View data" })
		expect(button.getAttribute("aria-expanded")).toBe("false")
		const region = document.getElementById(button.getAttribute("aria-controls") ?? "")
		expect(region).toBeTruthy()
		expect(region?.hidden).toBe(true)
		expect(utils.queryByRole("table")).toBeNull()

		fireEvent.click(button)
		const hide = utils.getByRole("button", { name: "Hide data" })
		expect(hide.getAttribute("aria-expanded")).toBe("true")
		expect(region?.hidden).toBe(false)
		expect(utils.getByRole("table")).toBeTruthy()
	})

	it("in a tab: the block under the chart stays empty", () => {
		const utils = mount({ enabled: true, placement: "tabs" })
		expect(utils.container.innerHTML).toBe("")
	})

	it("in a tab: Chart / Data tabs over a chart that stays mounted", () => {
		const utils = mount(
			{ enabled: true, placement: "tabs" },
			<DataTableTabs>
				<div data-testid="chart">chart</div>
			</DataTableTabs>
		)
		const chartTab = utils.getByRole("tab", { name: "Chart" })
		const dataTab = utils.getByRole("tab", { name: "Data" })
		expect(chartTab.getAttribute("aria-selected")).toBe("true")
		expect(dataTab.tabIndex).toBe(-1)
		expect(utils.queryByRole("table")).toBeNull()

		fireEvent.click(dataTab)
		expect(dataTab.getAttribute("aria-selected")).toBe("true")
		expect(utils.getByRole("table")).toBeTruthy()
		const panel = document.getElementById(dataTab.getAttribute("aria-controls") ?? "")
		expect(panel?.getAttribute("role")).toBe("tabpanel")
		// The chart is hidden, not unmounted, so its layout survives.
		const chart = utils.getByTestId("chart")
		expect((chart.parentElement as HTMLElement).style.visibility).toBe("hidden")

		// Arrow keys move selection with focus (automatic activation).
		fireEvent.keyDown(dataTab, { key: "ArrowRight" })
		expect(chartTab.getAttribute("aria-selected")).toBe("true")
		expect(document.activeElement).toBe(chartTab)
		expect(utils.queryByRole("table")).toBeNull()
	})

	it("other placements leave the wrapped chart untouched", () => {
		const utils = mount(
			{ enabled: true, placement: "below" },
			<DataTableTabs>
				<div data-testid="chart">chart</div>
			</DataTableTabs>
		)
		expect(utils.queryByRole("tablist")).toBeNull()
		expect(utils.getByTestId("chart").parentElement).toBe(utils.container)
	})

	it("behind a button, around the figure: View data row under the chart, table after it", () => {
		const utils = mount(
			{ enabled: true, placement: "button" },
			<ChartWithDataTable>
				<div data-testid="chart">chart</div>
			</ChartWithDataTable>
		)
		const button = utils.getByRole("button", { name: "View data" })
		const chartBox = utils.getByTestId("chart").parentElement?.parentElement
		// The toggle shares the figure's full-height box; the table doesn't.
		expect(chartBox?.contains(button)).toBe(true)
		fireEvent.click(button)
		const table = utils.getByRole("table")
		expect(chartBox?.contains(table)).toBe(false)
		expect(utils.getByRole("button", { name: "Hide data" })).toBeTruthy()
	})

	it("image export: a static table under the chart, whatever the placement — no links, a cut says so", () => {
		const utils = mount(
			{ enabled: true, placement: "tabs", maxRows: 2, showDownload: true },
			<ExportTableLayout>
				<div data-testid="chart" />
			</ExportTableLayout>
		)
		const root = utils.container.querySelector("[data-export-root]")
		expect(root?.contains(utils.getByTestId("chart"))).toBe(true)
		expect(utils.getAllByRole("row")).toHaveLength(3) // header + 2
		expect(utils.queryByRole("tab")).toBeNull()
		expect(utils.queryByRole("button")).toBeNull()
		expect(utils.getByText("First 2 of 3 rows")).toBeTruthy()
	})
})
