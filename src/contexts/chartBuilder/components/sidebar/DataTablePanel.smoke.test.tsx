import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	DEFAULT_DATA_TABLE_CONFIG,
	type DataTableConfig,
} from "../../lib/dataTableConfig"
import { buildDataset } from "../../../../testSupport/fixtures"
import { emptyEncodings } from "../../lib/types"
import { LIGHT_THEME_BASE } from "../../lib/systemThemes"
import { dataTableConfigFromTheme } from "../../lib/themeConfig"
import type { Theme } from "../../lib/types"
import {
	currentDataTableConfigAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	themeAtom,
} from "../../store/atoms"

import { DataTablePanel } from "./DataTablePanel"

afterEach(cleanup)

const mount = (cfg: Partial<DataTableConfig> = {}) => {
	installInMemoryLocalStorage()
	const captured: { store?: TestStore } = {}
	const utils = render(
		<TestProvider
			initializeState={(s) => {
				captured.store = s
				// `currentThemeIdAtom` defaults null, so `useCurrentTheme` falls back to
				// the legacy `themeAtom`. Pin the NEUTRAL base there: these tests describe
				// the table against a theme that sets nothing, and the bundled system
				// themes pin several data-table rows of their own.
				s.set(themeAtom, LIGHT_THEME_BASE)
				s.set(currentDataTableConfigAtom, { ...DEFAULT_DATA_TABLE_CONFIG, ...cfg })
			}}
		>
			<DataTablePanel />
		</TestProvider>
	)
	return { ...utils, store: captured.store! }
}

/** The styling subsections start collapsed; open them by header. */
const openSections = (
	utils: ReturnType<typeof render>,
	...titles: string[]
) => {
	for (const t of titles) fireEvent.click(utils.getByRole("button", { name: t }))
}

describe("DataTablePanel", () => {
	it("shows only the master toggle while the table is off", () => {
		const utils = mount()
		const toggle = utils.getByLabelText(
			"Show a data table"
		) as HTMLInputElement
		expect(toggle.checked).toBe(false)
		expect(utils.queryByLabelText("Placement")).toBeNull()
		expect(utils.queryByLabelText("Caption")).toBeNull()
		expect(utils.queryByText("Table text")).toBeNull()
	})

	it("orders the groups Title, Header, Table text, Rows, Caption", () => {
		const utils = mount({ enabled: true })
		const titles = utils
			.getAllByRole("button")
			.map((b) => b.textContent?.trim())
			.filter((t) => ["Title", "Header", "Table text", "Rows", "Caption"].includes(t ?? ""))
		expect(titles).toEqual(["Title", "Header", "Table text", "Rows", "Caption"])
	})

	it("reveals every option once enabled, and writes through", () => {
		const utils = mount()
		fireEvent.click(utils.getByLabelText("Show a data table"))
		expect(utils.store.get(currentDataTableConfigAtom).enabled).toBe(true)
		for (const label of ["Placement", "Columns", "Max rows"])
			expect(utils.getByLabelText(label)).toBeTruthy()
		expect(utils.getByText("Table text")).toBeTruthy()
		expect(utils.getByText("Header")).toBeTruthy()
		expect(utils.getByText("Rows")).toBeTruthy()

		fireEvent.change(utils.getByLabelText("Columns"), { target: { value: "all" } })
		expect(utils.store.get(currentDataTableConfigAtom).columns).toBe("all")
	})

	it("hides Stripe color while rows aren't striped", () => {
		const utils = mount({ enabled: true, striped: false })
		openSections(utils, "Rows")
		expect(utils.queryByLabelText("Stripe color")).toBeNull()
	})

	it("Header: font, and a bottom line whose color hides at thickness 0", () => {
		const utils = mount({ enabled: true })
		openSections(utils, "Header")
		const weight = utils.getByLabelText("Weight") as HTMLSelectElement
		expect(weight.value).toBe("600")
		fireEvent.change(weight, { target: { value: "400" } })
		expect(utils.store.get(currentDataTableConfigAtom).headerFontWeight).toBe(400)
		fireEvent.change(utils.getByLabelText("Weight"), { target: { value: "600" } })
		expect(utils.store.get(currentDataTableConfigAtom).headerFontWeight).toBeNull()
		fireEvent.change(utils.getByLabelText("Size"), { target: { value: "13" } })
		expect(utils.store.get(currentDataTableConfigAtom).headerFontSize).toBe(13)

		const thickness = utils.getByLabelText("Thickness") as HTMLInputElement
		expect(thickness.placeholder).toBe("2")
		expect(utils.getByLabelText("Text color")).toBeTruthy()
		expect(utils.getByLabelText("Color")).toBeTruthy() // the line's
		fireEvent.change(thickness, { target: { value: "0" } })
		expect(utils.store.get(currentDataTableConfigAtom).headerBorderWidth).toBe(0)
		expect(utils.queryByLabelText("Color")).toBeNull()
	})

	it("first column: unchecking reveals its own font; overrides offer reset", () => {
		const utils = mount({ enabled: true })
		openSections(utils, "Table text")
		const box = utils.getByLabelText(
			"Format first column like other columns"
		) as HTMLInputElement
		expect(box.checked).toBe(true)
		expect(utils.queryByText("First column")).toBeNull()
		expect(utils.queryByLabelText("Reset Format first column like other columns")).toBeNull()

		fireEvent.click(box)
		expect(utils.store.get(currentDataTableConfigAtom).firstColumnLikeOthers).toBe(false)
		expect(utils.getByText("First column")).toBeTruthy()
		fireEvent.change(utils.getAllByLabelText("Weight")[1]!, { target: { value: "700" } })
		expect(utils.store.get(currentDataTableConfigAtom).firstColumnFontWeight).toBe(700)

		fireEvent.click(utils.getByLabelText("Reset First column weight"))
		expect(utils.store.get(currentDataTableConfigAtom).firstColumnFontWeight).toBeNull()
		fireEvent.click(utils.getByLabelText("Reset Format first column like other columns"))
		expect(utils.store.get(currentDataTableConfigAtom).firstColumnLikeOthers).toBeNull()
		expect(utils.queryByText("First column")).toBeNull()
	})

	it("every theme-backed override offers reset, and reset follows the theme again", () => {
		const utils = mount({
			enabled: true,
			fontSize: 14,
			headerBackground: "#eeeeee",
			headerBorderWidth: 1,
			borderColor: "#cccccc",
			striped: false,
			titleAlign: "center",
		})
		openSections(utils, "Title", "Header", "Table text", "Rows")
		expect(utils.queryByLabelText("Reset Table text family")).toBeNull()
		for (const [label, key] of [
			["Reset Table text size", "fontSize"],
			["Reset Header background", "headerBackground"],
			["Reset Bottom line thickness", "headerBorderWidth"],
			["Reset Border color", "borderColor"],
			["Reset Striped rows", "striped"],
			["Reset Title alignment", "titleAlign"],
		] as const) {
			fireEvent.click(utils.getByLabelText(label))
			expect(utils.store.get(currentDataTableConfigAtom)[key]).toBeNull()
			expect(utils.queryByLabelText(label)).toBeNull()
		}
	})

	it("Striped follows the theme", () => {
		const utils = mount({ enabled: true })
		openSections(utils, "Rows")
		fireEvent.click(utils.getByLabelText("Striped rows"))
		expect(utils.store.get(currentDataTableConfigAtom).striped).toBe(false)
		expect(utils.queryByLabelText("Stripe color")).toBeNull()
	})

	it("Title holds the text above the table and its own styling, stored sparse", () => {
		const utils = mount({ enabled: true })
		openSections(utils, "Title")
		fireEvent.change(utils.getByLabelText("Text"), {
			target: { value: "Sales by region" },
		})
		expect(utils.store.get(currentDataTableConfigAtom).title).toBe("Sales by region")
		expect(utils.store.get(currentDataTableConfigAtom).caption).toBeNull()
		const weight = utils.getByLabelText("Weight") as HTMLSelectElement
		expect(weight.value).toBe("600")
		fireEvent.change(weight, { target: { value: "400" } })
		expect(utils.store.get(currentDataTableConfigAtom).titleFontWeight).toBe(400)
		fireEvent.change(utils.getByLabelText("Weight"), { target: { value: "600" } })
		expect(utils.store.get(currentDataTableConfigAtom).titleFontWeight).toBeNull()
	})

	it("Caption below the table: styling appears once it has text", () => {
		const utils = mount({ enabled: true })
		openSections(utils, "Caption")
		expect(utils.queryByLabelText("Weight")).toBeNull()
		fireEvent.change(utils.getByLabelText("Text"), {
			target: { value: "Source: survey" },
		})
		expect(utils.store.get(currentDataTableConfigAtom).caption).toBe("Source: survey")
		const weight = utils.getByLabelText("Weight") as HTMLSelectElement
		expect(weight.value).toBe("400")
		fireEvent.change(weight, { target: { value: "700" } })
		expect(utils.store.get(currentDataTableConfigAtom).captionFontWeight).toBe(700)
	})

	it("Table text has a weight that follows the theme", () => {
		const utils = mount({ enabled: true })
		openSections(utils, "Table text")
		fireEvent.change(utils.getByLabelText("Weight"), { target: { value: "300" } })
		expect(utils.store.get(currentDataTableConfigAtom).fontWeight).toBe(300)
		fireEvent.change(utils.getByLabelText("Weight"), { target: { value: "400" } })
		expect(utils.store.get(currentDataTableConfigAtom).fontWeight).toBeNull()
	})

	it("lists every column with its own alignment: text left, numbers right, stored sparse", () => {
		installInMemoryLocalStorage()
		const captured: { store?: TestStore } = {}
		const utils = render(
			<TestProvider
				initializeState={(s) => {
					captured.store = s
					s.set(loadedDatasetsAtom, {
						ds: buildDataset({
							id: "ds",
							name: "d",
							fields: [
								{ name: "region", inferredType: "categorical" },
								{ name: "sales", inferredType: "quantitative" },
							],
							rows: [{ region: "West", sales: "1" }],
						}),
					})
					s.set(currentDatasetIdAtom, "ds")
					s.set(previewVersionIdAtom, null)
					s.set(currentEncodingsAtom, {
						...emptyEncodings(),
						x: { field: "region" },
						y: { field: "sales" },
					})
					s.set(currentDataTableConfigAtom, { ...DEFAULT_DATA_TABLE_CONFIG, enabled: true })
				}}
			>
				<DataTablePanel />
			</TestProvider>
		)
		openSections(utils, "Table text")
		expect(utils.queryByText("Numbers")).toBeNull()
		const row = (name: string) => within(utils.getByText(name, { exact: true }).parentElement!)
		const pressed = (name: string) =>
			row(name)
				.getAllByRole("button")
				.find((b) => b.getAttribute("aria-pressed") === "true")
				?.getAttribute("aria-label")
		expect(pressed("region")).toMatch(/left/i)
		expect(pressed("sales")).toMatch(/right/i)

		const store = captured.store!
		fireEvent.click(row("region").getByRole("button", { name: /center/i }))
		expect(store.get(currentDataTableConfigAtom).columnAlign).toEqual({ region: "center" })
		fireEvent.click(row("sales").getByRole("button", { name: /left/i }))
		expect(store.get(currentDataTableConfigAtom).columnAlign).toEqual({
			region: "center",
			sales: "left",
		})
		// Back to a column's default drops its entry.
		fireEvent.click(row("region").getByRole("button", { name: /left/i }))
		fireEvent.click(row("sales").getByRole("button", { name: /right/i }))
		expect(store.get(currentDataTableConfigAtom).columnAlign).toEqual({})
	})

	it('"Select variables" seeds from the current table and keeps at least one', () => {
		installInMemoryLocalStorage()
		const captured: { store?: TestStore } = {}
		const utils = render(
			<TestProvider
				initializeState={(s) => {
					captured.store = s
					s.set(loadedDatasetsAtom, {
						ds: buildDataset({
							id: "ds",
							name: "d",
							fields: [
								{ name: "region", inferredType: "categorical" },
								{ name: "sales", inferredType: "quantitative" },
								{ name: "notes", inferredType: "categorical" },
							],
							rows: [{ region: "West", sales: "1", notes: "x" }],
						}),
					})
					s.set(currentDatasetIdAtom, "ds")
					s.set(previewVersionIdAtom, null)
					s.set(currentEncodingsAtom, {
						...emptyEncodings(),
						x: { field: "region" },
						y: { field: "sales" },
					})
					s.set(currentDataTableConfigAtom, { ...DEFAULT_DATA_TABLE_CONFIG, enabled: true })
				}}
			>
				<DataTablePanel />
			</TestProvider>
		)
		const store = captured.store!
		const box = (name: string) => utils.getByLabelText(name) as HTMLInputElement
		expect(utils.queryByLabelText("notes")).toBeNull()

		fireEvent.change(utils.getByLabelText("Columns"), { target: { value: "select" } })
		expect(store.get(currentDataTableConfigAtom)).toMatchObject({
			columns: "select",
			selectedColumns: ["region", "sales"],
		})
		expect(box("region").checked).toBe(true)
		expect(box("notes").checked).toBe(false)

		fireEvent.click(box("notes"))
		fireEvent.click(box("sales"))
		expect(store.get(currentDataTableConfigAtom).selectedColumns).toEqual([
			"region",
			"notes",
		])
		fireEvent.click(box("region"))
		expect(box("notes").disabled).toBe(true)
	})

	it("offers All / Select columns over the computed columns on an aggregating chart", () => {
		installInMemoryLocalStorage()
		const captured: { store?: TestStore } = {}
		const utils = render(
			<TestProvider
				initializeState={(s) => {
					captured.store = s
					s.set(loadedDatasetsAtom, {
						ds: buildDataset({
							id: "ds",
							name: "d",
							fields: [
								{ name: "region", inferredType: "categorical" },
								{ name: "sales", inferredType: "quantitative" },
							],
							rows: [{ region: "West", sales: "1" }],
						}),
					})
					s.set(currentDatasetIdAtom, "ds")
					s.set(previewVersionIdAtom, null)
					s.set(currentEncodingsAtom, {
						...emptyEncodings(),
						x: { field: "region" },
						length: { field: "sales" },
					})
					s.set(currentDataTableConfigAtom, { ...DEFAULT_DATA_TABLE_CONFIG, enabled: true })
				}}
			>
				<DataTablePanel />
			</TestProvider>
		)
		expect(utils.getByText(/aggregates its data/)).toBeTruthy()
		const picker = utils.getByLabelText("Columns") as HTMLSelectElement
		expect([...picker.options].map((o) => o.text)).toEqual(["All columns", "Select columns"])
		expect(utils.queryByRole("checkbox", { name: "region" })).toBeNull()

		fireEvent.change(picker, { target: { value: "select" } })
		const boxes = utils.getAllByRole("checkbox", { checked: true }) as HTMLInputElement[]
		const names = boxes.map((b) => b.labels?.[0]?.textContent ?? "")
		const computed = names.find((n) => n !== "region" && n.includes("sales"))
		expect(computed).toBeTruthy()
		fireEvent.click(utils.getByLabelText(computed!))
		expect(captured.store!.get(currentDataTableConfigAtom)).toMatchObject({
			plottedColumns: "select",
			hiddenPlottedColumns: [computed],
		})
		expect((utils.getByLabelText(computed!) as HTMLInputElement).checked).toBe(false)
	})
})

describe("DataTablePanel — theme-seeded defaults", () => {
	const THEMED: Theme = {
		...LIGHT_THEME_BASE,
		dataTableEnabled: true,
		dataTablePlacement: "tabs",
		dataTableMaxRows: null,
		dataTableShowDownload: false,
	}
	const mountSeeded = () => {
		installInMemoryLocalStorage()
		const captured: { store?: TestStore } = {}
		const utils = render(
			<TestProvider
				initializeState={(s) => {
					captured.store = s
					s.set(themeAtom, THEMED)
					s.set(currentDataTableConfigAtom, dataTableConfigFromTheme(THEMED))
				}}
			>
				<DataTablePanel />
			</TestProvider>
		)
		return { ...utils, store: captured.store! }
	}
	const dot = (utils: ReturnType<typeof render>, title: string) =>
		utils.getByRole("button", { name: title }).querySelector("span.rounded-full")

	it("a fresh chart on the theme starts there with no changed dot", () => {
		const utils = mountSeeded()
		expect((utils.getByLabelText("Show a data table") as HTMLInputElement).checked).toBe(true)
		expect((utils.getByLabelText("Placement") as HTMLSelectElement).value).toBe("tabs")
		// null = All: the box is empty, showing the "All" placeholder.
		expect((utils.getByLabelText("Max rows") as HTMLInputElement).value).toBe("")
		expect((utils.getByLabelText("Download link") as HTMLInputElement).checked).toBe(false)
		expect(dot(utils, "Table properties")).toBeNull()
	})

	it("deviating from the theme lights the dot; returning to it clears it", () => {
		const utils = mountSeeded()
		fireEvent.change(utils.getByLabelText("Placement"), { target: { value: "below" } })
		expect(dot(utils, "Table properties")).not.toBeNull()
		fireEvent.change(utils.getByLabelText("Placement"), { target: { value: "tabs" } })
		expect(dot(utils, "Table properties")).toBeNull()
		fireEvent.change(utils.getByLabelText("Max rows"), { target: { value: "10" } })
		expect(dot(utils, "Table properties")).not.toBeNull()
	})
})
