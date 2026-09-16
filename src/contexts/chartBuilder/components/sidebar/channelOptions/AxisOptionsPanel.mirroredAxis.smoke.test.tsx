import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import type { MirrorAxisConfig } from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { AxisOptionsPanel } from "./AxisOptionsPanel"

/** The Ticks section's "Use a mirrored axis" mini-section: offered on a bar
 *  chart's IMPLIED measure axis only (the field-less position axis the
 *  `length` measure feeds). Checking it reveals the Direction picker (fields
 *  with exactly two values), the side maxes (Left/Right on a horizontal
 *  measure axis, Lower/Upper on a vertical one) and the mirrored custom
 *  breaks, and retires the plain Scale range + Custom breaks controls. */

const DATASET_ID = "ds-mirrored-axis-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "pyramid",
		filename: "pyramid.csv",
		fields: [
			{ name: "age", inferredType: "categorical" },
			{ name: "pop", inferredType: "quantitative" },
			{ name: "sex", inferredType: "categorical" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: [
			{ age: "0-9", pop: "10", sex: "M", region: "N" },
			{ age: "0-9", pop: "12", sex: "F", region: "S" },
			{ age: "10-19", pop: "8", sex: "M", region: "E" },
			{ age: "10-19", pop: "6", sex: "F", region: "N" },
		],
	})

const seed = (
	encodings: Encodings,
	configs: Record<string, { mirror?: MirrorAxisConfig }> = {}
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

// The datasets atom hydrates asynchronously, so settle a tick before
// asserting and scope queries to this render's container.
const mount = async (channel: "x" | "y") => {
	const { container } = render(
		<TestProvider>
			<AxisOptionsPanel channel={channel} />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

/** Expand the collapsed-by-default Ticks subsection. */
const openTicks = (q: ReturnType<typeof within>) => {
	const header = q.queryByText("Ticks")
	expect(header).not.toBeNull()
	fireEvent.click(header!)
}

const HORIZONTAL: Encodings = {
	...emptyEncodings(),
	y: { field: "age" },
	length: { field: "pop" },
	hue: { field: "sex" },
}
const VERTICAL: Encodings = {
	...emptyEncodings(),
	x: { field: "age" },
	length: { field: "pop" },
	hue: { field: "sex" },
}

afterEach(cleanup)

describe("Use a mirrored axis — gating", () => {
	it("is offered on the measure axis of horizontal bars (the X panel)", async () => {
		seed(HORIZONTAL)
		const q = await mount("x")
		openTicks(q)
		expect(q.queryByText("Use a mirrored axis")).not.toBeNull()
	})

	it("is not offered on the category axis (the Y panel of horizontal bars)", async () => {
		seed(HORIZONTAL)
		const q = await mount("y")
		openTicks(q)
		expect(q.queryByText("Use a mirrored axis")).toBeNull()
	})

	it("is not offered on a scatter's quantitative axis", async () => {
		seed({ ...emptyEncodings(), x: { field: "pop" }, y: { field: "pop" } })
		const q = await mount("x")
		openTicks(q)
		expect(q.queryByText("Use a mirrored axis")).toBeNull()
	})

	it("stays visible while checked so it can be turned off", async () => {
		// Chart no longer a bar chart, but the X config still carries the flag.
		seed(
			{ ...emptyEncodings(), x: { field: "pop" }, y: { field: "pop" } },
			{ x: { mirror: { enabled: true, directionField: "sex" } } }
		)
		const q = await mount("x")
		openTicks(q)
		expect(q.queryByText("Use a mirrored axis")).not.toBeNull()
	})
})

describe("Use a mirrored axis — controls", () => {
	it("checking it reveals Direction + Left/Right max + breaks and retires Scale range", async () => {
		seed(HORIZONTAL)
		const q = await mount("x")
		openTicks(q)
		expect(q.queryByText("Scale range")).not.toBeNull()
		expect(q.queryByText("Direction")).toBeNull()
		fireEvent.click(q.getByLabelText("Use a mirrored axis"))
		expect(q.queryByText("Direction")).not.toBeNull()
		expect(q.queryByText("Left max")).not.toBeNull()
		expect(q.queryByText("Right max")).not.toBeNull()
		expect(q.queryByText("Scale range")).toBeNull()
		// The mirrored breaks box takes over from the plain one — exactly one.
		expect(q.getAllByText("Custom breaks")).toHaveLength(1)
	})

	it("labels the sides Lower / Upper on a vertical measure axis (the Y panel)", async () => {
		seed(VERTICAL, { y: { mirror: { enabled: true, directionField: null } } })
		const q = await mount("y")
		openTicks(q)
		expect(q.queryByText("Lower max")).not.toBeNull()
		expect(q.queryByText("Upper max")).not.toBeNull()
		expect(q.queryByText("Left max")).toBeNull()
	})

	it("Direction lists only variables with exactly two options", async () => {
		seed(HORIZONTAL, { x: { mirror: { enabled: true, directionField: null } } })
		const q = await mount("x")
		openTicks(q)
		const select = q.getByLabelText("Mirror direction variable") as HTMLSelectElement
		const options = [...select.options].map((o) => o.value).filter((v) => v !== "")
		// age (2 levels) and sex (2) qualify; pop (4 numbers) and region (3) don't.
		expect(options).toEqual(["age", "sex"])
	})

	it("explains which level draws on which side once a direction is chosen", async () => {
		seed(HORIZONTAL, { x: { mirror: { enabled: true, directionField: "sex" } } })
		const q = await mount("x")
		openTicks(q)
		expect(q.queryByText(/“M” draws to the left of 0, “F” to the right/)).not.toBeNull()
	})

	it("also offers Set spine at 0 on the category axis while the measure axis is mirrored", async () => {
		seed(HORIZONTAL, { x: { mirror: { enabled: true, directionField: "sex" } } })
		const q = await mount("y")
		const spine = q.queryByText("Spine")
		expect(spine).not.toBeNull()
		fireEvent.click(spine!)
		expect(q.queryByText("Set spine at 0")).not.toBeNull()
	})
})
