import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import type { AxisConfig } from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** The radar R panel's Tick Labels section ends with the same "Adjust
 *  position" X / Y nudge the cartesian X and Y panels have. It moves the
 *  r-tick labels along the 12 o'clock spoke and nothing else; the Y input
 *  shows math convention (positive = up) and flips sign into screen coords
 *  at the input boundary. */

const DATASET_ID = "ds-r-adjust-position-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "radar",
		filename: "radar.csv",
		fields: [
			{ name: "metric", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
		],
		rows: ["A", "B", "C", "D"].map((metric, i) => ({
			metric,
			score: String(10 * (i + 1)),
		})),
	})

const RADAR: Encodings = {
	...emptyEncodings(),
	r: { field: "score" },
	angle: { field: "metric" },
}

const seed = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", RADAR)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	return store
}

const readSavedR = (store: Map<string, string>): Partial<AxisConfig> => {
	const parsed = JSON.parse(
		store.get("vis-components:currentChannelConfigs") ?? "{}"
	) as { _v?: number; data?: { r?: Partial<AxisConfig> } }
	return (parsed.data ?? (parsed as { r?: Partial<AxisConfig> })).r ?? {}
}

// Datasets hydrate asynchronously — settle a tick, scope to this container.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<AxisOptionsPanel channel="r" />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

/** Make sure the Tick Labels subsection is open (it may start collapsed). */
const openTickLabels = (q: ReturnType<typeof within>) => {
	if (q.queryByText("Adjust position")) return
	const header = q.queryByText("Tick Labels")
	expect(header).not.toBeNull()
	fireEvent.click(header!)
}

afterEach(cleanup)

describe("R panel — Tick Labels 'Adjust position' nudge", () => {
	it("offers the X / Y nudge on the radar r axis", async () => {
		seed()
		const q = await mount()
		openTickLabels(q)
		expect(q.getByText("Adjust position")).toBeTruthy()
		expect(q.getByLabelText("X")).toBeTruthy()
		expect(q.getByLabelText("Y")).toBeTruthy()
		// Radar-specific helper: rings + spokes, not spine / tick marks.
		expect(q.getByText(/rings and spokes stay put/)).toBeTruthy()
	})

	it("stores offsetX as typed and offsetY sign-flipped (UI positive = up → screen negative)", async () => {
		const store = seed()
		const q = await mount()
		openTickLabels(q)
		fireEvent.change(q.getByLabelText("X"), { target: { value: "10" } })
		fireEvent.change(q.getByLabelText("Y"), { target: { value: "5" } })
		const r = readSavedR(store)
		expect(r.offsetX).toBe(10)
		expect(r.offsetY).toBe(-5)
		expect(r.offset).toBeUndefined()
	})

	it("Reset clears both nudge fields", async () => {
		const store = seed()
		const q = await mount()
		openTickLabels(q)
		fireEvent.change(q.getByLabelText("X"), { target: { value: "10" } })
		expect(readSavedR(store).offsetX).toBe(10)
		// The reset link sits right after the "Adjust position" group header.
		const header = q.getByText("Adjust position")
		const reset = header.parentElement?.querySelector("button")
		expect(reset).not.toBeNull()
		fireEvent.click(reset!)
		const r = readSavedR(store)
		expect(r.offsetX).toBeUndefined()
		expect(r.offsetY).toBeUndefined()
	})
})
