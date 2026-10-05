import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_AXIS_CONFIG } from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentResolvedXTickLabelAngleAtom,
} from "../../../store/atoms"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** Tick Labels → Angle. Blank = auto; the x-axis renderer publishes the
 *  angle it resolved (-45 when the categorical auto-rotate kicked in) and
 *  the blank field shows it as the placeholder with a "set to 0" link that
 *  pins the labels level. Any explicit number shows "reset" (→ auto). */

const DATASET_ID = "ds-tick-label-angle-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "years",
		filename: "years.csv",
		fields: [
			{ name: "year_lab", inferredType: "categorical" },
			{ name: "pct", inferredType: "quantitative" },
		],
		rows: ["2020", "2021", "2022", "2023", "2024", "2025 (Jan–May)"].map(
			(year_lab, i) => ({ year_lab, pct: String(60 + i) })
		),
	})

const seed = () => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "year_lab" },
		y: { field: "pct" },
	})
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

const mount = async ({
	channel,
	resolved,
	storedAngle,
}: {
	channel: "x" | "y"
	/** What the x-axis renderer published. */
	resolved: number | null
	/** Stored `tickLabelAngle` on the x config; `undefined` = no x config at all. */
	storedAngle?: number | null
}) => {
	seed()
	const { container } = render(
		<TestProvider
			initializeState={(store: TestStore) => {
				store.set(currentResolvedXTickLabelAngleAtom, resolved)
				if (storedAngle !== undefined) {
					store.set(currentChannelConfigsAtom, {
						x: { ...DEFAULT_AXIS_CONFIG, tickLabelAngle: storedAngle },
					})
				}
			}}
		>
			<AxisOptionsPanel channel={channel} />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	const q = within(container)
	const header = q.queryByText("Tick Labels")
	expect(header).not.toBeNull()
	// Opens the collapsed section (a no-op click on the title if it's open).
	if (q.queryByLabelText("Angle") === null) fireEvent.click(header!)
	const angle = () => q.getByLabelText("Angle") as HTMLInputElement
	return { q, angle }
}

afterEach(cleanup)

describe("Tick Labels → Angle (auto / set to 0 / reset)", () => {
	it("shows the published auto angle as the blank field's placeholder with a 'set to 0' link", async () => {
		const { q, angle } = await mount({ channel: "x", resolved: -45 })
		expect(angle().value).toBe("")
		expect(angle().placeholder).toBe("-45")
		expect(q.queryByLabelText("Set tick label angle to 0")).not.toBeNull()
		expect(q.queryByText("reset")).toBeNull()
	})

	it("'set to 0' pins the labels level: the field commits 0 and the link flips to 'reset'", async () => {
		const { q, angle } = await mount({ channel: "x", resolved: -45 })
		fireEvent.click(q.getByLabelText("Set tick label angle to 0"))
		expect(angle().value).toBe("0")
		expect(q.queryByLabelText("Set tick label angle to 0")).toBeNull()
		expect(q.queryByText("reset")).not.toBeNull()
	})

	it("offers no link while auto resolved to level (nothing to undo)", async () => {
		const { q, angle } = await mount({ channel: "x", resolved: 0 })
		expect(angle().value).toBe("")
		expect(angle().placeholder).toBe("0")
		expect(q.queryByLabelText("Set tick label angle to 0")).toBeNull()
		expect(q.queryByText("reset")).toBeNull()
	})

	it("the Y panel ignores the x-axis's published angle (only x auto-rotates)", async () => {
		const { q, angle } = await mount({ channel: "y", resolved: -45 })
		expect(angle().placeholder).toBe("0")
		expect(q.queryByLabelText("Set tick label angle to 0")).toBeNull()
	})

	it("'reset' on an explicit angle returns the field to auto", async () => {
		const { q, angle } = await mount({ channel: "x", resolved: -45, storedAngle: -30 })
		expect(angle().value).toBe("-30")
		fireEvent.click(q.getByText("reset"))
		expect(angle().value).toBe("")
		expect(angle().placeholder).toBe("-45")
		expect(q.queryByLabelText("Set tick label angle to 0")).not.toBeNull()
	})
})
