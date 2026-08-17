import { cleanup, fireEvent, render } from "@testing-library/react"
import { useAtomValue } from "jotai"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { currentLabelsAtom } from "../../store/atoms"

import { LabelsPanel } from "./LabelsPanel"

/** Pin the toggle-migration: clicking the "Read y-axis title horizontally"
 *  checkbox MUST update `currentLabelsAtom.yAxisTitleHorizontal`. After
 *  the migration to the shared `Toggle` primitive, a user reported the
 *  toggle didn't seem to affect the chart — this test verifies the state
 *  flow is intact at the panel→atom boundary. (Chart re-render is
 *  separately verified by Jotai's reactivity contract.) */
describe("LabelsPanel — y-axis horizontal toggle wiring", () => {
	afterEach(cleanup)

	const initState = (snap: TestStore) => {
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
	}

	// Tiny probe that reads the atom and writes its value to a known
	// data-attribute. Lets tests assert on state without exposing atoms
	// to the renderer code.
	const AtomProbe = () => {
		const labels = useAtomValue(currentLabelsAtom)
		return (
			<div
				data-testid="probe"
				data-horizontal={String(!!labels.yAxisTitleHorizontal)}
			/>
		)
	}

	// The toggle lives inside the Y-axis title's collapsible Disclosure.Panel,
	// which itself sits inside the collapsed-by-default "Axis titles"
	// subsection — so each test expands the subsection first, then the row's
	// disclosure (Headless UI unmounts panel children when closed).
	const openYAxisDisclosure = (container: HTMLElement) => {
		const subsection = [
			...container.querySelectorAll<HTMLButtonElement>("button"),
		].find((b) => b.textContent?.trim() === "Axis titles")
		expect(subsection).toBeDefined()
		fireEvent.click(subsection!)
		const button = container.querySelector(
			'button[aria-label="Toggle font settings for Y-axis title"]'
		)
		expect(button).toBeDefined()
		fireEvent.click(button!)
	}

	it("clicking the toggle flips yAxisTitleHorizontal from false → true in the atom", () => {
		installInMemoryLocalStorage()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<LabelsPanel />
				<AtomProbe />
			</TestProvider>
		)
		const probe = container.querySelector<HTMLElement>(
			'[data-testid="probe"]',
		)!
		expect(probe.dataset.horizontal).toBe("false")

		openYAxisDisclosure(container as HTMLElement)

		// Find the toggle's checkbox by label text. The Toggle primitive
		// renders a <label htmlFor> linked to the checkbox.
		const labels = [
			...container.querySelectorAll("label"),
		] as HTMLLabelElement[]
		const label = labels.find((l) =>
			l.textContent?.includes("Read y-axis title horizontally")
		)
		expect(label).toBeDefined()
		fireEvent.click(label!)

		expect(probe.dataset.horizontal).toBe("true")
	})

	it("clicking the toggle again flips it back from true → false", () => {
		// Seed localStorage too — `persistEffect` calls `setSelf(load())` on
		// first read, which would otherwise clobber `initializeState`.
		installInMemoryLocalStorage()
		/* eslint-disable @th/use-wrapped-json-functions */
		// eslint-disable-next-line @th/no-storage-outside-try
		window.localStorage.setItem(
			"vis-components:currentLabels",
			JSON.stringify({
				_v: 1,
				data: { ...DEFAULT_LABELS_CONFIG, yAxisTitleHorizontal: true },
			})
		)
		/* eslint-enable @th/use-wrapped-json-functions */
		const { container } = render(
			<TestProvider
				initializeState={(snap) => {
					snap.set(currentLabelsAtom, {
						...DEFAULT_LABELS_CONFIG,
						yAxisTitleHorizontal: true,
					})
				}}
			>
				<LabelsPanel />
				<AtomProbe />
			</TestProvider>
		)
		const probe = container.querySelector<HTMLElement>(
			'[data-testid="probe"]',
		)!
		expect(probe.dataset.horizontal).toBe("true")

		openYAxisDisclosure(container as HTMLElement)

		const labels = [
			...container.querySelectorAll("label"),
		] as HTMLLabelElement[]
		const label = labels.find((l) =>
			l.textContent?.includes("Read y-axis title horizontally")
		)
		fireEvent.click(label!)

		expect(probe.dataset.horizontal).toBe("false")
	})
})
