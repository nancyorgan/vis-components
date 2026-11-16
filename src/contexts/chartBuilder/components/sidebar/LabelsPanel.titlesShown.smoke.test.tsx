import { cleanup, fireEvent, render } from "@testing-library/react"
import { useAtomValue } from "jotai"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { afterEach, describe, expect, it } from "vitest"
import { stringifyJsonDangerous } from "../../../../lib/json"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	currentEncodingsAtom,
	currentLabelsAtom,
	renderedLabelsAtom,
} from "../../store/atoms"
import { emptyEncodings } from "../../lib/types"

import { LabelsPanel } from "./LabelsPanel"

/** "Titles shown" (first subsection) checks every title by default;
 *  unchecking one writes a sparse `hiddenTitles` entry, drops that title's
 *  editor row, and blanks it in what the chart draws — while the typed text
 *  survives for re-checking. */
describe("LabelsPanel — Titles shown", () => {
	afterEach(cleanup)

	const initState = (snap: TestStore) => {
		snap.set(currentLabelsAtom, {
			...DEFAULT_LABELS_CONFIG,
			hiddenTitles: undefined,
			title: "Sales",
			subtitle: "By region",
		})
	}

	const AtomProbe = () => {
		const labels = useAtomValue(currentLabelsAtom)
		const drawn = useAtomValue(renderedLabelsAtom)
		return (
			<div
				data-testid="probe"
				data-hidden={stringifyJsonDangerous(labels.hiddenTitles ?? null)}
				data-title={labels.title}
				data-drawn-title={drawn.title}
			/>
		)
	}

	const button = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent?.trim() === text
		)
	const toggleLabel = (container: HTMLElement, text: string) => {
		const label = [...container.querySelectorAll("label")].find(
			(l) => l.textContent?.trim() === text
		)
		expect(label).toBeDefined()
		return label!
	}
	const titleRow = (container: HTMLElement) =>
		container.querySelector('button[aria-label="Toggle font settings for Title"]')

	it("defaults to all checked; unchecking hides the row and the drawn title; re-checking restores", () => {
		installInMemoryLocalStorage()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<LabelsPanel />
				<AtomProbe />
			</TestProvider>
		)
		const el = container as HTMLElement
		const probe = el.querySelector<HTMLElement>('[data-testid="probe"]')!

		fireEvent.click(button(el, "Titles shown")!)
		for (const name of ["Title", "Subtitle", "X-axis title", "Y-axis title"]) {
			const label = toggleLabel(el, name)
			const input = el.querySelector<HTMLInputElement>(
				`input[id="${label.htmlFor}"]`
			)
			expect(input?.checked).toBe(true)
		}
		fireEvent.click(button(el, "Primary titles")!)
		expect(titleRow(el)).not.toBeNull()

		fireEvent.click(toggleLabel(el, "Title"))
		expect(JSON.parse(probe.dataset.hidden!)).toEqual({ title: true })
		expect(probe.dataset.title).toBe("Sales")
		expect(probe.dataset.drawnTitle).toBe("")
		expect(titleRow(el)).toBeNull()

		// Hiding both primary titles removes the subsection entirely.
		fireEvent.click(toggleLabel(el, "Subtitle"))
		expect(button(el, "Primary titles")).toBeUndefined()

		fireEvent.click(toggleLabel(el, "Title"))
		fireEvent.click(toggleLabel(el, "Subtitle"))
		// Sparse: nothing hidden → no block at all.
		expect(probe.dataset.hidden).toBe("null")
		expect(probe.dataset.drawnTitle).toBe("Sales")
	})

	it("a fresh chart starts with Title and Subtitle unchecked (no dot); checking Title brings its row", () => {
		installInMemoryLocalStorage()
		const { container } = render(
			<TestProvider
				initializeState={(snap) => snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)}
			>
				<LabelsPanel />
				<AtomProbe />
			</TestProvider>
		)
		const el = container as HTMLElement
		const probe = el.querySelector<HTMLElement>('[data-testid="probe"]')!
		const header = button(el, "Titles shown")!
		expect(header.querySelector("span.rounded-full")).toBeNull()
		fireEvent.click(header)
		const checked = (name: string) =>
			el.querySelector<HTMLInputElement>(
				`input[id="${toggleLabel(el, name).htmlFor}"]`
			)?.checked
		expect(checked("Title")).toBe(false)
		expect(checked("Subtitle")).toBe(false)
		// Nothing to edit yet, so no Primary titles subsection.
		expect(button(el, "Primary titles")).toBeUndefined()

		fireEvent.click(toggleLabel(el, "Title"))
		expect(JSON.parse(probe.dataset.hidden!)).toEqual({ subtitle: true })
		fireEvent.click(button(el, "Primary titles")!)
		expect(titleRow(el)).not.toBeNull()
	})

	it("hiding both axis titles drops the Axis titles subsection", () => {
		installInMemoryLocalStorage()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<LabelsPanel />
			</TestProvider>
		)
		const el = container as HTMLElement
		fireEvent.click(button(el, "Titles shown")!)
		expect(button(el, "Axis titles")).toBeDefined()
		fireEvent.click(toggleLabel(el, "X-axis title"))
		expect(button(el, "Axis titles")).toBeDefined()
		fireEvent.click(toggleLabel(el, "Y-axis title"))
		expect(button(el, "Axis titles")).toBeUndefined()
	})

	it("offers one Facet titles box on a wrap facet; Column / Row boxes on a both-axes grid", () => {
		installInMemoryLocalStorage()
		const wrap = emptyEncodings()
		wrap.facet = { field: "r" }
		const { container, unmount } = render(
			<TestProvider
				initializeState={(snap) => {
					initState(snap)
					snap.set(currentEncodingsAtom, wrap)
				}}
			>
				<LabelsPanel />
			</TestProvider>
		)
		let el = container as HTMLElement
		fireEvent.click(button(el, "Titles shown")!)
		expect(button(el, "Facet titles")).toBeDefined()
		fireEvent.click(toggleLabel(el, "Facet titles"))
		expect(button(el, "Facet titles")).toBeUndefined()
		unmount()

		const grid = emptyEncodings()
		grid.facetRow = { field: "r" }
		grid.facetCol = { field: "c" }
		const second = render(
			<TestProvider
				initializeState={(snap) => {
					initState(snap)
					snap.set(currentEncodingsAtom, grid)
				}}
			>
				<LabelsPanel />
			</TestProvider>
		)
		el = second.container as HTMLElement
		fireEvent.click(button(el, "Titles shown")!)
		fireEvent.click(toggleLabel(el, "Facet titles (column)"))
		expect(button(el, "Facet titles (column)")).toBeUndefined()
		expect(button(el, "Facet titles (row)")).toBeDefined()
	})
})
