import { describe, expect, it } from "vitest"
import { LIBRARY_BUNDLE_FILENAME } from "./libraryBundle"
import { bundleFilenameFor, sanitizeVisualFilename } from "./downloadVisuals"

describe("sanitizeVisualFilename", () => {
	it("lowercases and dashes spaces", () => {
		expect(sanitizeVisualFilename("Q3 Revenue By Region")).toBe(
			"q3-revenue-by-region"
		)
	})

	it("collapses runs of punctuation into a single dash", () => {
		expect(sanitizeVisualFilename("Sales // 2026 — draft (v2)")).toBe(
			"sales-2026-draft-v2"
		)
	})

	it("trims leading and trailing dashes", () => {
		expect(sanitizeVisualFilename("  ...Untitled!  ")).toBe("untitled")
	})

	it("falls back when nothing survives sanitizing", () => {
		expect(sanitizeVisualFilename("📊📈")).toBe("visualization")
		expect(sanitizeVisualFilename("")).toBe("visualization")
	})

	it("caps the length without leaving a trailing dash", () => {
		const slug = sanitizeVisualFilename(`${"a".repeat(79)} tail`)
		expect(slug.length).toBeLessThanOrEqual(80)
		expect(slug.endsWith("-")).toBe(false)
	})
})

describe("bundleFilenameFor", () => {
	it("names a single download after the visual", () => {
		expect(bundleFilenameFor([{ id: "vs-1", name: "My Chart" }])).toBe(
			"my-chart.json"
		)
	})

	it("uses the generic bundle name for multiple visuals", () => {
		expect(
			bundleFilenameFor([
				{ id: "vs-1", name: "My Chart" },
				{ id: "vs-2", name: "Other" },
			])
		).toBe(LIBRARY_BUNDLE_FILENAME)
	})

	it("uses the generic bundle name for an empty selection", () => {
		expect(bundleFilenameFor([])).toBe(LIBRARY_BUNDLE_FILENAME)
	})
})
