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
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { ColorPanel } from "./ColorPanel"

/** Conditional color rules on the Color menu: Fill, Outline, and Line (on
 *  this line chart, titled Point fill / Point outline / Line) each
 *  carry the same "+ Add color rule" link (no standing subsection), offered
 *  with or without a variable mapped, and each writes its own store slot —
 *  `fillColorRules`, `shape.outlineColorRules`, `colorSlots.line.colorRules`. */

const ID = "ds-color-rules"

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

const mount = ({ hueField = null }: { hueField?: string | null } = {}) => {
	const enc = {
		...emptyEncodings(),
		x: { field: "xv" },
		y: { field: "yv" },
		connection: { field: "series" },
		...(hueField ? { hue: { field: hueField } } : {}),
	}
	const ls = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => ls.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", EMPTY_CHANNEL_CONFIGS)
	/* eslint-enable @vc/use-wrapped-json-functions */
	let store: TestStore | null = null
	const init = (snap: TestStore) => {
		store = snap
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const utils = render(
		<TestProvider initializeState={init}>
			<ColorPanel />
		</TestProvider>
	)
	const configs = () => store!.get(currentChannelConfigsAtom)
	return { ...utils, configs }
}

const expandSubheader = (container: HTMLElement, title: string) => {
	const btn = [...container.querySelectorAll("button[aria-expanded]")].find(
		(b) => b.textContent?.trim() === title
	)!
	if (btn.getAttribute("aria-expanded") === "false") fireEvent.click(btn)
}

/** The "+ Add color rule" links currently rendered, in document order. */
const addLinks = (container: HTMLElement) =>
	[...container.querySelectorAll("button")].filter(
		(b) => b.textContent?.trim() === "+ Add color rule"
	)

const condition = (container: HTMLElement, name: string) =>
	container.querySelector<HTMLTextAreaElement>(
		`textarea[aria-label="Condition for ${name} rule 1"]`
	)

describe("ColorPanel — conditional color rules", () => {
	it("offers one '+ Add color rule' link each under Point fill, Point outline, and Line", () => {
		const { container } = mount()
		expandSubheader(container, "Point outline")
		expandSubheader(container, "Line")
		expect(addLinks(container)).toHaveLength(3)
		// No standing "rules" subsection header anywhere — the link is the
		// whole affordance until a rule exists.
		const headers = [...container.querySelectorAll("button[aria-expanded]")].map(
			(b) => b.textContent?.trim() ?? ""
		)
		expect(headers.some((h) => /rules/i.test(h))).toBe(false)
	})

	it("Fill's link adds a rule to `fillColorRules` with no Color variable mapped", () => {
		const { container, configs } = mount()
		// Fill is open by default with no field mapped → single-color row + link.
		fireEvent.click(addLinks(container)[0])
		const box = condition(container, "fill")
		expect(box).toBeTruthy()
		fireEvent.change(box!, { target: { value: "{xv} > 2" } })
		expect(configs().fillColorRules).toEqual([
			{ condition: "{xv} > 2", color: expect.any(String) },
		])
		// The no-variable help names the {Variable} form.
		expect(container.textContent).toContain("With no variable mapped")
	})

	it("Fill's rules stay available when a Color variable IS mapped", () => {
		const { container, configs } = mount({ hueField: "series" })
		fireEvent.click(addLinks(container)[0])
		fireEvent.change(condition(container, "fill")!, {
			target: { value: "== A" },
		})
		expect(configs().fillColorRules?.[0]?.condition).toBe("== A")
		expect(container.textContent).toContain("series")
	})

	it("Outline's link writes `shape.outlineColorRules`", () => {
		const { container, configs } = mount()
		expandSubheader(container, "Point outline")
		const [, outlineLink] = addLinks(container)
		fireEvent.click(outlineLink)
		fireEvent.change(condition(container, "outline")!, {
			target: { value: "{yv} < 3" },
		})
		expect(configs().shape?.outlineColorRules?.[0]?.condition).toBe("{yv} < 3")
		expect(configs().fillColorRules ?? []).toHaveLength(0)
	})

	it("Line's link writes `colorSlots.line.colorRules` on a well-formed slot", () => {
		const { container, configs } = mount()
		expandSubheader(container, "Line")
		const links = addLinks(container)
		fireEvent.click(links[links.length - 1])
		fireEvent.change(condition(container, "line")!, {
			target: { value: "{series} == B" },
		})
		const line = configs().colorSlots?.line
		expect(line?.colorRules?.[0]?.condition).toBe("{series} == B")
		expect(line?.field).toBeNull()
		expect(typeof line?.singleColor).toBe("string")
	})

	it("removing the only rule leaves an empty list (no phantom rule row)", () => {
		const { container, configs } = mount()
		fireEvent.click(addLinks(container)[0])
		fireEvent.click(
			container.querySelector('button[aria-label="Remove fill rule 1"]')!
		)
		expect(configs().fillColorRules).toEqual([])
		expect(condition(container, "fill")).toBeNull()
	})
})
