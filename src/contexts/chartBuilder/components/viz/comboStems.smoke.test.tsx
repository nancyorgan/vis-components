import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** "Connect points to axis" on a bar + line chart: the sticks from each
 *  point to the axis take the Stem's color, opacity, saturation and
 *  brightness — the same settings they take on a scatter or a line chart.
 *  (Only their thickness could be set here before: the four menus did not
 *  list the Stem on a combo, and the combo did not shade its stems.) */

const ID = "ds-combo-stems"
// A mid-saturation, mid-brightness green, so both shadings have room to move it.
const STEM = "#4f9f6f"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "quarter", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "profit", inferredType: "quantitative" },
		],
		rows: [
			{ quarter: "Q1", sales: "10", profit: "3" },
			{ quarter: "Q2", sales: "20", profit: "5" },
			{ quarter: "Q3", sales: "30", profit: "4" },
			{ quarter: "Q4", sales: "40", profit: "8" },
		],
	})

/** Bars of sales by quarter, with profit as points over them (Length →
 *  "Draw as: bars" is what makes x + y + length a combo, not line segments). */
const COMBO: Partial<Encodings> = {
	x: { field: "quarter" },
	length: { field: "sales" },
	y: { field: "profit" },
}

const mount = (channelConfigs: Record<string, unknown>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", { ...emptyEncodings(), ...COMBO })
	set("vis-components:currentChannelConfigs", {
		length: { render: "bars" },
		connection: { axisStem: "x-axis" },
		...channelConfigs,
	})
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

const stems = (c: HTMLElement): Element[] => [...c.querySelectorAll("svg line.vc-axis-stem")]
const attrs = (c: HTMLElement, name: string): Set<string | null> =>
	new Set(stems(c).map((el) => el.getAttribute(name)))

describe("stems on a bar + line chart", () => {
	it("are drawn over the bars, one per point", () => {
		const c = mount({})
		expect(c.querySelector("[data-combo-marks]")).not.toBeNull()
		expect(stems(c).length).toBe(4)
	})

	it("take the Stem color", () => {
		const c = mount({ colorSlots: { stem: { field: null, singleColor: STEM } } })
		expect(attrs(c, "stroke")).toEqual(new Set([STEM]))
	})

	it("take the Stem opacity", () => {
		const c = mount({ opacitySlots: { stem: { field: null, level: 0.4 } } })
		expect(attrs(c, "opacity")).toEqual(new Set(["0.4"]))
	})

	it.each([
		["saturationSlots", 0.1],
		["brightnessSlots", 0.9],
	] as const)("are shaded by the Stem's %s", (slots, level) => {
		const c = mount({
			colorSlots: { stem: { field: null, singleColor: STEM } },
			[slots]: { stem: { field: null, level } },
		})
		const strokes = attrs(c, "stroke")
		// One shade for every stem, and not the unshaded color.
		expect(strokes.size).toBe(1)
		expect(strokes.has(STEM)).toBe(false)
	})
})
