import { cleanup, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { ConnectionOptionsPanel } from "./ConnectionOptionsPanel"
import { AreaOptionsPanel } from "./RangePanel"
import { ShapeOptionsPanel } from "./ShapeOptionsPanel"

/** Every thickness lives under Size: one section per stroke the chart
 *  draws, each the same control (a single value, or "Vary by" a variable
 *  with one value per level). The panels the thicknesses used to live in
 *  (Connection, Shape, Length, Color) point here instead.
 *
 *  The Line section's "Vary by" lists the connection field AND every other
 *  categorical / ordinal variable (a line's thickness resolves off its
 *  representative row, like the line color slot), stores the pick in
 *  `thicknessField`, and still reads a legacy visual whose only trace of
 *  "vary by" is a populated `thicknessByValue` map as varying by the
 *  connection field. */

const DATASET_ID = "ds-connection-thickness"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "month", inferredType: "quantitative" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
			{ name: "segment", inferredType: "categorical" },
		],
		// Two lines (north / south); `segment` is constant within each line.
		rows: Array.from({ length: 8 }, (_, i) => ({
			month: String((i % 4) + 1),
			sales: String(10 * i),
			region: i < 4 ? "north" : "south",
			segment: i < 4 ? "retail" : "wholesale",
		})),
	})

const seed = (encodings: Encodings, configs: Record<string, unknown> = {}) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	return store
}

// Datasets hydrate asynchronously — settle a tick before asserting, and scope
// queries to this render's container.
const mount = async (panel: React.ReactNode = <AreaOptionsPanel />) => {
	const { container } = render(<TestProvider>{panel}</TestProvider>)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

type Q = Awaited<ReturnType<typeof mount>>

/** The section titles the panel shows, in order. */
const sectionTitles = (q: Q): string[] =>
	q.getAllByRole("button", { expanded: undefined }).flatMap((b) =>
		b.hasAttribute("aria-expanded") ? [b.textContent?.trim() ?? ""] : []
	)

/** Open one section and return queries scoped to it. */
const openSection = async (q: Q, title: string) => {
	const header = q
		.getAllByRole("button")
		.find((b) => b.hasAttribute("aria-expanded") && b.textContent?.trim() === title)
	if (!header) throw new Error(`no "${title}" section; have: ${sectionTitles(q).join(", ")}`)
	if (header.getAttribute("aria-expanded") === "false") header.click()
	await new Promise((r) => setTimeout(r, 0))
	// header button → header row → the subsection root.
	return within(header.parentElement!.parentElement!)
}

afterEach(cleanup)

/** `x + y + connection` → scatter mode: one polyline per `region`. */
const LINE_CHART: Encodings = {
	...emptyEncodings(),
	x: { field: "month" },
	y: { field: "sales" },
	connection: { field: "region" },
}
const SCATTER: Encodings = { ...emptyEncodings(), x: { field: "month" }, y: { field: "sales" } }
const BARS: Encodings = { ...emptyEncodings(), x: { field: "region" }, length: { field: "sales" } }
const SEGMENTS: Encodings = {
	...emptyEncodings(),
	x: { field: "month" },
	y: { field: "sales" },
	length: { field: "sales" },
}

describe("Size panel — one section per stroke", () => {
	it("a line chart: the point's size, then the Line and the Point outline", async () => {
		seed(LINE_CHART)
		const q = await mount()
		expect(sectionTitles(q)).toEqual(["Point", "Line", "Point outline"])
		// The size leads, open.
		expect(q.getByLabelText("Size")).not.toBeNull()
	})

	it("a scatter: no line, so no Line section", async () => {
		seed(SCATTER)
		const q = await mount()
		expect(sectionTitles(q)).toEqual(["Point", "Point outline"])
	})

	it("bars: no points to size, but the bars' outline has a thickness", async () => {
		seed(BARS)
		const q = await mount()
		expect(sectionTitles(q)).toEqual(["Bar outline"])
		expect(q.getByText(/draws no points/)).not.toBeNull()
		const outline = await openSection(q, "Bar outline")
		// The theme's outline thickness until it is edited.
		expect((outline.getByLabelText("Thickness") as HTMLInputElement).value).toBe("1.5")
	})

	it("stems have a thickness of their own, following the line's until it is set", async () => {
		seed(SCATTER, { connection: { axisStem: "x-axis" } })
		expect(sectionTitles(await mount())).toEqual(["Point", "Point outline", "Stem"])
		cleanup()
		seed(LINE_CHART, { connection: { axisStem: "x-axis", thickness: 4 } })
		const q = await mount()
		expect(sectionTitles(q)).toEqual(["Point", "Line", "Point outline", "Stem"])
		const stem = await openSection(q, "Stem")
		// Untouched: the line's thickness, and it says so.
		expect((stem.getByLabelText("Thickness") as HTMLInputElement).value).toBe("4")
		expect(stem.getByText(/Following the line.s thickness/)).not.toBeNull()
		cleanup()
		seed(LINE_CHART, { connection: { axisStem: "x-axis", thickness: 4, stemThickness: 1 } })
		const own = await openSection(await mount(), "Stem")
		expect((own.getByLabelText("Thickness") as HTMLInputElement).value).toBe("1")
		expect(own.queryByText(/Following the line/)).toBeNull()
		expect(own.getByRole("button", { name: "Reset stem thickness" })).not.toBeNull()
	})

	it("line segments: the Segment's thickness, with Vary by", async () => {
		seed(SEGMENTS)
		const q = await mount()
		expect(sectionTitles(q)).toEqual(["Segment"])
		const segment = await openSection(q, "Segment")
		expect((segment.getByLabelText("Thickness") as HTMLInputElement).value).toBe("3")
		// Vary by lists the discrete variables only.
		const varyBy = segment.getByLabelText("Vary by") as HTMLSelectElement
		expect([...varyBy.options].map((o) => o.value)).toEqual(["", "region", "segment"])
	})

	it("segments, vary by: one thickness row per level replaces the single input", async () => {
		seed(SEGMENTS, {
			length: {
				minLength: 4,
				maxLength: 40,
				segmentThicknessField: "region",
				segmentThicknessByValue: { north: 2, south: 6 },
			},
		})
		const segment = await openSection(await mount(), "Segment")
		expect(segment.queryByLabelText("Thickness")).toBeNull()
		expect((segment.getByLabelText("Segment thickness for north") as HTMLInputElement).value).toBe("2")
		expect((segment.getByLabelText("Segment thickness for south") as HTMLInputElement).value).toBe("6")
	})

	it("the overlays' strokes are listed while the overlay is on", async () => {
		seed(SCATTER, {
			x: { regression: { enabled: true, strokeWidth: 4 } },
			y: { distributionOverlay: { showBoxPlot: true } },
		})
		const q = await mount()
		expect(sectionTitles(q)).toEqual([
			"Point",
			"Point outline",
			"Regression line",
			"Violin / box outline",
		])
		const regression = await openSection(q, "Regression line")
		expect((regression.getByLabelText("Thickness") as HTMLInputElement).value).toBe("4")
	})
})

describe("Size panel — outline thickness Vary by", () => {
	it("a bar's outline can vary by any discrete variable", async () => {
		seed(BARS)
		const outline = await openSection(await mount(), "Bar outline")
		const varyBy = outline.getByLabelText("Vary by") as HTMLSelectElement
		expect([...varyBy.options].map((o) => o.value)).toEqual(["", "region", "segment"])
		expect(varyBy.value).toBe("")
	})

	it("picked: one thickness row per level replaces the single input", async () => {
		seed(BARS, {
			shape: {
				outlineWidth: 2,
				outlineWidthField: "segment",
				outlineWidthByValue: { retail: 1, wholesale: 4 },
			},
		})
		const outline = await openSection(await mount(), "Bar outline")
		expect((outline.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("segment")
		expect(outline.queryByLabelText("Thickness")).toBeNull()
		expect(
			(outline.getByLabelText("Bar outline thickness for retail") as HTMLInputElement).value
		).toBe("1")
		expect(
			(outline.getByLabelText("Bar outline thickness for wholesale") as HTMLInputElement).value
		).toBe("4")
	})

	it("a stored variable that is gone from the data set reads as — none —", async () => {
		seed(BARS, { shape: { outlineWidth: 2, outlineWidthField: "gone", outlineWidthByValue: { a: 9 } } })
		const outline = await openSection(await mount(), "Bar outline")
		expect((outline.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("")
		expect((outline.getByLabelText("Thickness") as HTMLInputElement).value).toBe("2")
	})
})

describe("Size panel — Line thickness Vary by", () => {
	it("lists the connection field and every other categorical variable", async () => {
		seed(LINE_CHART)
		const line = await openSection(await mount(), "Line")
		const varyBy = line.getByLabelText("Vary by") as HTMLSelectElement
		// Quantitative month / sales stand down; region (connection) and
		// segment (another categorical) are both offered.
		expect([...varyBy.options].map((o) => o.value)).toEqual(["", "region", "segment"])
		expect(varyBy.value).toBe("")
		expect(line.getByLabelText("Thickness")).not.toBeNull()
	})

	it("vary by a NON-connection field: one thickness row per level of that field", async () => {
		seed(LINE_CHART, {
			connection: {
				thicknessField: "segment",
				thicknessByValue: { retail: 3, wholesale: 7 },
			},
		})
		const line = await openSection(await mount(), "Line")
		expect((line.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("segment")
		expect(line.queryByLabelText("Thickness")).toBeNull()
		expect((line.getByLabelText("Line thickness for retail") as HTMLInputElement).value).toBe("3")
		expect((line.getByLabelText("Line thickness for wholesale") as HTMLInputElement).value).toBe("7")
		expect(line.queryByLabelText("Line thickness for north")).toBeNull()
	})

	it("legacy visual (populated map, no field) reads as vary by the connection field", async () => {
		seed(LINE_CHART, {
			connection: { thicknessByValue: { north: 2, south: 6 } },
		})
		const line = await openSection(await mount(), "Line")
		expect((line.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("region")
		expect((line.getByLabelText("Line thickness for north") as HTMLInputElement).value).toBe("2")
		expect((line.getByLabelText("Line thickness for south") as HTMLInputElement).value).toBe("6")
	})

	it("a stored field that's gone from the data set reads as — none —", async () => {
		seed(LINE_CHART, {
			connection: { thicknessField: "gone", thicknessByValue: { a: 1 } },
		})
		const line = await openSection(await mount(), "Line")
		expect((line.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("")
		expect(line.getByLabelText("Thickness")).not.toBeNull()
	})
})

describe("the panels thickness used to live in point at Size", () => {
	it("Connection → Line properties: smoothing and cap, and a link for the thickness", async () => {
		seed(LINE_CHART)
		const q = await mount(<ConnectionOptionsPanel />)
		const props = await openSection(q, "Line properties")
		expect(props.queryByLabelText("Line thickness")).toBeNull()
		expect(props.queryByLabelText("Thickness")).toBeNull()
		expect(props.getByLabelText("Smooth line")).not.toBeNull()
		expect(props.getByRole("button", { name: "Size → Line" })).not.toBeNull()
	})

	it("Shape: glyphs only, and a link for the outline thickness", async () => {
		seed(SCATTER)
		const q = await mount(<ShapeOptionsPanel />)
		expect(q.queryByLabelText("Outline thickness")).toBeNull()
		expect(q.getByRole("button", { name: "Size" })).not.toBeNull()
		expect(q.getByText("Default shape")).not.toBeNull()
	})

	it("Shape on bars: says there is no shape to pick, and still links the thickness", async () => {
		seed(BARS)
		const q = await mount(<ShapeOptionsPanel />)
		expect(q.getByText(/no shape to pick/)).not.toBeNull()
		expect(q.getByRole("button", { name: "Size" })).not.toBeNull()
	})
})
