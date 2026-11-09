import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** The Spine section's "Side" dropdown moves the WHOLE axis to the opposite
 *  plot edge (x → top, y → right), stored sparsely as `AxisConfig.side`;
 *  and the Tick labels "Align" row is always offered (it used to hide
 *  behind Wrap text). */

const DATASET_ID = "ds-axis-side-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "region", inferredType: "categorical" },
			{ name: "revenue", inferredType: "quantitative" },
		],
		rows: Array.from({ length: 4 }, (_, i) => ({
			region: ["East", "West", "North", "South"][i]!,
			revenue: String(10 * (i + 1)),
		})),
	})

const seed = (encodings: Encodings) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
}

const mount = async (channel: "x" | "y") => {
	const { container } = render(
		<TestProvider>
			<AxisOptionsPanel channel={channel} />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

const openSection = (q: ReturnType<typeof within>, title: string) => {
	const header = q.queryByText(title)
	expect(header).not.toBeNull()
	fireEvent.click(header!)
}

const readSaved = (): Record<string, { side?: string }> => {
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try */
	const raw = localStorage.getItem("vis-components:currentChannelConfigs")
	const parsed = raw ? (JSON.parse(raw) as { data?: unknown }) : null
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try */
	const data = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed
	return (data ?? {}) as Record<string, { side?: string }>
}

afterEach(cleanup)

describe("Axis Side dropdown", () => {
	it("offers Bottom / Top on the X panel and stores only the non-default side", async () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "revenue" } })
		const q = await mount("x")
		openSection(q, "Spine")
		const select = q.getByLabelText("Axis side") as HTMLSelectElement
		const labels = [...select.options].map((o) => o.textContent)
		expect(labels).toEqual(["Bottom", "Top"])
		expect(select.value).toBe("default")
		fireEvent.change(select, { target: { value: "flipped" } })
		await new Promise((r) => setTimeout(r, 20))
		expect(readSaved().x?.side).toBe("top")
		fireEvent.change(select, { target: { value: "default" } })
		await new Promise((r) => setTimeout(r, 20))
		expect(readSaved().x?.side).toBeUndefined()
	})

	it("offers Left / Right on the Y panel", async () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "revenue" } })
		const q = await mount("y")
		openSection(q, "Spine")
		const select = q.getByLabelText("Axis side") as HTMLSelectElement
		expect([...select.options].map((o) => o.textContent)).toEqual(["Left", "Right"])
		fireEvent.change(select, { target: { value: "flipped" } })
		await new Promise((r) => setTimeout(r, 20))
		expect(readSaved().y?.side).toBe("right")
	})
})

describe("Tick labels Align row", () => {
	it("is offered without Wrap text on", async () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "revenue" } })
		const q = await mount("y")
		openSection(q, "Tick labels")
		expect(q.queryByText("Align")).not.toBeNull()
		expect(q.queryByText("Characters")).toBeNull()
	})
})
