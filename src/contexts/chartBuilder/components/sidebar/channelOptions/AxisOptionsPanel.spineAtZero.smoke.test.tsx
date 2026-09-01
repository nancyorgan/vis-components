import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** The Spine section's "Set spine at 0" checkbox moves THIS panel's own
 *  spine (the line its Color/Thickness rows style) to the PERPENDICULAR
 *  scale's zero — so it gates on the perpendicular position variable being
 *  quantitative with data dipping below zero. With negative y values the X
 *  panel offers it (horizontal spine → y = 0); with negative x values the Y
 *  panel does (vertical spine → x = 0). */

const DATASET_ID = "ds-spine-at-zero-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "profits",
		filename: "profits.csv",
		fields: [
			{ name: "profit", inferredType: "quantitative" },
			{ name: "revenue", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: Array.from({ length: 6 }, (_, i) => ({
			profit: String(i - 3), // -3..2 — dips below zero
			revenue: String(10 * i), // all >= 0
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

/** Expand the (collapsed-by-default) Spine subsection and return whether the
 *  checkbox is offered. */
const spineAtZeroOffered = (q: ReturnType<typeof within>): boolean => {
	const header = q.queryByText("Spine")
	expect(header).not.toBeNull()
	fireEvent.click(header!)
	return q.queryByText("Set spine at 0") !== null
}

afterEach(cleanup)

describe("Set spine at 0 checkbox gating", () => {
	it("appears on the X panel when the y variable dips below zero (horizontal spine → y = 0)", async () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "profit" } })
		const q = await mount("x")
		expect(spineAtZeroOffered(q)).toBe(true)
	})

	it("does not appear on the Y panel of that chart (perpendicular axis is categorical)", async () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "profit" } })
		const q = await mount("y")
		expect(spineAtZeroOffered(q)).toBe(false)
	})

	it("does not appear when the perpendicular data never goes negative", async () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "revenue" } })
		const q = await mount("x")
		expect(spineAtZeroOffered(q)).toBe(false)
	})

	it("appears on the Y panel for horizontal bars with a negative length measure (vertical spine → x = 0)", async () => {
		// Nancy's diverging-bar case: category on y, measure via the LENGTH
		// channel — the field-less x axis carries the measure, so the Y
		// panel's gate substitutes the length field's values.
		seed({
			...emptyEncodings(),
			y: { field: "region" },
			length: { field: "profit" },
		})
		const q = await mount("y")
		expect(spineAtZeroOffered(q)).toBe(true)
	})

	it("appears on the X panel for vertical bars with a negative length measure", async () => {
		seed({
			...emptyEncodings(),
			x: { field: "region" },
			length: { field: "profit" },
		})
		const q = await mount("x")
		expect(spineAtZeroOffered(q)).toBe(true)
	})
})
