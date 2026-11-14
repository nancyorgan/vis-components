import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { DEFAULT_DISTRIBUTION_OVERLAY_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { LIGHT_THEME_BASE } from "../../lib/systemThemes"
import { axisConfigFromTheme } from "../../lib/themeConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Size → *Mark* outline → "Vary by": the outline's thickness per level of
 *  a variable, on every mark that has an outline.
 *
 *  The thickness was one number read straight off the config by each
 *  renderer, so it could not vary. It is resolved per mark now, by the one
 *  outline resolver (`lib/markOutline`), off the mark's row — its first
 *  row, for a mark built from many. One chart per kind of mark, through
 *  the production render path. */

const ID = "ds-outline-thickness"
const OUTLINE = "#ff0000"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "marks",
		filename: "marks.csv",
		fields: [
			{ name: "day", inferredType: "categorical" },
			{ name: "slot", inferredType: "categorical" },
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
			{ name: "tier", inferredType: "categorical" },
		],
		rows: [
			{ day: "Mon", slot: "AM", x: "1", y: "10", tier: "gold" },
			{ day: "Mon", slot: "PM", x: "2", y: "20", tier: "silver" },
			{ day: "Tue", slot: "AM", x: "3", y: "30", tier: "gold" },
			{ day: "Tue", slot: "PM", x: "4", y: "40", tier: "silver" },
		],
	})

/** gold outlines 5 px, silver 0.5 px; anything else the single 2 px. */
const VARIED = {
	outlineColor: OUTLINE,
	outlineWidth: 2,
	outlineWidthField: "tier",
	outlineWidthByValue: { gold: 5, silver: 0.5 },
}

const mount = (encodings: Partial<Encodings>, shape: Record<string, unknown> = VARIED) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", { ...emptyEncodings(), ...encodings })
	set("vis-components:currentChannelConfigs", { shape })
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable @vc/use-wrapped-json-functions */
	return render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	).container
}

/** The stroke widths of everything drawn in the outline color, sorted. */
const outlineWidths = (container: HTMLElement): string[] =>
	[...container.querySelectorAll("svg *")]
		.filter((el) => el.getAttribute("stroke") === OUTLINE)
		.map((el) => el.getAttribute("stroke-width") ?? "")
		.sort()

describe("outline thickness — Vary by, on every outlined mark", () => {
	it("scatter points", () => {
		const c = mount({ x: { field: "x" }, y: { field: "y" } })
		expect(outlineWidths(c)).toEqual(["0.5", "0.5", "5", "5"])
	})

	it("bar segments (each reads its first row)", () => {
		const c = mount({ x: { field: "day" }, length: { field: "y" }, hue: { field: "tier" } })
		expect(outlineWidths(c)).toEqual(["0.5", "0.5", "5", "5"])
	})

	it("pie slices", () => {
		const c = mount({ angle: { field: "y" }, hue: { field: "tier" } })
		expect(outlineWidths(c)).toEqual(["0.5", "5"])
	})

	it("heatmap cells", () => {
		const c = mount({ x: { field: "day" }, y: { field: "slot" }, hue: { field: "y" } })
		expect(outlineWidths(c)).toEqual(["0.5", "0.5", "5", "5"])
	})

	it("the points along a line", () => {
		const c = mount({ x: { field: "x" }, y: { field: "y" }, connection: { field: "tier" } })
		expect(outlineWidths(c)).toEqual(["0.5", "0.5", "5", "5"])
	})

	it("a level with no thickness of its own takes the single one", () => {
		const c = mount(
			{ x: { field: "x" }, y: { field: "y" } },
			{ ...VARIED, outlineWidthByValue: { gold: 5 } }
		)
		expect(outlineWidths(c)).toEqual(["2", "2", "5", "5"])
	})

	it("with no variable picked, every outline is the single thickness", () => {
		const c = mount(
			{ x: { field: "x" }, y: { field: "y" } },
			{ outlineColor: OUTLINE, outlineWidth: 2 }
		)
		expect(outlineWidths(c)).toEqual(["2", "2", "2", "2"])
	})
})

/** The overlays' strokes have a thickness of their own too (Size → Stem,
 *  Size → Density curve outline). Stems drew at the line's thickness and
 *  the density curve at a fixed 2 px. */
describe("overlay strokes — their own thickness", () => {
	const mountWith = (encodings: Partial<Encodings>, channelConfigs: Record<string, unknown>) => {
		const store = installInMemoryLocalStorage()
		/* eslint-disable @vc/use-wrapped-json-functions */
		const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
		set("vis-components:datasets", { [ID]: buildDataset() })
		set("vis-components:currentDatasetId", ID)
		set("vis-components:previewVersionId", null)
		set("vis-components:currentEncodings", { ...emptyEncodings(), ...encodings })
		set("vis-components:currentChannelConfigs", channelConfigs)
		set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
		/* eslint-enable @vc/use-wrapped-json-functions */
		return render(
			<TestProvider>
				<div style={{ width: 800, height: 600 }}>
					<ChartCanvas />
				</div>
			</TestProvider>
		).container
	}
	const STEM = "#00aa00"
	const stemWidths = (c: HTMLElement): string[] =>
		[...c.querySelectorAll("svg line")]
			.filter((el) => el.getAttribute("stroke") === STEM)
			.map((el) => el.getAttribute("stroke-width") ?? "")
	const stems = (connection: Record<string, unknown>) =>
		mountWith(
			{ x: { field: "x" }, y: { field: "y" } },
			{
				connection: { axisStem: "x-axis", ...connection },
				colorSlots: { stem: { field: null, singleColor: STEM } },
			}
		)

	it("stems follow the line's thickness until they are given one", () => {
		expect(new Set(stemWidths(stems({ thickness: 4 })))).toEqual(new Set(["4"]))
	})

	it("Size → Stem sets the stems apart from the line", () => {
		const widths = stemWidths(stems({ thickness: 4, stemThickness: 1.5 }))
		expect(widths.length).toBe(4)
		expect(new Set(widths)).toEqual(new Set(["1.5"]))
	})

	const CURVE = "#aa00aa"
	const curveWidths = (c: HTMLElement): string[] =>
		[...c.querySelectorAll("svg path")]
			.filter((el) => el.getAttribute("stroke") === CURVE)
			.map((el) => el.getAttribute("stroke-width") ?? "")
	// The standalone "Density" display: a full x-axis config with the curve
	// switched on (a partial axis config would lack the fields the axis reads).
	const density = (shape: Record<string, unknown>) =>
		mountWith(
			{ x: { field: "y" } },
			{
				x: {
					...axisConfigFromTheme(LIGHT_THEME_BASE, "x"),
					distributionOverlay: { ...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG, showDensityCurve: true },
				},
				colorSlots: { densityCurveStroke: { field: null, singleColor: CURVE } },
				shape,
			}
		)

	it("the density curve draws 2 px until a thickness is set", () => {
		expect(curveWidths(density({}))).toEqual(["2"])
	})

	it("Size → Density curve outline sets the curve's thickness", () => {
		expect(curveWidths(density({ densityCurveOutlineWidth: 5 }))).toEqual(["5"])
	})
})
