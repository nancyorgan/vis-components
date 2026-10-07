import { cleanup, fireEvent, render } from "@testing-library/react"
import { useAtomValue } from "jotai"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { afterEach, describe, expect, it } from "vitest"
import { stringifyJsonDangerous } from "../../../../lib/json"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { currentLabelsAtom } from "../../store/atoms"

import { LabelsPanel } from "./LabelsPanel"

/** The Title row's "Add prefix" checkbox reveals a Prefix text box + font
 *  editor and writes `labels.titlePrefix`; unchecking hides the box but
 *  KEEPS the typed text so re-checking restores it. */
describe("LabelsPanel — title prefix", () => {
	afterEach(cleanup)

	const initState = (snap: TestStore) => {
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
	}

	const AtomProbe = () => {
		const labels = useAtomValue(currentLabelsAtom)
		return (
			<div
				data-testid="probe"
				data-prefix={stringifyJsonDangerous(labels.titlePrefix ?? null)}
			/>
		)
	}

	// The control lives in the Title row's disclosure inside the
	// collapsed-by-default "Primary titles" subsection.
	const openTitleDisclosure = (container: HTMLElement) => {
		const subsection = [
			...container.querySelectorAll<HTMLButtonElement>("button"),
		].find((b) => b.textContent?.trim() === "Primary titles")
		expect(subsection).toBeDefined()
		fireEvent.click(subsection!)
		const button = container.querySelector(
			'button[aria-label="Toggle font settings for Title"]'
		)
		expect(button).not.toBeNull()
		fireEvent.click(button!)
	}

	const prefixInput = (container: HTMLElement) =>
		container.querySelector<HTMLInputElement>('input[placeholder="FIGURE 1."]')

	const addPrefixLabel = (container: HTMLElement) => {
		const label = [...container.querySelectorAll("label")].find(
			(l) => l.textContent?.trim() === "Add prefix"
		)
		expect(label).toBeDefined()
		return label!
	}

	it("checkbox reveals the Prefix box; typing stores the text; unchecking keeps it", () => {
		installInMemoryLocalStorage()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<LabelsPanel />
				<AtomProbe />
			</TestProvider>
		)
		const probe = container.querySelector<HTMLElement>('[data-testid="probe"]')!
		openTitleDisclosure(container as HTMLElement)

		// Hidden until checked — no inert Prefix box.
		expect(prefixInput(container as HTMLElement)).toBeNull()
		expect(probe.dataset.prefix).toBe("null")

		fireEvent.click(addPrefixLabel(container as HTMLElement))
		const input = prefixInput(container as HTMLElement)
		expect(input).not.toBeNull()
		expect(JSON.parse(probe.dataset.prefix!)).toEqual({ enabled: true, text: "" })

		fireEvent.change(input!, { target: { value: "FIGURE 5." } })
		expect(JSON.parse(probe.dataset.prefix!)).toEqual({
			enabled: true,
			text: "FIGURE 5.",
		})

		// The font editor for the prefix is present (Family select + Size
		// box), with no alignment control of its own.
		const panel = input!.closest("div.flex-col")!
		expect(panel.querySelector("select")).not.toBeNull()

		fireEvent.click(addPrefixLabel(container as HTMLElement))
		expect(prefixInput(container as HTMLElement)).toBeNull()
		expect(JSON.parse(probe.dataset.prefix!)).toEqual({
			enabled: false,
			text: "FIGURE 5.",
		})
	})
})
