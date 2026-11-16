import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { symbolPath } from "../../lib/scales"
import { emptyEncodings, type Dataset, type Encodings } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** The points along an area chart's lines are glyphs, like a line chart's:
 *  they take the Shape row's default shape, a Shape variable, and the
 *  default angle. They used to be circles whatever was picked (the Shape row
 *  was greyed out there, as Length is mapped), though the same points on a
 *  line chart took all three. */

const ID = "ds-area-point-shape"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "areas",
		filename: "areas.csv",
		fields: [
			{ name: "month", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
			{ name: "tier", inferredType: "categorical" },
		],
		rows: [
			{ month: "Jan", sales: "10", region: "north", tier: "gold" },
			{ month: "Feb", sales: "20", region: "north", tier: "gold" },
			{ month: "Jan", sales: "15", region: "south", tier: "silver" },
			{ month: "Feb", sales: "25", region: "south", tier: "silver" },
		],
	})

const AREA: Partial<Encodings> = {
	x: { field: "month" },
	length: { field: "sales" },
	connection: { field: "region" },
	hue: { field: "region" },
}

const mount = (configs: Record<string, unknown> = {}, encodings: Partial<Encodings> = {}) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", { ...emptyEncodings(), ...AREA, ...encodings })
	set("vis-components:currentChannelConfigs", configs)
	set("vis-components:currentLabels", {
		_v: 1,
		data: { ...DEFAULT_LABELS_CONFIG, xAxisTitle: "", yAxisTitle: "" },
	})
	/* eslint-enable @vc/use-wrapped-json-functions */
	return render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	).container
}

const points = (c: HTMLElement): Element[] => [...c.querySelectorAll("[data-area-point]")]
/** The glyph path each non-circle point draws. */
const glyphPaths = (c: HTMLElement): string[] =>
	points(c).map((p) => p.querySelector("path")?.getAttribute("d") ?? "")

describe("AreaPlot — the points' shape", () => {
	it("untouched, every point is the plain circle it always was", () => {
		const c = mount()
		const els = points(c)
		expect(els).toHaveLength(4)
		for (const el of els) expect(el.tagName.toLowerCase()).toBe("circle")
	})

	it("Shape → Default shape draws that glyph on every point", () => {
		const c = mount({ defaultShape: 1 })
		const els = points(c)
		expect(els).toHaveLength(4)
		for (const el of els) expect(el.tagName.toLowerCase()).toBe("g")
		const paths = glyphPaths(c)
		expect(new Set(paths).size).toBe(1)
		// The same symbol a scatter point of that shape and size draws.
		const r = Number(points(mount()).at(0)?.getAttribute("r"))
		expect(paths[0]).toBe(symbolPath(1, r))
	})

	it("a Shape variable gives each category its own glyph", () => {
		// gold = north's points, silver = south's.
		const c = mount({}, { shape: { field: "tier" } })
		const els = points(c)
		expect(els).toHaveLength(4)
		const circles = els.filter((el) => el.tagName.toLowerCase() === "circle")
		const glyphs = els.filter((el) => el.tagName.toLowerCase() === "g")
		// The first category keeps the first shape (the circle); the second
		// takes the next one.
		expect(circles).toHaveLength(2)
		expect(glyphs).toHaveLength(2)
	})

	it("the default angle turns the glyphs", () => {
		const c = mount({ defaultShape: 1, defaultAngle: 30 })
		const transforms = points(c).map((p) => p.firstElementChild?.getAttribute("transform") ?? "")
		expect(transforms).toHaveLength(4)
		for (const t of transforms) expect(t).toMatch(/rotate\(30\)$/)
	})

	it("a glyph keeps the point's fill, outline and size", () => {
		const shape = { outlineColor: "#ff0000", outlineWidth: 3 }
		const circle = points(mount({ shape })).at(0)!
		const glyph = points(mount({ shape, defaultShape: 2 })).at(0)!.querySelector("path")!
		for (const attr of ["fill", "stroke", "stroke-width", "fill-opacity", "stroke-opacity"])
			expect(glyph.getAttribute(attr), attr).toBe(circle.getAttribute(attr))
	})

	it("stays out of the way of the pointer, like the circles", () => {
		const c = mount({ defaultShape: 1 })
		for (const el of points(c)) expect(el.getAttribute("pointer-events")).toBe("none")
	})
})
