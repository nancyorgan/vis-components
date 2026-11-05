import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import {
	SidebarJumpText,
	channelJump,
} from "../../../../components/ui/SidebarJumpLink"
import { emptyEncodings } from "../../lib/types"
import { sidebarCollapsedAtom, sidebarJumpTargetAtom } from "../../store/atoms"

import { EncodingShelf } from "./EncodingShelf"

/** Helper-note jump links ("Style the spokes under R position → Spine"):
 *  clicking the inline path targets an encoding row, which opens its options
 *  disclosure and leaves any named subsection for the panel to consume. */

const DATASET_ID = "ds-encoding-jump"

const seed = () => {
	const ls = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	ls.set(
		"vis-components:datasets",
		JSON.stringify({
			[DATASET_ID]: buildDatasetFixture({
				id: DATASET_ID,
				name: "groups",
				filename: "groups.csv",
				fields: [{ name: "group", inferredType: "categorical" }],
				rows: [{ group: "A" }, { group: "B" }],
			}),
		})
	)
	ls.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	ls.set("vis-components:previewVersionId", JSON.stringify(null))
	ls.set(
		"vis-components:currentEncodings",
		JSON.stringify({ ...emptyEncodings(), hue: { field: "group" } })
	)
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const mount = () => {
	seed()
	let store: TestStore | null = null
	const utils = render(
		<TestProvider
			initializeState={(s) => {
				store = s
				s.set(sidebarCollapsedAtom, { Encodings: true })
			}}
		>
			<p>
				Set the color under{" "}
				<SidebarJumpText target={channelJump("hue", "color:probe")}>
					Color → Probe
				</SidebarJumpText>
				.
			</p>
			<EncodingShelf channel="hue" />
		</TestProvider>
	)
	const toggle = within(utils.container).getByRole("button", {
		name: "Toggle options for Color",
	})
	return { ...utils, toggle, store: () => store as TestStore | null }
}

afterEach(cleanup)

describe("encoding-row jump links", () => {
	it("the inline link un-collapses Encodings and opens the row, keeping the subsection target", () => {
		const { container, toggle, store } = mount()
		expect(toggle.getAttribute("aria-expanded")).toBe("false")
		fireEvent.click(within(container).getByText("Color → Probe"))
		expect(store()?.get(sidebarCollapsedAtom).Encodings).toBe(false)
		expect(toggle.getAttribute("aria-expanded")).toBe("true")
		expect(store()?.get(sidebarJumpTargetAtom)).toEqual({
			section: "Encodings",
			channel: "hue",
			subsection: "color:probe",
		})
	})

	it("a row-only target opens the row and clears itself", () => {
		const { toggle, store } = mount()
		act(() => {
			store()?.set(sidebarJumpTargetAtom, channelJump("hue"))
		})
		expect(toggle.getAttribute("aria-expanded")).toBe("true")
		expect(store()?.get(sidebarJumpTargetAtom)).toBeNull()
	})

	it("a target for another channel leaves the row closed", () => {
		const { toggle, store } = mount()
		act(() => {
			store()?.set(sidebarJumpTargetAtom, channelJump("opacity"))
		})
		expect(toggle.getAttribute("aria-expanded")).toBe("false")
	})
})
