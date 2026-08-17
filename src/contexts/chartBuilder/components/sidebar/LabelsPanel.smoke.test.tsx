import { cleanup, fireEvent, render } from "@testing-library/react"
import { useAtomValue } from "jotai"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { afterEach, describe, expect, it } from "vitest"
import { stringifyJsonDangerous } from "../../../../lib/json"
import { DEFAULT_LABELS_CONFIG, type LabelsConfig } from "../../lib/labelsConfig"
import { emptyEncodings, type Encodings } from "../../lib/types"
import { currentLabelsAtom } from "../../store/atoms"

import { LabelsPanel } from "./LabelsPanel"

// ---------------------------------------------------------------------------
// Shared harness
// ---------------------------------------------------------------------------

// The panel's atoms all run `persistEffect`, which calls `setSelf(load())`
// on first read — clobbering anything seeded via `initializeState`. So
// non-default state has to be seeded through localStorage in the versioned
// `{ _v, data }` envelope the storage layer reads (same trick as the
// y-axis toggle smoke test).
const seedStorage = ({
	encodings,
	hideEmptyPanels,
	labels,
}: {
	encodings: Encodings
	hideEmptyPanels?: boolean
	labels?: Partial<LabelsConfig>
}) => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/no-storage-outside-try */
	window.localStorage.setItem(
		"vis-components:currentEncodings",
		stringifyJsonDangerous({ _v: 1, data: encodings })
	)
	if (hideEmptyPanels !== undefined) {
		window.localStorage.setItem(
			"vis-components:currentChannelConfigs",
			stringifyJsonDangerous({
				_v: 1,
				data: { facet: { hideEmptyPanels } },
			})
		)
	}
	if (labels !== undefined) {
		window.localStorage.setItem(
			"vis-components:currentLabels",
			stringifyJsonDangerous({
				_v: 1,
				data: { ...DEFAULT_LABELS_CONFIG, ...labels },
			})
		)
	}
	/* eslint-enable @th/no-storage-outside-try */
}

const gridEncodings = (): Encodings => ({
	...emptyEncodings(),
	facetRow: { field: "region" },
	facetCol: { field: "year" },
})

// Row presence is probed via the disclosure button's aria-label — it's the
// one element every LabelRow renders regardless of textless/placeholder.
const rowToggle = (container: HTMLElement, label: string) =>
	container.querySelector(
		`button[aria-label="Toggle font settings for ${label}"]`
	)

// Subsection header button: CollapsibleSubsection renders the title text as
// the button's only text content (chevron svg + changed-dot span are both
// aria-hidden and textless), so trimmed textContent identifies it uniquely.
const sectionHeader = (container: HTMLElement, title: string) =>
	[...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) =>
			b.getAttribute("aria-expanded") !== null &&
			b.textContent?.trim() === title
	) ?? null

const expandSection = (container: HTMLElement, title: string) => {
	const header = sectionHeader(container, title)
	expect(header, `subsection header "${title}"`).not.toBeNull()
	fireEvent.click(header!)
}

// The changed dot is the header button's only <span> (rounded-full, aria-
// hidden) — the chevron is an svg, the title is bare text.
const headerDot = (container: HTMLElement, title: string) =>
	sectionHeader(container, title)?.querySelector("span.rounded-full") ?? null

const renderPanel = (Probe?: () => React.ReactElement) =>
	render(
		<TestProvider>
			<LabelsPanel />
			{Probe ? <Probe /> : null}
		</TestProvider>
	)

// ---------------------------------------------------------------------------
// "Panel titles" row
// ---------------------------------------------------------------------------

/** "Panel titles" row: hide-empty compacted grids draw a per-panel title
 *  band, styled by the `facetPanelTitle` font slot. The row is config-gated
 *  on `channelConfigs.facet.hideEmptyPanels` (matching the "Hide empty
 *  panels" checkbox) AND only exists in the grid-split arm (both facet
 *  channels mapped) — these tests pin both gates plus the write path. */
describe("LabelsPanel — Panel titles row (hide-empty per-panel styling)", () => {
	afterEach(cleanup)

	// Probe that mirrors the facetPanelTitle override color out of the atom so
	// tests can assert the write landed without exposing atoms to the panel.
	const AtomProbe = () => {
		const labels = useAtomValue(currentLabelsAtom)
		return (
			<div
				data-testid="probe"
				data-panel-color={labels.fontOverrides?.facetPanelTitle?.color ?? ""}
			/>
		)
	}

	it("renders a textless 'Panel titles' row when both facet channels are mapped and hideEmptyPanels is on", () => {
		seedStorage({ encodings: gridEncodings(), hideEmptyPanels: true })
		const { container } = renderPanel()
		expandSection(container, "Facet titles")

		// Grid-split keeps each facet target as its own collapsible row (label +
		// chevron, no dead "Auto" input) since there are several to style.
		expect(rowToggle(container, "Panel titles")).not.toBeNull()
		expect(
			container.querySelector('input[aria-label="Panel titles (automatic)"]')
		).toBeNull()
	})

	it("hides the row when hideEmptyPanels is off (Column/Row titles still present)", () => {
		seedStorage({ encodings: gridEncodings(), hideEmptyPanels: false })
		const { container } = renderPanel()
		expandSection(container, "Facet titles")

		expect(rowToggle(container, "Panel titles")).toBeNull()
		expect(rowToggle(container, "Column titles")).not.toBeNull()
		expect(rowToggle(container, "Row titles")).not.toBeNull()
	})

	it("hides the row when only one facet channel is mapped, even with hideEmptyPanels on", () => {
		seedStorage({
			encodings: { ...emptyEncodings(), facetRow: { field: "region" } },
			hideEmptyPanels: true,
		})
		const { container } = renderPanel()
		expandSection(container, "Facet titles")

		expect(rowToggle(container, "Panel titles")).toBeNull()
		// Single-axis facet has one automatic title, so its styling controls are
		// shown inline (no per-row chevron) — the font editor's color swatch is
		// present straight away once the subsection is open.
		expect(
			container.querySelector('input[aria-label="Color swatch"]')
		).not.toBeNull()
	})

	it("setting a color via the row's font editor writes fontOverrides.facetPanelTitle", () => {
		seedStorage({ encodings: gridEncodings(), hideEmptyPanels: true })
		const { container } = renderPanel(AtomProbe)
		expandSection(container, "Facet titles")
		const probe = container.querySelector<HTMLElement>(
			'[data-testid="probe"]'
		)!
		expect(probe.dataset.panelColor).toBe("")

		// Open the row's disclosure — Headless UI unmounts closed panels, so
		// the font editor isn't in the DOM until then. Only this one panel is
		// open, so its color swatch is the only one on the page.
		fireEvent.click(rowToggle(container, "Panel titles")!)
		const swatch = container.querySelector<HTMLInputElement>(
			'input[aria-label="Color swatch"]'
		)
		expect(swatch).not.toBeNull()
		fireEvent.change(swatch!, { target: { value: "#ff0000" } })

		expect(probe.dataset.panelColor).toBe("#ff0000")
	})
})

// ---------------------------------------------------------------------------
// Collapsible subsections
// ---------------------------------------------------------------------------

/** The Labels panel groups its rows into four CollapsibleSubsections —
 *  Primary / Axis / Facet / Legend titles — all collapsed by default, with
 *  the header changed-dot lighting only for STYLING deviations (font
 *  override / non-center alignment / offset), never for typed title text. */
describe("LabelsPanel — collapsible subsections", () => {
	afterEach(cleanup)

	// Both facet channels + a legend channel (hue) active → all four
	// subsections render.
	const fullEncodings = (): Encodings => ({
		...gridEncodings(),
		hue: { field: "category" },
	})

	const SECTION_TITLES = [
		"Primary titles",
		"Axis titles",
		"Facet titles",
		"Legend titles",
	]

	it("renders all four subsection headers collapsed by default", () => {
		seedStorage({ encodings: fullEncodings() })
		const { container } = renderPanel()

		for (const title of SECTION_TITLES) {
			const header = sectionHeader(container, title)
			expect(header, `header "${title}"`).not.toBeNull()
			expect(header!.getAttribute("aria-expanded")).toBe("false")
		}
		// Collapsed → no rows in the document until a section is expanded.
		expect(rowToggle(container, "Title")).toBeNull()
		expect(
			container.querySelector('textarea[placeholder="Untitled chart"]')
		).toBeNull()
		expect(rowToggle(container, "X-axis title")).toBeNull()
		expect(rowToggle(container, "Column titles")).toBeNull()
		expect(rowToggle(container, "Color legend")).toBeNull()
	})

	it("expanding 'Primary titles' reveals the Title + Subtitle rows", () => {
		seedStorage({ encodings: fullEncodings() })
		const { container } = renderPanel()

		expandSection(container, "Primary titles")
		expect(rowToggle(container, "Title")).not.toBeNull()
		expect(rowToggle(container, "Subtitle")).not.toBeNull()
		// Other sections stay collapsed.
		expect(rowToggle(container, "X-axis title")).toBeNull()
	})

	it("expanding 'Axis titles' reveals the X/Y axis title rows", () => {
		seedStorage({ encodings: fullEncodings() })
		const { container } = renderPanel()

		expandSection(container, "Axis titles")
		expect(rowToggle(container, "X-axis title")).not.toBeNull()
		expect(rowToggle(container, "Y-axis title")).not.toBeNull()
		expect(rowToggle(container, "Title")).toBeNull()
	})

	it("fresh default labels state → no changed-dot on any subsection header", () => {
		seedStorage({ encodings: fullEncodings() })
		const { container } = renderPanel()

		for (const title of SECTION_TITLES) {
			expect(headerDot(container, title), `dot on "${title}"`).toBeNull()
		}
	})

	it("a font override on Title lights the 'Primary titles' dot (only)", () => {
		seedStorage({
			encodings: fullEncodings(),
			labels: { fontOverrides: { title: { color: "#ff0000" } } },
		})
		const { container } = renderPanel()

		expect(headerDot(container, "Primary titles")).not.toBeNull()
		expect(headerDot(container, "Axis titles")).toBeNull()
		expect(headerDot(container, "Facet titles")).toBeNull()
		expect(headerDot(container, "Legend titles")).toBeNull()
	})

	it("typed title TEXT alone is content, not styling — no dot", () => {
		seedStorage({
			encodings: fullEncodings(),
			labels: { title: "Hello" },
		})
		const { container } = renderPanel()

		for (const title of SECTION_TITLES) {
			expect(headerDot(container, title), `dot on "${title}"`).toBeNull()
		}
	})

	it("non-faceted + no legend channels → Facet/Legend subsections absent entirely", () => {
		seedStorage({ encodings: emptyEncodings() })
		const { container } = renderPanel()

		expect(sectionHeader(container, "Primary titles")).not.toBeNull()
		expect(sectionHeader(container, "Axis titles")).not.toBeNull()
		expect(sectionHeader(container, "Facet titles")).toBeNull()
		expect(sectionHeader(container, "Legend titles")).toBeNull()
	})
})
