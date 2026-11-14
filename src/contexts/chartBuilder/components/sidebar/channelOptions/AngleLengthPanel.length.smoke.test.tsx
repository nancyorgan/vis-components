import { cleanup, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { LengthOptionsPanel } from "./AngleLengthPanel"

/** The Length panel's Min/Max px range only applies where the length scale is
 *  actually consumed (segment marks on scatter, the length legend ramp). In
 *  bar modes the mapped variable IS the bar length via the position scale, so
 *  the panel suppresses the inert range inputs and explains why. */

const DATASET_ID = "ds-length-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "region", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "profit", inferredType: "quantitative" },
		],
		rows: Array.from({ length: 6 }, (_, i) => ({
			region: i % 2 === 0 ? "East" : "West",
			sales: String(2 * i),
			profit: String(i),
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

// Datasets hydrate asynchronously (IndexedDB-backed persist effect) — settle
// a tick before asserting, and scope queries to this render's container.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<LengthOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

/** `x + length`, no y/angle → bars-x: the measure IS the bar length. */
const BARS: Encodings = {
	...emptyEncodings(),
	x: { field: "region" },
	length: { field: "sales" },
}

/** `x + y + length` → scatter with segment marks: px range applies. */
const SEGMENTS: Encodings = {
	...emptyEncodings(),
	x: { field: "sales" },
	y: { field: "profit" },
	length: { field: "sales" },
}

describe("Length panel — length variable mapped", () => {
	it("bar mode: hides the inert Min/Max px range", async () => {
		seed(BARS)
		const q = await mount()
		expect(q.queryByLabelText("Min")).toBeNull()
		expect(q.queryByLabelText("Max")).toBeNull()
	})

	it("segment mode: still offers the Min/Max px range", async () => {
		seed(SEGMENTS)
		const q = await mount()
		expect(q.queryByLabelText("Min")).not.toBeNull()
		expect(q.queryByLabelText("Max")).not.toBeNull()
	})
})

/** `x + y + length` is the one signature with two readings, so only there
 *  does the panel offer "Draw as" (Segments, the default, or Bars = a bar +
 *  marks combo). Plain bars never show it. */
describe("Length panel — Draw as (segments vs bars)", () => {
	it("offers Draw as on the segment scatter, defaulting to Segments", async () => {
		seed(SEGMENTS)
		const q = await mount()
		const group = q.getByRole("radiogroup", { name: "Draw length as" })
		expect(within(group).getByRole("radio", { name: "Segments" }).getAttribute("aria-checked")).toBe("true")
		expect(within(group).getByRole("radio", { name: "Bars" }).getAttribute("aria-checked")).toBe("false")
	})

	it("hides Draw as on plain bars (one position only)", async () => {
		seed(BARS)
		const q = await mount()
		expect(q.queryByRole("radiogroup", { name: "Draw length as" })).toBeNull()
	})

	it("with Bars chosen the chart is a combo: Draw as stays, the px range goes, the bar gap appears", async () => {
		seed(
			{ ...SEGMENTS, x: { field: "region" } },
			{ length: { minLength: 4, maxLength: 40, render: "bars" } }
		)
		const q = await mount()
		const group = q.getByRole("radiogroup", { name: "Draw length as" })
		expect(within(group).getByRole("radio", { name: "Bars" }).getAttribute("aria-checked")).toBe("true")
		expect(q.queryByLabelText("Min")).toBeNull()
		expect(q.queryByLabelText("Bar gap")).not.toBeNull()
	})
})

/** Quantitative `x` alone with the histogram toggle → bars-x with NO length
 *  field: bar length is the per-bin count. */
const HISTOGRAM: Encodings = {
	...emptyEncodings(),
	x: { field: "sales" },
}

/** `angle` alone → a single pie: nothing draws length. */
const PIE: Encodings = {
	...emptyEncodings(),
	angle: { field: "sales" },
}

describe("Length panel — mode trait decides, not the mapped field", () => {
	it("histogram (bars, no length field): no scatter default length, and no bar gap (bins abut)", async () => {
		seed(HISTOGRAM, { x: { histogram: { enabled: true } } })
		const q = await mount()
		expect(q.queryByLabelText("Length")).toBeNull()
		expect(q.queryByText(/line segments/)).toBeNull()
		expect(q.queryByLabelText("Bar gap")).toBeNull()
	})

	it("categorical bars with a length field: bar gap, no px range", async () => {
		seed(BARS)
		const q = await mount()
		expect(q.queryByLabelText("Bar gap")).not.toBeNull()
		expect(q.queryByLabelText("Min")).toBeNull()
	})

	it("pie: says length isn't drawn instead of showing inert controls", async () => {
		seed(PIE)
		const q = await mount()
		expect(q.queryByLabelText("Length")).toBeNull()
		expect(q.queryByLabelText("Min")).toBeNull()
		expect(q.getByText(/doesn.t draw length/)).not.toBeNull()
	})
})

describe("Length panel — Segment properties", () => {
	const openSection = async (q: Awaited<ReturnType<typeof mount>>) => {
		q.getByRole("button", { name: /Segment properties/ }).click()
		await new Promise((r) => setTimeout(r, 0))
	}

	it("segment mode: offers the line cap, and points at Size for the thickness", async () => {
		seed(SEGMENTS)
		const q = await mount()
		await openSection(q)
		expect(q.getByRole("radiogroup", { name: "Line cap" })).not.toBeNull()
		expect(q.getByRole("radio", { name: "Round" })).not.toBeNull()
		expect(q.getByRole("radio", { name: "Square" })).not.toBeNull()
		// Every thickness lives under Size (SizePanel.thickness.smoke.test).
		expect(q.queryByLabelText("Thickness")).toBeNull()
		expect(q.queryByLabelText("Vary by")).toBeNull()
		expect(q.getByRole("button", { name: "Size → Segment" })).not.toBeNull()
	})

	it("bar mode: no segment properties", async () => {
		seed(BARS)
		const q = await mount()
		expect(q.queryByText("Segment properties")).toBeNull()
	})

	it("no length field and no default length: shapes draw, so no segment properties", async () => {
		seed({ ...SEGMENTS, length: { field: null } })
		const q = await mount()
		expect(q.queryByText("Segment properties")).toBeNull()
	})
})
