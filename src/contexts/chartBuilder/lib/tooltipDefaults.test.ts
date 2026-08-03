import { describe, expect, it } from "vitest"

import { DEFAULT_TOOLTIP_CSS, buildDefaultTooltipHtml } from "./tooltipDefaults"

describe("buildDefaultTooltipHtml", () => {
	it("returns a placeholder row when no fields are mapped (so the user sees a comment hinting next steps)", () => {
		const out = buildDefaultTooltipHtml([])
		expect(out).toContain("vc-tooltip-row")
		expect(out).toContain("<!--")
	})

	it("emits one row per field with {{fieldName}} placeholders", () => {
		const out = buildDefaultTooltipHtml(["state", "sales"])
		// Each row labels the field then interpolates its value.
		expect(out).toMatch(
			/<span class="vc-tooltip-name">state:<\/span>\s*<span class="vc-tooltip-value">\{\{state\}\}<\/span>/
		)
		expect(out).toMatch(
			/<span class="vc-tooltip-name">sales:<\/span>\s*<span class="vc-tooltip-value">\{\{sales\}\}<\/span>/
		)
	})

	it("produces valid placeholders that match the {{fieldName}} render syntax", () => {
		// renderTemplate (in HoverTooltip) only substitutes `{{name}}` tokens;
		// the template we hand the user must use that exact form, not e.g.
		// `${name}` or single-brace `{name}`. The regex below pins the
		// exact double-brace shape — `{{price}}` matches; `{price}` and
		// `${price}` do not.
		const out = buildDefaultTooltipHtml(["price"])
		expect(out).toContain("{{price}}")
		expect(out).toMatch(/\{\{price\}\}/)
		// Single-brace tokens (without the doubling) would mean the
		// renderer leaves them untouched at runtime — guard against that.
		expect(out).not.toMatch(/(?<!\{)\{price\}(?!\})/)
		expect(out).not.toContain("${price}")
	})
})

describe("DEFAULT_TOOLTIP_CSS", () => {
	it("contains the rules a user would expect to see when restyling the tooltip", () => {
		// Spot-check that the default actually carries content; an empty
		// constant would defeat the purpose of pre-populating.
		expect(DEFAULT_TOOLTIP_CSS).toContain("border")
		expect(DEFAULT_TOOLTIP_CSS).toContain("background")
		expect(DEFAULT_TOOLTIP_CSS).toContain("padding")
	})
})
