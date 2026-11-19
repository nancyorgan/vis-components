import { cleanup, fireEvent, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	type ChannelConfigs,
} from "../../../../lib/channelConfig"

import {
	FillSection,
	LineDashSection,
	PointOutlineSection,
	TargetFillSection,
} from "./sections"
import {
	AREA,
	LINE,
	RADAR,
	SCATTER,
	mountPiece,
	sectionTitles,
	withPattern,
} from "./testMount"

/** The Pattern options' section cards, each rendered on its own.
 *
 *  Every card writes ITS OWN fields: an area chart's Point fill never
 *  touches the body's default pattern, the Point outline dash is stored
 *  sparsely (solid = no key), and the fill card's Vary by is the Pattern
 *  shelf's variable. */

afterEach(cleanup)

const conn = (more: Record<string, unknown>): Partial<ChannelConfigs> =>
	({ connection: { ...DEFAULT_CONNECTION_CONFIG, ...more } }) as Partial<ChannelConfigs>
const BOX_ON_Y: ChannelConfigs["y"] = {
	...DEFAULT_AXIS_CONFIG,
	distributionOverlay: { ...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG, showBoxPlot: true },
}

describe("TargetFillSection — an area chart's Point fill", () => {
	it("a swatch writes the points' own default, not the body's", () => {
		const { container, configs } = mountPiece(AREA, conn({ fill: "area" }), (p) => (
			<TargetFillSection p={p} target="areaPoint" />
		))
		expect(sectionTitles(container)).toEqual(["Point fill"])
		fireEvent.click(within(container).getByLabelText("Point pattern option 2"))
		expect(configs().pattern?.defaultAreaPointPattern).toBe(1)
		expect(configs().defaultPattern ?? null).toBeNull()
		// A picked pattern brings its ink, scale and rotation rows.
		expect(within(container).queryByText("Ink color")).not.toBeNull()
		fireEvent.click(within(container).getByLabelText("Reset point pattern option"))
		expect(configs().pattern?.defaultAreaPointPattern ?? null).toBeNull()
	})

	it("lists one row per category once a Pattern variable is mapped", () => {
		const { container, configs } = mountPiece(
			withPattern(AREA, "series"),
			conn({ fill: "area" }),
			(p) => <TargetFillSection p={p} target="areaPoint" />
		)
		const q = within(container)
		expect(q.getByLabelText("No point pattern for s1")).not.toBeNull()
		expect(q.getByLabelText("No point pattern for s2")).not.toBeNull()
		const s2 = q.getByLabelText("No point pattern for s2").closest('[role="group"]') as HTMLElement
		fireEvent.click(within(s2).getByLabelText("Point pattern option 3"))
		expect(configs().pattern?.areaPointOverrides).toEqual({ s2: 2 })
		expect(configs().pattern?.overrides ?? {}).toEqual({})
	})

	it("stands down where the chart has no such part", () => {
		const { container } = mountPiece(SCATTER, {}, (p) => (
			<>
				<TargetFillSection p={p} target="areaPoint" />
				<TargetFillSection p={p} target="polygon" />
			</>
		))
		expect(container.innerHTML).toBe("")
	})
})

describe("PointOutlineSection — a radar's point ring", () => {
	it("stores a dash sparsely and strips it again on reset", () => {
		const { container, configs } = mountPiece(RADAR, conn({ fillPolygon: true }), (p) => (
			<PointOutlineSection p={p} />
		))
		expect(sectionTitles(container)).toEqual(["Point outline"])
		const q = within(container)
		fireEvent.click(q.getByLabelText("Point outline dash dashed"))
		expect(configs().pattern?.pointOutlineDash).toBe("dashed")
		fireEvent.click(q.getByLabelText("No dash for point outline"))
		expect(configs().pattern).not.toHaveProperty("pointOutlineDash")
	})
})

describe("FillSection — the marks' own fill", () => {
	it("beside a Violin / box fill it carries Vary by, bound to the Pattern shelf", () => {
		const { container, encodings } = mountPiece(SCATTER, { y: BOX_ON_Y }, (p) => (
			<FillSection p={p} />
		))
		expect(sectionTitles(container)).toEqual(["Point fill"])
		const select = within(container).getByLabelText("Vary by") as HTMLSelectElement
		fireEvent.change(select, { target: { value: "series" } })
		expect(encodings().pattern.field).toBe("series")
		// The card now lists the variable's levels.
		expect(within(container).getByLabelText("No pattern for s1")).not.toBeNull()
	})

	it("on a line chart it is the Point fill card, with no Vary by", () => {
		const { container, configs } = mountPiece(LINE, {}, (p) => <FillSection p={p} />)
		expect(sectionTitles(container)).toEqual(["Point fill"])
		expect(within(container).queryByLabelText("Vary by")).toBeNull()
		fireEvent.click(within(container).getByLabelText("Pattern option 4"))
		expect(configs().defaultPattern).toBe(3)
	})
})

describe("LineDashSection — the Line card", () => {
	it("per-category dashes write pattern.dashOverrides", () => {
		const { container, configs } = mountPiece(withPattern(LINE, "series"), {}, (p) => (
			<LineDashSection p={p} />
		))
		expect(sectionTitles(container)).toEqual(["Line"])
		fireEvent.click(within(container).getByLabelText("No dash for s1"))
		expect(configs().pattern?.dashOverrides).toEqual({ s1: "none" })
		// The connection's default dash is the no-variable form's field.
		expect(configs().connection?.defaultDashPattern ?? "solid").toBe("solid")
	})
})
