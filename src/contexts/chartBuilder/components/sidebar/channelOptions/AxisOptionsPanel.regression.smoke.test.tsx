import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** The Regression section gates on the exact complement of the violin/box
 *  situation: BOTH position axes quantitative, X panel only. */

const DATASET_ID = "ds-regression-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "measurements",
		filename: "measurements.csv",
		fields: [
			{ name: "xval", inferredType: "quantitative" },
			{ name: "yval", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: Array.from({ length: 6 }, (_, i) => ({
			xval: String(i),
			yval: String(2 * i),
			region: i % 2 === 0 ? "East" : "West",
		})),
	})

const seed = (encodings: Encodings) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

// The datasets atom hydrates asynchronously (IndexedDB-backed persist
// effect), so the panel re-renders once the dataset arrives — settle a tick
// before asserting, and scope queries to this render's container.
const mount = async (channel: "x" | "y") => {
	const { container } = render(
		<TestProvider>
			<AxisOptionsPanel channel={channel} />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

describe("Regression section gating", () => {
	it("appears on the X panel when both position axes are quantitative", async () => {
		seed({ ...emptyEncodings(), x: { field: "xval" }, y: { field: "yval" } })
		const q = await mount("x")
		const header = q.queryByText("Regression")
		expect(header).not.toBeNull()
		// Subsections are collapsed by default — expand to reach the controls.
		fireEvent.click(header!)
		expect(q.queryByText("Add regression line")).not.toBeNull()
		// The violin/box Distribution section is the complement — never both.
		expect(q.queryByText("Distribution")).toBeNull()
	})

	it("does not appear on the Y panel of the same chart", async () => {
		seed({ ...emptyEncodings(), x: { field: "xval" }, y: { field: "yval" } })
		const q = await mount("y")
		expect(q.queryByText("Regression")).toBeNull()
	})

	it("does not appear on a strip plot (categorical × quantitative)", async () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "yval" } })
		const qx = await mount("x")
		expect(qx.queryByText("Regression")).toBeNull()
		cleanup()
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "yval" } })
		const qy = await mount("y")
		expect(qy.queryByText("Regression")).toBeNull()
		// Sanity: the strip plot's own section IS offered (violin/box on the
		// quantitative side) — proves the dataset loaded and gating ran.
		expect(qy.queryByText("Distribution")).not.toBeNull()
	})

	it("does not appear with a lone quantitative axis (histogram case)", async () => {
		seed({ ...emptyEncodings(), x: { field: "xval" } })
		const q = await mount("x")
		expect(q.queryByText("Regression")).toBeNull()
		// The lone-quantitative situation offers Distribution (histogram /
		// density) instead.
		expect(q.queryByText("Distribution")).not.toBeNull()
	})
})
