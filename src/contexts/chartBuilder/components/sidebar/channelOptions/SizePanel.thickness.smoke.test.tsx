import { cleanup, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { ConnectionOptionsPanel } from "./ConnectionOptionsPanel"

/** Line properties → "Vary by" for line thickness. The dropdown lists the
 *  connection field AND every other categorical / ordinal variable (a line's
 *  thickness resolves off its representative row, like the line color slot),
 *  stores the pick in `thicknessField`, and still reads a legacy visual whose
 *  only trace of "vary by" is a populated `thicknessByValue` map as varying
 *  by the connection field. */

const DATASET_ID = "ds-connection-thickness"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "month", inferredType: "quantitative" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
			{ name: "segment", inferredType: "categorical" },
		],
		// Two lines (north / south); `segment` is constant within each line.
		rows: Array.from({ length: 8 }, (_, i) => ({
			month: String((i % 4) + 1),
			sales: String(10 * i),
			region: i < 4 ? "north" : "south",
			segment: i < 4 ? "retail" : "wholesale",
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

// Datasets hydrate asynchronously — settle a tick before asserting, and scope
// queries to this render's container.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<ConnectionOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

const openLineProperties = async (q: Awaited<ReturnType<typeof mount>>) => {
	q.getByRole("button", { name: /Line properties/ }).click()
	await new Promise((r) => setTimeout(r, 0))
}

afterEach(cleanup)

/** `x + y + connection` → scatter mode: one polyline per `region`. */
const LINE_CHART: Encodings = {
	...emptyEncodings(),
	x: { field: "month" },
	y: { field: "sales" },
	connection: { field: "region" },
}

describe("Connection panel — line thickness Vary by", () => {
	it("lists the connection field and every other categorical variable", async () => {
		seed(LINE_CHART)
		const q = await mount()
		await openLineProperties(q)
		const varyBy = q.getByLabelText("Vary by") as HTMLSelectElement
		// Quantitative month / sales stand down; region (connection) and
		// segment (another categorical) are both offered.
		expect([...varyBy.options].map((o) => o.value)).toEqual(["", "region", "segment"])
		expect(varyBy.value).toBe("")
		expect(q.getByLabelText("Line thickness")).not.toBeNull()
	})

	it("vary by a NON-connection field: one thickness row per level of that field", async () => {
		seed(LINE_CHART, {
			connection: {
				thicknessField: "segment",
				thicknessByValue: { retail: 3, wholesale: 7 },
			},
		})
		const q = await mount()
		await openLineProperties(q)
		expect((q.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("segment")
		expect(q.queryByLabelText("Line thickness")).toBeNull()
		expect(
			(q.getByLabelText("Line thickness for retail") as HTMLInputElement).value
		).toBe("3")
		expect(
			(q.getByLabelText("Line thickness for wholesale") as HTMLInputElement).value
		).toBe("7")
		expect(q.queryByLabelText("Line thickness for north")).toBeNull()
	})

	it("legacy visual (populated map, no field) reads as vary by the connection field", async () => {
		seed(LINE_CHART, {
			connection: { thicknessByValue: { north: 2, south: 6 } },
		})
		const q = await mount()
		await openLineProperties(q)
		expect((q.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("region")
		expect(
			(q.getByLabelText("Line thickness for north") as HTMLInputElement).value
		).toBe("2")
		expect(
			(q.getByLabelText("Line thickness for south") as HTMLInputElement).value
		).toBe("6")
	})

	it("a stored field that's gone from the data set reads as — none —", async () => {
		seed(LINE_CHART, {
			connection: { thicknessField: "gone", thicknessByValue: { a: 1 } },
		})
		const q = await mount()
		await openLineProperties(q)
		expect((q.getByLabelText("Vary by") as HTMLSelectElement).value).toBe("")
		expect(q.getByLabelText("Line thickness")).not.toBeNull()
	})
})
