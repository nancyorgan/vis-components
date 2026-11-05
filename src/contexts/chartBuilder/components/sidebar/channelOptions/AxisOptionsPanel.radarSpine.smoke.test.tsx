import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import type { AngleConfig } from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** On a radar, R position → Spine styles the spokes (each spoke is an R axis
 *  line): color, thickness and opacity, all written to the ANGLE config's
 *  spine, which the renderer draws from. */

const DATASET_ID = "ds-r-radar-spine-panel"

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
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", RADAR)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	return store
}

const readSavedAngle = (store: Map<string, string>): Partial<AngleConfig> => {
	const parsed = JSON.parse(
		store.get("vis-components:currentChannelConfigs") ?? "{}"
	) as { _v?: number; data?: { angle?: Partial<AngleConfig> } }
	return (parsed.data ?? (parsed as { angle?: Partial<AngleConfig> })).angle ?? {}
}

const mount = async () => {
	const { container } = render(
		<TestProvider>
			<AxisOptionsPanel channel="r" />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

const openSpine = (q: ReturnType<typeof within>) => {
	if (q.queryByLabelText("Thickness")) return
	fireEvent.click(q.getByText("Spine"))
}

afterEach(cleanup)

describe("R panel — radar Spine", () => {
	it("offers color, thickness and opacity for the spokes", async () => {
		seed()
		const q = await mount()
		openSpine(q)
		expect(q.getByLabelText("Thickness")).toBeTruthy()
		expect(q.getByLabelText("Opacity")).toBeTruthy()
		expect(q.getByText("Color")).toBeTruthy()
	})

	it("writes the angle config's spine; opacity 1 stays absent", async () => {
		const store = seed()
		const q = await mount()
		openSpine(q)
		fireEvent.change(q.getByLabelText("Opacity"), { target: { value: "0.4" } })
		fireEvent.blur(q.getByLabelText("Opacity"))
		expect(readSavedAngle(store).spine?.opacity).toBe(0.4)
		fireEvent.change(q.getByLabelText("Thickness"), { target: { value: "3" } })
		fireEvent.blur(q.getByLabelText("Thickness"))
		expect(readSavedAngle(store).spine?.thickness).toBe(3)
		fireEvent.change(q.getByLabelText("Opacity"), { target: { value: "1" } })
		fireEvent.blur(q.getByLabelText("Opacity"))
		expect(readSavedAngle(store).spine).not.toHaveProperty("opacity")
	})
})
