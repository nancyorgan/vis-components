import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { emptyEncodings, type Encodings } from "../../lib/types"

import { EncodingShelf } from "./EncodingShelf"

/** Mapping X or Y over a mapped R position (a radar) asks to override it —
 *  and, since radars can't be placed at x / y positions the way pies can,
 *  points at facets for arranging several. Other conflicts keep the plain
 *  wording. */

const DATASET_ID = "ds-radar-conflict-hint"

const seed = (encodings: Encodings) => {
	const ls = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	ls.set(
		"vis-components:datasets",
		JSON.stringify({
			[DATASET_ID]: buildDatasetFixture({
				id: DATASET_ID,
				name: "radar",
				filename: "radar.csv",
				fields: [
					{ name: "metric", inferredType: "categorical" },
					{ name: "score", inferredType: "quantitative" },
					{ name: "team", inferredType: "categorical" },
				],
				rows: [{ metric: "A", score: "1", team: "north" }],
			}),
		})
	)
	ls.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	ls.set("vis-components:previewVersionId", JSON.stringify(null))
	ls.set("vis-components:currentEncodings", JSON.stringify(encodings))
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const RADAR: Encodings = {
	...emptyEncodings(),
	r: { field: "score" },
	angle: { field: "metric" },
}

const pick = async (channel: "x" | "y", label: string) => {
	const { container } = render(
		<TestProvider>
			<EncodingShelf channel={channel} />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	const q = within(container)
	fireEvent.change(q.getByLabelText(label), { target: { value: "team" } })
	return q.getByRole("alert").textContent ?? ""
}

afterEach(cleanup)

describe("X / Y over a mapped R position", () => {
	it.each([
		["x", "X position"],
		["y", "Y position"],
	] as const)("%s: suggests a facet to arrange charts", async (channel, label) => {
		seed(RADAR)
		const text = await pick(channel, label)
		expect(text).toContain(
			`R position is currently mapped. ${label} will override it. Proceed? To arrange charts, use a facet.`
		)
	})
})
