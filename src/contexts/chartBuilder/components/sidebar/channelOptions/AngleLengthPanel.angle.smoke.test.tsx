import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { AngleOptionsPanel } from "./AngleLengthPanel"

/** The Angle panel groups its radar controls under collapsible subsections —
 *  Angle Extent (min / max sweep), Spokes (count + spoke line style), and
 *  Spoke Labels (rotation, format, label stride, distance from the chart) —
 *  so a radar's panel opens as a short list of headers. The mark-rotation
 *  layout (angle on a scatter) only has the extent range, so it stays flat. */

const DATASET_ID = "ds-angle-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "metric", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "weight", inferredType: "quantitative" },
		],
		rows: Array.from({ length: 6 }, (_, i) => ({
			metric: ["A", "B", "C"][i % 3],
			score: String(2 * i),
			weight: String(i),
		})),
	})

const seed = (encodings: Encodings) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	return store
}

// Datasets hydrate asynchronously (IndexedDB-backed persist effect) — settle
// a tick before asserting, and scope queries to this render's container.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<AngleOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

/** `r + angle`, no x/y → radar. */
const RADAR: Encodings = {
	...emptyEncodings(),
	r: { field: "score" },
	angle: { field: "metric" },
}

/** `x + y + angle` → scatter with rotated marks: extent range only. */
const ROTATION: Encodings = {
	...emptyEncodings(),
	x: { field: "score" },
	y: { field: "weight" },
	angle: { field: "score" },
}

const header = (q: ReturnType<typeof within>, name: RegExp) =>
	q.getByRole("button", { name })

describe("Angle panel — radar mode", () => {
	it("opens as three collapsed subsections: Angle Extent, Spokes, Spoke Labels", async () => {
		seed(RADAR)
		const q = await mount()
		for (const name of [/angle extent/i, /^spokes$/i, /spoke labels/i]) {
			expect(header(q, name).getAttribute("aria-expanded")).toBe("false")
		}
		// Collapsed → none of the controls are in the DOM yet.
		expect(q.queryByLabelText("Min")).toBeNull()
		expect(q.queryByLabelText("Spokes")).toBeNull()
		expect(q.queryByLabelText("Distance")).toBeNull()
	})

	it("Angle Extent holds the Min / Max sweep", async () => {
		seed(RADAR)
		const q = await mount()
		fireEvent.click(header(q, /angle extent/i))
		expect(q.getByLabelText("Min")).not.toBeNull()
		expect(q.getByLabelText("Max")).not.toBeNull()
	})

	it("Spokes holds the spoke count and the spoke line style", async () => {
		seed(RADAR)
		const q = await mount()
		fireEvent.click(header(q, /^spokes$/i))
		expect(q.getByLabelText("Spokes")).not.toBeNull()
		expect(q.getByText(/Radar Spine/)).not.toBeNull()
	})

	it("Spoke Labels holds label angle, format, label every, and distance", async () => {
		seed(RADAR)
		const q = await mount()
		fireEvent.click(header(q, /spoke labels/i))
		expect(q.getByLabelText("Label angle")).not.toBeNull()
		expect(q.getByLabelText("Custom format code")).not.toBeNull()
		expect(q.getByLabelText("Label every")).not.toBeNull()
		expect(q.getByLabelText("Distance")).not.toBeNull()
	})

	it("'Label every' reads as an ordinal stride once above 1", async () => {
		seed(RADAR)
		const q = await mount()
		fireEvent.click(header(q, /spoke labels/i))
		expect(q.getByText(/^spoke$/)).not.toBeNull()
		fireEvent.change(q.getByLabelText("Label every"), { target: { value: "3" } })
		expect(q.getByText(/3rd spoke/)).not.toBeNull()
	})
})

describe("Angle panel — mark rotation (non-polar)", () => {
	it("keeps the flat Min / Max layout with no subsection headers", async () => {
		seed(ROTATION)
		const q = await mount()
		expect(q.getByLabelText("Min")).not.toBeNull()
		expect(q.getByLabelText("Max")).not.toBeNull()
		expect(q.queryByRole("button", { name: /angle extent/i })).toBeNull()
		expect(q.queryByRole("button", { name: /spoke labels/i })).toBeNull()
	})
})
