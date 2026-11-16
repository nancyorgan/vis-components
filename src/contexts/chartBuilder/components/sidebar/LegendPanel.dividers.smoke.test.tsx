import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { currentLegendConfigAtom } from "../../store/atoms"

import { LegendPanel } from "./LegendPanel"

/** Dividers break a card's settings into a few general groups; they are
 *  never drawn around one row (`components/ui/rowGroup.ts`). "Legend
 *  properties" used to rule off every row: Position, Legend width, Legend
 *  height, Orientation and Legend columns each sat under a line of its
 *  own. */

const DATASET_ID = "ds-legendpanel-dividers"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "tiers",
		filename: "tiers.csv",
		fields: [{ name: "Tier", inferredType: "categorical" }],
		rows: [{ Tier: "A" }, { Tier: "B" }],
	})

afterEach(cleanup)

/** The rows of the "Legend properties" card, grouped as the dividers
 *  split them: each group is the labels between one divider and the next. */
const groups = (legend: Partial<LegendConfig> = {}): string[][] => {
	const store = installInMemoryLocalStorage()
	const legendCfg: LegendConfig = { ...DEFAULT_LEGEND_CONFIG, ...legend }
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({ ...emptyEncodings(), hue: { field: "Tier" } })
	)
	store.set("vis-components:currentLegend", JSON.stringify(legendCfg))
	/* eslint-enable @vc/use-wrapped-json-functions */
	const utils = render(
		<TestProvider initializeState={(s: TestStore) => s.set(currentLegendConfigAtom, legendCfg)}>
			<LegendPanel />
		</TestProvider>
	)
	fireEvent.click(within(utils.container).getByText("Legend properties"))
	const card = utils.getByLabelText("Legend width").closest(".vc-subsection-card") as HTMLElement
	const LABELS = ["Position", "X", "Y", "Legend width", "Legend height", "Orientation", "Legend columns", "Column gap"]
	const out: string[][] = [[]]
	// Walk the card's groups in order: a divider group starts a new one.
	for (const group of [...card.children] as HTMLElement[]) {
		if (group.classList.contains("vc-divider-group")) out.push([])
		for (const label of LABELS) {
			const hit =
				within(group).queryByLabelText(label, { exact: true }) ??
				[...group.querySelectorAll("span")].find((s) => s.textContent === label)
			if (hit) out[out.length - 1].push(label)
		}
	}
	return out
}

describe("LegendPanel — Legend properties dividers", () => {
	it("one divider, between the box rows and the entry rows, when the legend sits at a named position", () => {
		expect(groups({ position: "right" })).toEqual([
			["Position", "Legend width", "Legend height"],
			["Orientation", "Legend columns"],
		])
	})

	it("custom coordinates add X and Y to Position, which then makes a group of its own", () => {
		expect(groups({ position: "inside" })).toEqual([
			["Position", "X", "Y"],
			["Legend width", "Legend height"],
			["Orientation", "Legend columns"],
		])
	})

	it("no group is a single row, with more than one column too", () => {
		for (const legend of [{ position: "inside" as const, columns: 2 }, { position: "bottom" as const, columns: 3 }]) {
			const found = groups(legend)
			expect(found[found.length - 1]).toEqual(["Orientation", "Legend columns", "Column gap"])
			for (const group of found) expect(group.length).toBeGreaterThanOrEqual(2)
			cleanup()
		}
	})
})
