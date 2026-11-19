import { cleanup, fireEvent, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { ChannelConfigs } from "../../../../lib/channelConfig"

import { FillCategory } from "./categories"
import { SegmentsRow } from "./SegmentsRow"
import { BARS, SCATTER, SEGMENTS, mountPiece, withPattern } from "./testMount"

/** One category's fill rows, and the Segments toggle. */

afterEach(cleanup)

const pattern = (more: Record<string, unknown>): Partial<ChannelConfigs> =>
	({ pattern: more }) as unknown as Partial<ChannelConfigs>

describe("FillCategory — one category's pattern, ink, scale and rotation", () => {
	it("None writes the category's override; ink, scale and rotate then stand down", () => {
		const { container, configs } = mountPiece(withPattern(BARS, "group"), {}, (p) => (
			<FillCategory p={p} v="B" i={1} />
		))
		const q = within(container)
		// A bar chart auto-cycles patterns, so the styling rows show at once.
		expect(q.queryByText("Ink color")).not.toBeNull()
		fireEvent.click(q.getByLabelText("No pattern for B"))
		expect(configs().pattern?.overrides).toEqual({ B: "none" })
		expect(q.queryByText("Ink color")).toBeNull()
		expect(q.queryByText("Scale")).toBeNull()
	})

	it("the category's reset clears everything picked for it, and nothing else", () => {
		const { container, configs } = mountPiece(
			withPattern(BARS, "group"),
			pattern({
				overrides: { A: 2, B: 4 },
				inkColors: { B: "#aa0000" },
				scales: { B: 2 },
				rotations: { B: 45 },
			}),
			(p) => <FillCategory p={p} v="B" i={1} />
		)
		fireEvent.click(within(container).getByLabelText("Reset pattern for B"))
		const saved = configs().pattern
		expect(saved?.overrides).toEqual({ A: 2 })
		expect(saved?.inkColors).toEqual({})
		expect(saved?.scales).toEqual({})
		expect(saved?.rotations).toEqual({})
	})

	it("shows the display name while keying picks on the stored value", () => {
		const { container, configs } = mountPiece(withPattern(BARS, "group"), {}, (p) => (
			<FillCategory p={p} v="A" i={0} display="Group A" />
		))
		expect(within(container).queryByText("Group A")).not.toBeNull()
		fireEvent.click(within(container).getByLabelText("Pattern option 5"))
		expect(configs().pattern?.overrides).toEqual({ A: 4 })
	})
})

describe("SegmentsRow — Dash or Fill on line segments", () => {
	it("is absent unless the marks are line segments", () => {
		const { container } = mountPiece(SCATTER, {}, (p) => <SegmentsRow p={p} />)
		expect(container.innerHTML).toBe("")
	})

	it("a pick is stored; reset strips the key so the choice is Auto again", () => {
		const { container, configs } = mountPiece(SEGMENTS, {}, (p) => <SegmentsRow p={p} />)
		const q = within(container)
		// Untouched: the Auto rule is explained, and there is nothing to reset.
		expect(q.queryByText(/^Auto: Fill once the segments/)).not.toBeNull()
		expect(container.querySelector('button[data-tip="reset-link"]')).toBeNull()
		const group = q.getByRole("radiogroup", { name: "Pattern on segments" })
		fireEvent.click(within(group).getByRole("radio", { name: "Dash" }))
		expect(configs().pattern?.segmentPattern).toBe("dash")
		expect(q.queryByText(/^Auto: Fill once the segments/)).toBeNull()
		fireEvent.click(container.querySelector('button[data-tip="reset-link"]') as HTMLElement)
		expect(configs().pattern).not.toHaveProperty("segmentPattern")
	})
})
