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
	/* eslint-disable @vc/no-storage-outside-try */
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
	/* eslint-enable @vc/no-storage-outside-try */
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
// "Facet titles (panel)" subsection
// ---------------------------------------------------------------------------

/** "Facet titles (panel)" subsection: hide-empty compacted grids draw a
 *  per-panel title band, styled by the `facetPanelTitle` font slot. It is
 *  config-gated
 *  on `channelConfigs.facet.hideEmptyPanels` (matching the "Hide empty
 *  panels" checkbox) AND only exists in the grid-split arm (both facet
 *  channels mapped) — these tests pin both gates plus the write path. */
describe("LabelsPanel — Facet titles (panel) subsection (hide-empty per-panel styling)", () => {
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

	it("splits into row / column / panel subsections when both facet channels are mapped and hideEmptyPanels is on", () => {
		seedStorage({ encodings: gridEncodings(), hideEmptyPanels: true })
		const { container } = renderPanel()

		// Grid-split replaces the single "Facet titles" subsection with one
		// sibling subsection per header strip.
		expect(sectionHeader(container, "Facet titles")).toBeNull()
		expect(sectionHeader(container, "Facet titles (row)")).not.toBeNull()
		expect(sectionHeader(container, "Facet titles (column)")).not.toBeNull()
		expect(sectionHeader(container, "Facet titles (panel)")).not.toBeNull()

		// Each subsection's styling controls render inline once opened.
		expandSection(container, "Facet titles (panel)")
		expect(container.querySelector("button[data-color]")).not.toBeNull()
	})

	it("omits the panel subsection when hideEmptyPanels is off (row/column still present)", () => {
		seedStorage({ encodings: gridEncodings(), hideEmptyPanels: false })
		const { container } = renderPanel()

		expect(sectionHeader(container, "Facet titles (panel)")).toBeNull()
		expect(sectionHeader(container, "Facet titles (row)")).not.toBeNull()
		expect(sectionHeader(container, "Facet titles (column)")).not.toBeNull()
	})

	it("hides the row when only one facet channel is mapped, even with hideEmptyPanels on", () => {
		seedStorage({
			encodings: { ...emptyEncodings(), facetRow: { field: "region" } },
			hideEmptyPanels: true,
		})
		const { container } = renderPanel()
		expandSection(container, "Facet titles")

		expect(sectionHeader(container, "Facet titles (panel)")).toBeNull()
		// Single-axis facet has one automatic title, so its styling controls are
		// shown inline (no per-row chevron) — the font editor's color swatch is
		// present straight away once the subsection is open.
		expect(container.querySelector("button[data-color]")).not.toBeNull()
	})

	it("setting a color in the panel subsection writes fontOverrides.facetPanelTitle", () => {
		seedStorage({ encodings: gridEncodings(), hideEmptyPanels: true })
		const { container } = renderPanel(AtomProbe)
		const probe = container.querySelector<HTMLElement>(
			'[data-testid="probe"]'
		)!
		expect(probe.dataset.panelColor).toBe("")

		// Only this one subsection is open, so its color swatch is the only
		// one on the page.
		expandSection(container, "Facet titles (panel)")
		const swatch = container.querySelector<HTMLButtonElement>(
			"button[data-color]"
		)
		expect(swatch).not.toBeNull()
		fireEvent.click(swatch!)
		fireEvent.change(document.body.querySelector('input[aria-label="Hex code"]')!, {
			target: { value: "#ff0000" },
		})

		// ColorInput normalizes swatch picks to uppercase hex.
		expect(probe.dataset.panelColor).toBe("#FF0000")
	})
})

// ---------------------------------------------------------------------------
// Facet-title Placement
// ---------------------------------------------------------------------------

/** The per-panel facet-title rows (wrap "Facet titles", compact-grid "Facet
 *  titles (panel)") lead with a Placement select; a side placement adds the
 *  "Read title horizontally" box, swaps the horizontal Align + Angle rows for
 *  Vertical align while the title reads vertically, and lights the dot. The
 *  half-pair strips (row-only / column-only) are not placeable. */
describe("LabelsPanel — facet-title placement", () => {
	afterEach(cleanup)

	const PlacementProbe = () => {
		const labels = useAtomValue(currentLabelsAtom)
		return (
			<div
				data-testid="placement-probe"
				data-placement={stringifyJsonDangerous(labels.titlePlacements ?? {})}
			/>
		)
	}
	const placementSelect = (container: HTMLElement) =>
		[...container.querySelectorAll<HTMLLabelElement>("label")]
			.find((l) => l.textContent?.startsWith("Placement"))
			?.querySelector("select") ?? null
	const horizontalBox = (container: HTMLElement) =>
		[...container.querySelectorAll<HTMLLabelElement>("label")].find(
			(l) => l.textContent === "Read title horizontally"
		) ?? null
	const rowLabel = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll<HTMLSpanElement>("span")].find(
			(s) => s.textContent === text
		) ?? null

	it("wrap facet: Placement leads the row; Left adds the checkbox, hides Align + Angle, shows Vertical align, and writes titlePlacements", () => {
		seedStorage({ encodings: { ...emptyEncodings(), facet: { field: "g" } } })
		const { container } = renderPanel(PlacementProbe)
		expandSection(container, "Facet titles")
		const select = placementSelect(container)
		expect(select).not.toBeNull()
		expect(select!.value).toBe("top")
		expect(horizontalBox(container)).toBeNull()
		expect(rowLabel(container, "Align")).not.toBeNull()
		expect(rowLabel(container, "Vertical align")).toBeNull()

		fireEvent.change(select!, { target: { value: "left" } })
		const probe = container.querySelector<HTMLElement>('[data-testid="placement-probe"]')!
		expect(probe.dataset.placement).toBe(stringifyJsonDangerous({ facetTitle: { side: "left" } }))
		expect(horizontalBox(container)).not.toBeNull()
		expect(rowLabel(container, "Align")).toBeNull()
		expect(rowLabel(container, "Horizontal align")).toBeNull()
		expect(rowLabel(container, "Vertical align")).not.toBeNull()
		expect(headerDot(container, "Facet titles")).not.toBeNull()

		// Reading horizontally brings the horizontal align back (relabeled).
		fireEvent.click(horizontalBox(container)!)
		expect(probe.dataset.placement).toBe(
			stringifyJsonDangerous({ facetTitle: { side: "left", horizontal: true } })
		)
		expect(rowLabel(container, "Horizontal align")).not.toBeNull()
		expect(rowLabel(container, "Vertical align")).not.toBeNull()

		// Back to Top clears the entry and the dot.
		fireEvent.change(placementSelect(container)!, { target: { value: "top" } })
		expect(probe.dataset.placement).toBe(stringifyJsonDangerous({}))
		expect(headerDot(container, "Facet titles")).toBeNull()
	})

	it("row-only and column-only facets (strips) offer no Placement", () => {
		seedStorage({ encodings: { ...emptyEncodings(), facetRow: { field: "region" } } })
		const { container } = renderPanel()
		expandSection(container, "Facet titles")
		expect(placementSelect(container)).toBeNull()
	})

	it("compact-grid panel titles are placeable too", () => {
		seedStorage({ encodings: gridEncodings(), hideEmptyPanels: true })
		const { container } = renderPanel(PlacementProbe)
		expandSection(container, "Facet titles (panel)")
		const select = placementSelect(container)
		expect(select).not.toBeNull()
		fireEvent.change(select!, { target: { value: "right" } })
		const probe = container.querySelector<HTMLElement>('[data-testid="placement-probe"]')!
		expect(probe.dataset.placement).toBe(
			stringifyJsonDangerous({ facetPanelTitle: { side: "right" } })
		)
		// The strips' rows stay un-placeable.
		expandSection(container, "Facet titles (column)")
		expect(
			[...container.querySelectorAll("label")].filter((l) =>
				l.textContent?.startsWith("Placement")
			).length
		).toBe(1)
	})
})

// ---------------------------------------------------------------------------
// Collapsible subsections
// ---------------------------------------------------------------------------

/** The Labels panel groups its rows into CollapsibleSubsections —
 *  Primary / Axis / Facet (split row / column in a grid) / Legend titles — all collapsed by default, with
 *  the header changed-dot lighting only for STYLING deviations (font
 *  override / non-center alignment / offset), never for typed title text. */
describe("LabelsPanel — collapsible subsections", () => {
	afterEach(cleanup)

	// Both facet channels + a legend channel (hue) active → every
	// subsection renders (facet titles split into row / column).
	const fullEncodings = (): Encodings => ({
		...gridEncodings(),
		hue: { field: "category" },
	})

	const SECTION_TITLES = [
		"Primary titles",
		"Axis titles",
		"Facet titles (row)",
		"Facet titles (column)",
		"Legend titles",
	]

	it("renders every subsection header collapsed by default", () => {
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
		expect(container.querySelector("button[data-color]")).toBeNull()
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
		expect(headerDot(container, "Facet titles (row)")).toBeNull()
		expect(headerDot(container, "Facet titles (column)")).toBeNull()
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

// ---------------------------------------------------------------------------
// Alignment vs. theme base
// ---------------------------------------------------------------------------

/** The renderer resolves a title's alignment as the per-visual
 *  `titleAlignments` entry, else the THEME base (`baseFont.titles.
 *  primaryAlignment`). The sidebar keeps the map sparse by dropping entries
 *  that match that base — so on a theme whose primary title is left-aligned,
 *  clicking Center must WRITE "center" (dropping it would fall back to left,
 *  which is the bug that made the button look dead). */
describe("LabelsPanel — alignment writes relative to the theme base", () => {
	afterEach(cleanup)

	const AlignProbe = () => {
		const labels = useAtomValue(currentLabelsAtom)
		return (
			<div
				data-testid="align-probe"
				data-title-align={labels.titleAlignments?.title ?? ""}
			/>
		)
	}

	const seedWithBase = (primaryAlignment: "left" | "center" | "right") =>
		seedStorage({
			encodings: emptyEncodings(),
			labels: {
				baseFont: {
					...DEFAULT_LABELS_CONFIG.baseFont,
					titles: { ...DEFAULT_LABELS_CONFIG.baseFont.titles, primaryAlignment },
				},
			},
		})

	const openTitleAlign = (container: HTMLElement) => {
		expandSection(container, "Primary titles")
		fireEvent.click(rowToggle(container, "Title")!)
		const btn = (label: string) =>
			container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
		return { center: btn("Center")!, left: btn("Align left")!, right: btn("Align right")! }
	}

	it("theme base LEFT: clicking Center writes an explicit 'center' entry", () => {
		seedWithBase("left")
		const { container } = renderPanel(AlignProbe)
		const probe = container.querySelector<HTMLElement>('[data-testid="align-probe"]')!
		const { center, left } = openTitleAlign(container)

		// Untouched → no entry; the Left button reflects the theme base.
		expect(probe.dataset.titleAlign).toBe("")
		expect(left.getAttribute("aria-pressed")).toBe("true")

		fireEvent.click(center)
		expect(probe.dataset.titleAlign).toBe("center")
		expect(center.getAttribute("aria-pressed")).toBe("true")

		// Back to the base drops the entry again (map stays sparse).
		fireEvent.click(left)
		expect(probe.dataset.titleAlign).toBe("")
	})

	it("theme base CENTER (default): Center drops the entry, Left/Right write one", () => {
		seedWithBase("center")
		const { container } = renderPanel(AlignProbe)
		const probe = container.querySelector<HTMLElement>('[data-testid="align-probe"]')!
		const { center, right } = openTitleAlign(container)

		fireEvent.click(right)
		expect(probe.dataset.titleAlign).toBe("right")
		fireEvent.click(center)
		expect(probe.dataset.titleAlign).toBe("")
	})
})

// ---------------------------------------------------------------------------
// Secondary-tier inherit entries
// ---------------------------------------------------------------------------

/** Axis and facet titles render through resolveTitleFont's "secondary" slot,
 *  which prefers the theme's per-slot axis-title family / color
 *  (`secondaryFamily` / `secondaryColor`) over the shared title values. The
 *  Family select's "(inherit)" entry — and the color swatch — must name the
 *  same thing, or the dropdown claims one family while the chart draws
 *  another (the bundled themes set Fraunces titles over Quicksand axis
 *  titles, so this was visible out of the box). */
describe("LabelsPanel — secondary-tier inherit entries follow the axis-title slots", () => {
	afterEach(cleanup)

	const INTER = "Inter, system-ui, sans-serif"
	const QUICKSAND = "'Quicksand', system-ui, sans-serif"

	const seedSplitFamilies = (encodings: Encodings) =>
		seedStorage({
			encodings,
			labels: {
				baseFont: {
					...DEFAULT_LABELS_CONFIG.baseFont,
					titles: {
						...DEFAULT_LABELS_CONFIG.baseFont.titles,
						family: INTER,
						secondaryFamily: QUICKSAND,
						color: "#111111",
						secondaryColor: "#222222",
					},
				},
			},
		})

	// FontEditor's Family row is a <label> whose first child span reads
	// "Family"; the select's first option is the inherit entry.
	const familyInheritEntries = (container: HTMLElement) =>
		[...container.querySelectorAll<HTMLSelectElement>("select")]
			.filter(
				(s) =>
					s.closest("label")?.firstElementChild?.textContent?.trim() ===
					"Family"
			)
			.map((s) => s.options[0]?.text ?? "")

	it("names the axis-title family for a row-only facet's title control", () => {
		seedSplitFamilies({ ...emptyEncodings(), facetRow: { field: "region" } })
		const { container } = renderPanel()
		expandSection(container, "Facet titles")
		expect(familyInheritEntries(container)).toEqual(["(Quicksand)"])
		// The swatch previews the axis-title color, not the shared title color.
		const swatch = container.querySelector<HTMLButtonElement>(
			"button[data-color]"
		)
		expect(swatch?.dataset.color).toBe("#222222")
	})

	it("names the axis-title family for the x-axis title row", () => {
		seedSplitFamilies({ ...emptyEncodings(), x: { field: "x" } })
		const { container } = renderPanel()
		expandSection(container, "Axis titles")
		fireEvent.click(rowToggle(container, "X-axis title")!)
		expect(familyInheritEntries(container)).toEqual(["(Quicksand)"])
	})

	it("keeps the primary title on the shared title family", () => {
		seedSplitFamilies({ ...emptyEncodings(), x: { field: "x" } })
		const { container } = renderPanel()
		expandSection(container, "Primary titles")
		fireEvent.click(rowToggle(container, "Title")!)
		expect(familyInheritEntries(container)).toEqual(["(Inter)"])
	})
})
