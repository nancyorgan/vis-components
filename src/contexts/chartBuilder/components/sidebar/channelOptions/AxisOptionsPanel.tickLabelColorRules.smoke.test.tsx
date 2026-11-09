import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_AXIS_CONFIG } from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import { currentChannelConfigsAtom } from "../../../store/atoms"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** Tick labels → color rules. The x / y panels carry a right-aligned
 *  "+ Add color rule" link right under the font editor's Color row; each
 *  rule writes `AxisConfig.tickLabelColorRules`, and removing the last rule
 *  clears the field (not an empty list) so the "changed" dots stay honest.
 *  The radar r panel has no link — its ticks carry no value to test. */

const DATASET_ID = "ds-tick-label-color-rules"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "regions",
		filename: "regions.csv",
		fields: [
			{ name: "region", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
		],
		rows: [
			{ region: "West", sales: "10" },
			{ region: "East", sales: "20" },
		],
	})

const seed = () => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "region" },
		y: { field: "sales" },
	})
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
}

const mount = async (channel: "x" | "y" | "r") => {
	seed()
	let store: TestStore | null = null
	const { container } = render(
		<TestProvider
			initializeState={(snap: TestStore) => {
				store = snap
				snap.set(currentChannelConfigsAtom, {
					x: { ...DEFAULT_AXIS_CONFIG },
					y: { ...DEFAULT_AXIS_CONFIG },
					r: { ...DEFAULT_AXIS_CONFIG },
				})
			}}
		>
			<AxisOptionsPanel channel={channel} />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	const q = within(container)
	const header = q.getByText("Tick labels")
	if (q.queryByLabelText("Color") === null) fireEvent.click(header)
	const rules = () => store!.get(currentChannelConfigsAtom)[channel]?.tickLabelColorRules
	return { q, rules }
}

afterEach(cleanup)

describe("Tick labels → color rules", () => {
	it("x: adding a rule writes tickLabelColorRules; the condition box edits it", async () => {
		const { q, rules } = await mount("x")
		expect(q.queryByText("+ Add color rule")).not.toBeNull()
		fireEvent.click(q.getByText("+ Add color rule"))
		expect(rules()).toHaveLength(1)
		const condition = q.getByLabelText("Condition for tick label rule 1") as HTMLInputElement
		fireEvent.change(condition, { target: { value: "== West" } })
		fireEvent.blur(condition)
		expect(rules()?.[0]?.condition).toBe("== West")
		// The help line names what an implicit rule compares against, and
		// omits the {Variable} tip (no rows behind a tick label).
		expect(q.queryByText(/each tick label's own value/)).not.toBeNull()
		expect(q.queryByText(/variable in braces/)).toBeNull()
	})

	it("y: the link is offered too, and removing the last rule clears the field", async () => {
		const { q, rules } = await mount("y")
		fireEvent.click(q.getByText("+ Add color rule"))
		expect(rules()).toHaveLength(1)
		fireEvent.click(q.getByLabelText("Remove tick label rule 1"))
		expect(rules()).toBeUndefined()
	})

	it("r: the radar r panel has no color-rule link", async () => {
		const { q } = await mount("r")
		expect(q.queryByText("+ Add color rule")).toBeNull()
	})
})
