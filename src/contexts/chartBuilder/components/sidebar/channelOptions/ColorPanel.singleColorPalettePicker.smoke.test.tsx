import { fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { EMPTY_CHANNEL_CONFIGS } from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { ColorPanel } from "./ColorPanel"

/** Every "Vary by → Single color" swatch (Fill's default fill, the Outline
 *  row, and each generic color slot) carries the circular-arrow palette
 *  popover, so the user can hop to another palette color without the
 *  open-ended picker. */

const ID = "ds-single-color-picker"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "scatter",
		filename: "scatter.csv",
		fields: [
			{ name: "xv", inferredType: "quantitative" },
			{ name: "yv", inferredType: "quantitative" },
			{ name: "series", inferredType: "categorical" },
		],
		rows: [
			{ xv: "1", yv: "2", series: "A" },
			{ xv: "3", yv: "4", series: "B" },
		],
	})

const mount = (withConnection = false) => {
	const enc = {
		...emptyEncodings(),
		x: { field: "xv" },
		y: { field: "yv" },
		...(withConnection ? { connection: { field: "series" } } : {}),
	}
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", EMPTY_CHANNEL_CONFIGS)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(
		<TestProvider initializeState={init}>
			<ColorPanel />
		</TestProvider>
	)
}

const expandSubheader = (container: HTMLElement, title: string) => {
	const btn = [...container.querySelectorAll("button[aria-expanded]")].find(
		(b) => b.textContent?.trim() === title
	)!
	if (btn.getAttribute("aria-expanded") === "false") fireEvent.click(btn)
}

describe("ColorPanel — single-color palette picker", () => {
	it("Fill's single-color swatch offers the palette popover and commits a pick", () => {
		const { getByRole, container } = mount()
		// Fill is open by default with no field mapped → single-color row.
		const toggle = getByRole("button", { name: "Pick palette color" })
		fireEvent.click(toggle)
		const swatches = [...container.querySelectorAll("button[aria-label^='Use #']")]
		expect(swatches.length).toBeGreaterThan(0)

		const picked = swatches[0].getAttribute("aria-label")!.replace("Use ", "")
		fireEvent.click(swatches[0])
		// The row's color swatch (sibling of the picker button) now holds the pick.
		const row = toggle.closest(".gap-2")!.parentElement!
		const colorInput =
			row.querySelector<HTMLInputElement>('input[type="color"]')!
		expect(colorInput.value.toLowerCase()).toBe(picked.toLowerCase())
	})

	it("the Outline row's single-color swatch offers the palette popover", () => {
		const { container, getByRole } = mount()
		expandSubheader(container, "Outline")
		expect(
			getByRole("button", { name: "Pick palette outline color" })
		).toBeTruthy()
	})

	it("a generic color slot's single-color swatch offers the palette popover", () => {
		const { container, getByRole } = mount(true)
		expandSubheader(container, "Line")
		expect(
			getByRole("button", { name: "Pick palette color for Line" })
		).toBeTruthy()
	})
})
