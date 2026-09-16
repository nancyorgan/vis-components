/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed localStorage deliberately */
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { DEFAULT_CONNECTION_CONFIG } from "../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { currentChannelConfigsAtom } from "../../store/atoms"

import { ChartCanvas } from "./ChartCanvas"

/** Regression: the Structure → Layout radio (`connection.hierarchyLayout`)
 *  must re-resolve the chart mode LIVE. PlotCanvas memoizes mode detection
 *  on the config-gated inputs; when the hierarchy layout was missing from
 *  that dep list, picking Treemap / Sunburst / Chord / Sankey did nothing
 *  until the page was reloaded. */

const DATASET_ID = "ds-hierarchy-layout"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "fruit",
		filename: "fruit.csv",
		fields: [
			{ name: "parent", inferredType: "categorical" },
			{ name: "child", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
		],
		rows: [
			{ parent: "Citrus", child: "Lemon", value: "8" },
			{ parent: "Citrus", child: "Lime", value: "4" },
			{ parent: "Melon", child: "Watermelon", value: "12" },
			{ parent: "Melon", child: "Cantaloupe", value: "6" },
		],
	})

const seed = () => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		area: { field: "value" },
		connection: { field: "parent" },
	})
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mount = () => {
	let store!: TestStore
	const utils = render(
		<TestProvider
			initializeState={(s) => {
				store = s
			}}
		>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)
	return { ...utils, store }
}

afterEach(cleanup)

describe("PlotCanvas — hierarchy Layout picker switches renderer live", () => {
	it("packed circles → treemap without a remount", () => {
		seed()
		const { container, store } = mount()

		// Default layout is packed circles: leaf marks are <circle>s.
		expect(container.querySelectorAll("circle").length).toBeGreaterThan(0)

		act(() => {
			store.set(currentChannelConfigsAtom, (prev) => ({
				...prev,
				connection: {
					...DEFAULT_CONNECTION_CONFIG,
					...prev.connection,
					hierarchyLayout: "treemap",
				},
			}))
		})

		// Treemap tiles are <rect>s; no packed circles remain.
		expect(container.querySelectorAll("circle").length).toBe(0)
		expect(container.querySelectorAll("rect").length).toBeGreaterThan(0)
	})
})
