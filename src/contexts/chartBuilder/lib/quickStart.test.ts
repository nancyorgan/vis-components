import { describe, expect, it } from "vitest"

import type { ChannelConfigs } from "./channelConfig"
import type { GeoFieldDetection } from "./geo/detectGeoFields"
import { DEFAULT_MAP_CONFIG } from "./mapConfig"
import {
	applyVariation,
	assignFields,
	isVariationSatisfiable,
	mapConfigForVariation,
	nextVariationIndex,
	satisfiableVariationIndices,
} from "./quickStart"
import { QUICK_START_VARIATIONS } from "./quickStartVariations"
import type { Field, FieldType } from "./types"

const field = (name: string, inferredType: FieldType): Field => ({
	name,
	inferredType,
})

/** Deterministic stand-in for the `random` arg: returns the given values in
 * order, repeating the last once exhausted. Roll order in `assignFields`:
 * [hue cat-vs-quant], then per showcase-fill — [pattern], [shape?],
 * [colorMod include], [colorMod index]. A high value (≥ weight) excludes,
 * a low value (< weight) includes. */
const seq = (values: number[]) => {
	let i = 0
	return () => values[Math.min(i++, values.length - 1)] ?? 0
}
/** Force a categorical opportunistic hue (quant-hue roll fails). */
const CAT_HUE = () => 0.99

describe("QUICK_START_VARIATIONS", () => {
	it("never maps the legacy text channel — labels go through the Data Labels encodings", () => {
		for (const variations of Object.values(QUICK_START_VARIATIONS)) {
			for (const v of variations) {
				expect(v.channels, `variation "${v.name}"`).not.toHaveProperty("text")
			}
		}
	})
})

describe("assignFields", () => {
	it("returns an assignment when every required channel has at least one eligible field", () => {
		const variation = {
			name: "vbars",
			channels: {
				x: ["categorical"] as readonly FieldType[],
				length: ["quantitative"] as readonly FieldType[],
			},
		}
		const fields = [
			field("region", "categorical"),
			field("sales", "quantitative"),
		]
		const result = assignFields(variation, fields, {})
		expect(result).not.toBeNull()
		// region also gets reused for opportunistic hue (color is prioritized).
		expect(result!.map((a) => a.channel).sort()).toEqual([
			"hue",
			"length",
			"x",
		])
	})

	it("returns null when the dataset lacks a field of a required type", () => {
		const variation = {
			name: "vbars",
			channels: {
				x: ["categorical"] as readonly FieldType[],
				length: ["quantitative"] as readonly FieldType[],
			},
		}
		const fields = [field("a", "quantitative"), field("b", "quantitative")]
		expect(assignFields(variation, fields, {})).toBeNull()
	})

	it("prefers distinct fields when enough are available", () => {
		const variation = {
			name: "two-quants",
			channels: {
				x: ["quantitative"] as readonly FieldType[],
				y: ["quantitative"] as readonly FieldType[],
			},
		}
		const fields = [field("a", "quantitative"), field("b", "quantitative")]
		const result = assignFields(variation, fields, {})
		expect(result).not.toBeNull()
		const names = result!.map((a) => a.field.name)
		expect(new Set(names).size).toBe(2) // a and b, not repeated
	})

	it("reuses a field across channels when the dataset lacks distinct ones", () => {
		const variation = {
			name: "two-quants",
			channels: {
				x: ["quantitative"] as readonly FieldType[],
				y: ["quantitative"] as readonly FieldType[],
			},
		}
		// Only one quantitative field → both channels reuse it (a diagonal
		// scatter). Double-encoding is allowed, so this is satisfiable.
		const fields = [field("a", "quantitative"), field("b", "categorical")]
		const result = assignFields(variation, fields, {})
		expect(result).not.toBeNull()
		const assigned = new Map(result!.map((a) => [a.channel, a.field.name]))
		expect(assigned.get("x")).toBe("a")
		expect(assigned.get("y")).toBe("a")
	})

	it("sorts channels restrictive-first so a looser channel doesn't steal the only match a tighter one could have used", () => {
		// The tight channel (`hue`) accepts only categorical; the loose one
		// (`facet`) accepts both. With greedy insertion-order (loose first),
		// facet would take the categorical field and hue would fail.
		// Restrictive-first picks hue first (fewer allowed types), succeeding.
		const variation = {
			name: "pathological",
			channels: {
				facet: ["categorical", "ordinal"] as readonly FieldType[],
				hue: ["categorical"] as readonly FieldType[],
			},
		}
		const fields = [
			field("catOnly", "categorical"),
			field("ordOnly", "ordinal"),
		]
		const result = assignFields(variation, fields, {})
		expect(result).not.toBeNull()
		const assigned = new Map(result!.map((a) => [a.channel, a.field.name]))
		expect(assigned.get("hue")).toBe("catOnly")
		expect(assigned.get("facet")).toBe("ordOnly")
	})

	it("respects user field-type overrides via the overrides map", () => {
		// A field inferred as quantitative, but the user has overridden it to
		// categorical — the variation that needs a categorical x should
		// accept it.
		const variation = {
			name: "bars",
			channels: {
				x: ["categorical"] as readonly FieldType[],
				length: ["quantitative"] as readonly FieldType[],
			},
		}
		const fields = [
			field("zip", "quantitative"),
			field("sales", "quantitative"),
		]
		const overrides: Record<string, FieldType> = { zip: "categorical" }
		const result = assignFields(variation, fields, overrides)
		expect(result).not.toBeNull()
		const assigned = new Map(result!.map((a) => [a.channel, a.field.name]))
		expect(assigned.get("x")).toBe("zip")
		expect(assigned.get("length")).toBe("sales")
	})

	it("uses the custom pickIndex to produce deterministic non-zero picks", () => {
		const variation = {
			name: "pickTest",
			channels: { x: ["quantitative"] as readonly FieldType[] },
		}
		const fields = [
			field("a", "quantitative"),
			field("b", "quantitative"),
			field("c", "quantitative"),
		]
		// pickIndex always returns 2 → should get "c"
		const result = assignFields(variation, fields, {}, () => 2)
		expect(result?.[0]?.field.name).toBe("c")
	})

	it("clamps an out-of-range pickIndex to the last eligible field", () => {
		const variation = {
			name: "pickTest",
			channels: { x: ["quantitative"] as readonly FieldType[] },
		}
		const fields = [field("a", "quantitative"), field("b", "quantitative")]
		const result = assignFields(variation, fields, {}, () => 999)
		expect(result?.[0]?.field.name).toBe("b")
	})

	describe("opportunistic hue", () => {
		const variation = {
			name: "plain bars",
			channels: {
				x: ["categorical"] as readonly FieldType[],
				length: ["quantitative"] as readonly FieldType[],
			},
		}

		it("adds a categorical hue when the categorical-hue roll wins", () => {
			const fields = [
				field("region", "categorical"),
				field("sales", "quantitative"),
				field("segment", "categorical"),
			]
			const result = assignFields(variation, fields, {}, () => 0, undefined, CAT_HUE)
			expect(result).not.toBeNull()
			const hue = result!.find((a) => a.channel === "hue")
			// A spare categorical (segment) is preferred over reusing x's region.
			expect(hue?.field.inferredType).toBe("categorical")
			expect(hue?.field.name).toBe("segment")
		})

		it("maps hue to a QUANTITATIVE field when the quant-hue roll wins (gradient mode)", () => {
			const fields = [
				field("region", "categorical"),
				field("sales", "quantitative"),
				field("score", "quantitative"),
			]
			// random→0 makes the quant-hue roll win (0 < quantitativeHue). A
			// spare quantitative field (score; sales is taken by length) drives
			// a gradient hue instead of a palette.
			const result = assignFields(variation, fields, {}, () => 0, undefined, () => 0)
			const hue = result!.find((a) => a.channel === "hue")
			expect(hue?.field.inferredType).toBe("quantitative")
			expect(hue?.field.name).toBe("score")
		})

		it("reuses a categorical for hue when no spare is left (prioritizing color)", () => {
			const fields = [
				field("region", "categorical"),
				field("sales", "quantitative"),
			]
			// The only categorical (region) is consumed by x, but hue is
			// prioritized — it reuses region rather than leaving the chart
			// monochrome. (Force the categorical-hue roll so it doesn't land on
			// the quantitative field instead.)
			const result = assignFields(variation, fields, {}, () => 0, undefined, CAT_HUE)
			expect(result).not.toBeNull()
			const hue = result!.find((a) => a.channel === "hue")
			expect(hue?.field.name).toBe("region")
			const x = result!.find((a) => a.channel === "x")
			expect(x?.field.name).toBe("region")
		})

		it("does not add hue when variation already requires it", () => {
			const variationWithHue = {
				name: "stacked bars",
				channels: {
					x: ["categorical"] as readonly FieldType[],
					length: ["quantitative"] as readonly FieldType[],
					hue: ["categorical"] as readonly FieldType[],
				},
			}
			const fields = [
				field("region", "categorical"),
				field("sales", "quantitative"),
				field("segment", "categorical"),
				field("tier", "categorical"),
			]
			const result = assignFields(variationWithHue, fields, {})
			expect(result).not.toBeNull()
			// Hue is assigned exactly once (from the required channel, not again
			// opportunistically on top).
			const hueAssignments = result!.filter((a) => a.channel === "hue")
			expect(hueAssignments).toHaveLength(1)
		})

		it("skips opportunistic hue when the variation opts out via allowOpportunisticHue: false", () => {
			const pieVariation = {
				name: "pie",
				channels: {
					x: ["categorical"] as readonly FieldType[],
					angle: ["quantitative"] as readonly FieldType[],
				},
				allowOpportunisticHue: false,
			}
			const fields = [
				field("region", "categorical"),
				field("sales", "quantitative"),
				field("segment", "categorical"),
			]
			const result = assignFields(pieVariation, fields, {})
			expect(result).not.toBeNull()
			expect(result!.find((a) => a.channel === "hue")).toBeUndefined()
		})

		const pieVariation = {
			name: "Single pie",
			channels: { angle: ["quantitative"] as readonly FieldType[] },
			allowOpportunisticHue: false,
		}
		const pieFields = [
			field("region", "categorical"),
			field("sales", "quantitative"),
		]

		it("showcase fill (random→0) adds pattern + exactly ONE color-mod channel, no shape/area on a pie", () => {
			// random()=0 → every roll passes: pattern in; color-mod picks index 0
			// (brightness). Only ONE of brightness/saturation/opacity is ever
			// chosen, and a pie has no point marks so no shape/area.
			const result = assignFields(pieVariation, pieFields, {}, () => 0, "pie", () => 0)
			expect(result).not.toBeNull()
			const channels = new Set<string>(result!.map((a) => a.channel))
			expect(channels.has("pattern")).toBe(true)
			const colorMods = ["brightness", "saturation", "opacity"].filter((c) =>
				channels.has(c)
			)
			expect(colorMods).toHaveLength(1)
			expect(channels.has("shape")).toBe(false)
			expect(channels.has("area")).toBe(false)
		})

		it("showcase fill (random→0.99) adds no optional aesthetics", () => {
			// Every roll fails → just the required angle (no pattern, no color-mod).
			const result = assignFields(
				pieVariation,
				pieFields,
				{},
				() => 0,
				"pie",
				() => 0.99
			)
			expect(result!.map((a) => a.channel)).toEqual(["angle"])
		})

		it("showcase fill points pattern at the hue field so its ink pairs with the palette", () => {
			// A bar variation gets hue=region opportunistically; the fill then
			// reuses region for pattern (pattern === hue → colored inks).
			const bar = {
				name: "bars",
				channels: {
					x: ["categorical"] as readonly FieldType[],
					length: ["quantitative"] as readonly FieldType[],
				},
			}
			// Rolls: [hue→categorical (0.99)], [pattern→include (0)], [colorMod
			// include (0)], [colorMod index (0)]. Categorical hue lets pattern
			// reuse the hue field.
			const result = assignFields(
				bar,
				pieFields,
				{},
				() => 0,
				"bar",
				seq([0.99, 0, 0, 0])
			)
			const assigned = new Map(result!.map((a) => [a.channel, a.field.name]))
			expect(assigned.get("pattern")).toBe(assigned.get("hue"))
			expect(assigned.get("pattern")).toBe("region")
		})

		it("does not fill aesthetic channels without a chartType (satisfiability path)", () => {
			const result = assignFields(pieVariation, pieFields, {})
			expect(result!.map((a) => a.channel)).toEqual(["angle"])
		})

		it("maps hue to the category axis for a distribution-overlay variation", () => {
			// Vertical violin: overlay on y → x is the category axis, so hue
			// follows x even though opportunistic hue is disabled.
			const violin = {
				name: "violin",
				channels: {
					x: ["categorical"] as readonly FieldType[],
					y: ["quantitative"] as readonly FieldType[],
				},
				distributionOverlay: { axis: "y" as const, mode: "violin" as const },
				allowOpportunisticHue: false,
			}
			const fields = [
				field("region", "categorical"),
				field("sales", "quantitative"),
			]
			const result = assignFields(violin, fields, {})
			expect(result).not.toBeNull()
			const assigned = new Map(result!.map((a) => [a.channel, a.field.name]))
			expect(assigned.get("hue")).toBe("region")
			expect(assigned.get("x")).toBe("region")
			expect(result!.filter((a) => a.channel === "hue")).toHaveLength(1)
		})
	})
})

describe("isVariationSatisfiable", () => {
	it("mirrors assignFields for reachable cases", () => {
		const variation = QUICK_START_VARIATIONS.bar[0]!
		const fields = [field("r", "categorical"), field("s", "quantitative")]
		expect(isVariationSatisfiable(variation, fields, {})).toBe(true)
	})

	it("returns false when the table of variations can't be built", () => {
		const variation = QUICK_START_VARIATIONS.bar[0]!
		expect(isVariationSatisfiable(variation, [], {})).toBe(false)
	})
})

describe("satisfiableVariationIndices", () => {
	it("returns every variation index when the dataset is rich enough", () => {
		// Every scatter variation should be reachable with 4 quantitative fields
		// + 1 categorical. The variations in order are: scatter, bubble, shape
		// scatter, multi-encoded scatter, vector field.
		const fields = [
			field("x1", "quantitative"),
			field("x2", "quantitative"),
			field("x3", "quantitative"),
			field("x4", "quantitative"),
			field("cat1", "categorical"),
		]
		const indices = satisfiableVariationIndices("scatter", fields, {})
		expect(indices).toEqual([0, 1, 2, 3, 4])
	})

	it("returns empty when no variation can be built", () => {
		// Bar needs categorical x/y. Dataset is all quantitative.
		const fields = [field("a", "quantitative"), field("b", "quantitative")]
		expect(satisfiableVariationIndices("bar", fields, {})).toEqual([])
	})

	it("treats variations needing extra fields as reachable via reuse", () => {
		// Only one categorical, but double-encoding is allowed: grouped (1),
		// patterned stacked (2), and horizontal stacked (4) reuse the single
		// categorical for hue / pattern, so every bar variation is reachable.
		const fields = [field("cat", "categorical"), field("sales", "quantitative")]
		const indices = satisfiableVariationIndices("bar", fields, {})
		expect(indices).toEqual([0, 1, 2, 3, 4])
	})
})

describe("nextVariationIndex", () => {
	it("returns null when no variations are satisfiable", () => {
		expect(nextVariationIndex(0, [])).toBeNull()
		expect(nextVariationIndex(5, [])).toBeNull()
	})

	it("advances through the satisfiable list in order", () => {
		const indices = [0, 2, 3]
		expect(nextVariationIndex(0, indices)).toBe(0)
		expect(nextVariationIndex(1, indices)).toBe(2)
		expect(nextVariationIndex(2, indices)).toBe(3)
	})

	it("wraps around past the end of the satisfiable list", () => {
		const indices = [0, 2, 3]
		expect(nextVariationIndex(3, indices)).toBe(0)
		expect(nextVariationIndex(4, indices)).toBe(2)
		expect(nextVariationIndex(5, indices)).toBe(3)
		expect(nextVariationIndex(6, indices)).toBe(0)
	})

	it("normalizes negative cycle positions (e.g. from integer underflow)", () => {
		const indices = [0, 2, 3]
		expect(nextVariationIndex(-1, indices)).toBe(3)
		expect(nextVariationIndex(-4, indices)).toBe(3)
	})
})

describe("applyVariation", () => {
	const variation = {
		name: "stacked bars",
		channels: {
			x: ["categorical"] as readonly FieldType[],
			length: ["quantitative"] as readonly FieldType[],
			hue: ["categorical"] as readonly FieldType[],
		},
		stackMode: "group" as const,
	}
	const assignments = [
		{ channel: "x" as const, field: field("region", "categorical") },
		{ channel: "length" as const, field: field("sales", "quantitative") },
		{ channel: "hue" as const, field: field("segment", "categorical") },
	]

	it("writes exactly the variation's channels into an otherwise-empty encoding", () => {
		const { encodings } = applyVariation(variation, assignments, {})
		expect(encodings.x.field).toBe("region")
		expect(encodings.length.field).toBe("sales")
		expect(encodings.hue.field).toBe("segment")
		// All other channels stay null.
		expect(encodings.y.field).toBeNull()
		expect(encodings.angle.field).toBeNull()
		expect(encodings.area.field).toBeNull()
		expect(encodings.connection.field).toBeNull()
	})

	it("returns empty data-labels encodings when the variation doesn't opt in", () => {
		const { dataLabels } = applyVariation(variation, assignments, {})
		expect(dataLabels.value.field).toBeNull()
		expect(dataLabels.x.field).toBeNull()
		expect(dataLabels.hue.field).toBeNull()
	})

	it("maps dataLabels.value from the named channel's assigned field", () => {
		const tileVariation = {
			name: "tile with labels",
			channels: {
				x: ["categorical"] as readonly FieldType[],
				y: ["categorical"] as readonly FieldType[],
				hue: ["quantitative"] as readonly FieldType[],
			},
			dataLabelsValueFrom: "hue" as const,
		}
		const tileAssignments = [
			{ channel: "x" as const, field: field("animal", "categorical") },
			{ channel: "y" as const, field: field("activity", "categorical") },
			{ channel: "hue" as const, field: field("score", "quantitative") },
		]
		const { encodings, dataLabels } = applyVariation(
			tileVariation,
			tileAssignments,
			{}
		)
		expect(dataLabels.value.field).toBe("score")
		// The legacy `text` encoding channel must stay unmapped — scaffolds
		// drive labels exclusively through the Data Labels encodings.
		expect(encodings.text.field).toBeNull()
	})

	it("applies the variation's stackMode to hue config when hue is in the variation", () => {
		const { configs } = applyVariation(variation, assignments, {})
		expect(configs.hue?.stackMode).toBe("group")
		expect(configs.hue?.kind).toBe("categorical")
	})

	it("preserves unrelated channel configs (axis formats, labels, etc.)", () => {
		const currentConfigs: ChannelConfigs = {
			x: {
				tickCount: 5,
				customFormat: "$,.2f",
				gridlines: { enabled: true, color: "#000", thickness: 1, count: null },
				tickmarks: { color: "#000", thickness: 1, length: 4 },
				spine: { color: "#000", thickness: 1 },
				tickLabelAngle: 0,
				jitterAmount: 0,
				distributionOverlay: {
					showDensityViolin: false,
					showBoxPlot: false,
					showPoints: true,
					color: "#475569",
					fillColor: "#cbd5e1",
					colorOverrides: {},
					fillColorOverrides: {},
				},
			},
		}
		const { configs } = applyVariation(variation, assignments, currentConfigs)
		expect(configs.x?.customFormat).toBe("$,.2f")
	})

	it("applies connectionFill to connection config when connection is in the variation", () => {
		const lineVariation = {
			name: "single line",
			channels: {
				x: ["quantitative"] as readonly FieldType[],
				y: ["quantitative"] as readonly FieldType[],
				connection: ["categorical"] as readonly FieldType[],
			},
			connectionFill: "line" as const,
		}
		const lineAssignments = [
			{ channel: "x" as const, field: field("t", "quantitative") },
			{ channel: "y" as const, field: field("v", "quantitative") },
			{ channel: "connection" as const, field: field("series", "categorical") },
		]
		const { configs } = applyVariation(lineVariation, lineAssignments, {})
		expect(configs.connection?.fill).toBe("line")
	})

	it("applies hue config even when hue was added opportunistically (not in variation.channels)", () => {
		// Mimic what assignFields would produce for a "Vertical bars" variation
		// on a dataset with a spare categorical: hue is in the assignments
		// even though the variation declares only x + length.
		const plainBarsVariation = {
			name: "Vertical bars",
			channels: {
				x: ["categorical"] as readonly FieldType[],
				length: ["quantitative"] as readonly FieldType[],
			},
			// allowOpportunisticHue defaults to true — not needed explicitly.
		}
		const assignmentsWithOpportunisticHue = [
			{ channel: "x" as const, field: field("region", "categorical") },
			{ channel: "length" as const, field: field("sales", "quantitative") },
			{ channel: "hue" as const, field: field("segment", "categorical") },
		]
		const { configs } = applyVariation(
			plainBarsVariation,
			assignmentsWithOpportunisticHue,
			{}
		)
		expect(configs.hue?.kind).toBe("categorical")
		// Default stackMode is "stack" — the variation didn't override it,
		// so we expect the global default. Variations that need a different
		// mode (grouped bars, overlay) declare it explicitly via
		// `variation.stackMode`.
		expect(configs.hue?.stackMode).toBe("stack")
	})

	it("does not touch hue/connection configs when the variation doesn't involve those channels", () => {
		const plainVariation = {
			name: "basic scatter",
			channels: {
				x: ["quantitative"] as readonly FieldType[],
				y: ["quantitative"] as readonly FieldType[],
			},
		}
		const plainAssignments = [
			{ channel: "x" as const, field: field("a", "quantitative") },
			{ channel: "y" as const, field: field("b", "quantitative") },
		]
		const currentConfigs: ChannelConfigs = {
			hue: {
				kind: "quantitative",
				palette: "viridis",
				lowColor: "#0d0887",
				lowValue: null,
				midColor: null,
				midValue: null,
				highColor: "#f0f921",
				highValue: null,
				stackMode: "stack",
			},
		}
		const { configs } = applyVariation(
			plainVariation,
			plainAssignments,
			currentConfigs
		)
		// Quantitative hue config is preserved — scatter variation didn't ask
		// for hue, so we don't steamroll it.
		expect(configs.hue?.kind).toBe("quantitative")
	})

	it("turns on connection.fillPolygon when a radar variation requests it", () => {
		const filledRadar = {
			name: "Filled radar",
			channels: {
				angle: ["categorical", "ordinal"] as readonly FieldType[],
				r: ["quantitative", "ordinal"] as readonly FieldType[],
				connection: ["categorical", "ordinal"] as readonly FieldType[],
			},
			polygonFill: true,
		}
		const radarAssignments = [
			{ channel: "angle" as const, field: field("metric", "categorical") },
			{ channel: "r" as const, field: field("score", "quantitative") },
			{ channel: "connection" as const, field: field("team", "categorical") },
		]
		const { configs } = applyVariation(filledRadar, radarAssignments, {})
		expect(configs.connection?.fillPolygon).toBe(true)
	})

	it("leaves fillPolygon off (default false) for non-radar (or unflagged radar) variations", () => {
		const plainRadar = {
			name: "Radar polygon",
			channels: {
				angle: ["categorical", "ordinal"] as readonly FieldType[],
				r: ["quantitative", "ordinal"] as readonly FieldType[],
				connection: ["categorical", "ordinal"] as readonly FieldType[],
			},
		}
		const a = [
			{ channel: "angle" as const, field: field("metric", "categorical") },
			{ channel: "r" as const, field: field("score", "quantitative") },
			{ channel: "connection" as const, field: field("team", "categorical") },
		]
		const { configs } = applyVariation(plainRadar, a, {})
		expect(configs.connection?.fillPolygon).toBe(false)
	})
})

describe("radar variations (QUICK_START_VARIATIONS.radar)", () => {
	it("scaffolds a connected radar polygon from a metric + score + team dataset", () => {
		const fields = [
			field("metric", "categorical"),
			field("score", "quantitative"),
			field("team", "categorical"),
		]
		const radarVariation = QUICK_START_VARIATIONS.radar[0]!
		const assignments = assignFields(radarVariation, fields, {})
		expect(assignments).not.toBeNull()
		const { encodings } = applyVariation(radarVariation, assignments!, {})
		expect(encodings.angle.field).toBe("metric")
		expect(encodings.r.field).toBe("score")
		expect(encodings.connection.field).toBe("team")
	})

	it("falls back to the dots-only radar when no series field is available", () => {
		const fields = [
			field("metric", "categorical"),
			field("score", "quantitative"),
		]
		const indices = satisfiableVariationIndices("radar", fields, {})
		// The connection-requiring variations need a second categorical
		// (used for connection AND opportunistic hue), but with only one
		// categorical field they're unsatisfiable. The dots variation
		// stays available.
		expect(indices.length).toBeGreaterThan(0)
		const dotsVariation =
			QUICK_START_VARIATIONS.radar[QUICK_START_VARIATIONS.radar.length - 1]!
		const assignments = assignFields(dotsVariation, fields, {})
		expect(assignments).not.toBeNull()
		const { encodings } = applyVariation(dotsVariation, assignments!, {})
		expect(encodings.angle.field).toBe("metric")
		expect(encodings.r.field).toBe("score")
		expect(encodings.connection.field).toBeNull()
	})
})

describe("map variations (QUICK_START_VARIATIONS.map)", () => {
	const stateField = field("state", "categorical")
	const salesField = field("sales", "quantitative")
	const latField = field("latitude", "quantitative")
	const lonField = field("longitude", "quantitative")

	const regionDetection: GeoFieldDetection = {
		regionFields: [
			{ field: stateField, level: "states", keyType: "name", matchRate: 1 },
		],
		latField: null,
		lonField: null,
		pointsLevel: "states",
	}
	const pointsDetection: GeoFieldDetection = {
		regionFields: [],
		latField,
		lonField,
		pointsLevel: "countries",
	}

	const choropleth = QUICK_START_VARIATIONS.map[0]!
	const bubbleMap = QUICK_START_VARIATIONS.map[1]!
	const dotMap = QUICK_START_VARIATIONS.map[2]!

	it("is entirely unsatisfiable without geo detection results", () => {
		const fields = [stateField, salesField, latField, lonField]
		expect(satisfiableVariationIndices("map", fields, {})).toEqual([])
		expect(isVariationSatisfiable(choropleth, fields, {}, null)).toBe(false)
	})

	it("region detection satisfies choropleth + bubble map but not the dot map", () => {
		const fields = [stateField, salesField]
		expect(
			satisfiableVariationIndices("map", fields, {}, regionDetection)
		).toEqual([0, 1])
	})

	it("a lat/long pair satisfies only the dot map", () => {
		const fields = [latField, lonField, salesField]
		expect(
			satisfiableVariationIndices("map", fields, {}, pointsDetection)
		).toEqual([2])
	})

	it("choropleth assigns the detected region field to connection and a measure to hue", () => {
		const fields = [stateField, salesField]
		const assignments = assignFields(
			choropleth,
			fields,
			{},
			undefined,
			undefined,
			undefined,
			regionDetection
		)
		expect(assignments).not.toBeNull()
		const { encodings } = applyVariation(choropleth, assignments!, {})
		expect(encodings.connection.field).toBe("state")
		expect(encodings.hue.field).toBe("sales")
		// geoChoropleth mode requires x/y/area unmapped.
		expect(encodings.x.field).toBeNull()
		expect(encodings.y.field).toBeNull()
		expect(encodings.area.field).toBeNull()
	})

	it("bubble map assigns region → connection and a measure → area", () => {
		const fields = [stateField, salesField]
		const assignments = assignFields(
			bubbleMap,
			fields,
			{},
			undefined,
			undefined,
			undefined,
			regionDetection
		)
		const { encodings } = applyVariation(bubbleMap, assignments!, {})
		expect(encodings.connection.field).toBe("state")
		expect(encodings.area.field).toBe("sales")
	})

	it("dot map assigns longitude → x and latitude → y", () => {
		const fields = [latField, lonField, salesField]
		const assignments = assignFields(
			dotMap,
			fields,
			{},
			undefined,
			undefined,
			undefined,
			pointsDetection
		)
		const { encodings } = applyVariation(dotMap, assignments!, {})
		expect(encodings.x.field).toBe("longitude")
		expect(encodings.y.field).toBe("latitude")
		expect(encodings.connection.field).toBeNull()
	})

	it("map showcase fill adds pattern only — no positional/size/color-mod channels", () => {
		const fields = [stateField, salesField, field("segment", "categorical")]
		// chartType "map" + random→0 fires every available fill roll. Only
		// pattern is in the map plan (an `area` fill would flip a choropleth
		// into a symbol map; geo fills don't apply color modulation).
		const assignments = assignFields(
			choropleth,
			fields,
			{},
			() => 0,
			"map",
			() => 0,
			regionDetection
		)
		const channels = assignments!.map((a) => a.channel).sort()
		expect(channels).toEqual(["connection", "hue", "pattern"])
		// The spare categorical (segment) drives the pattern — not the region
		// field, which is already on connection.
		const pattern = assignments!.find((a) => a.channel === "pattern")
		expect(pattern?.field.name).toBe("segment")
	})
})

describe("mapConfigForVariation", () => {
	const choropleth = QUICK_START_VARIATIONS.map[0]!
	const dotMap = QUICK_START_VARIATIONS.map[2]!
	const barVariation = QUICK_START_VARIATIONS.bar[0]!

	const stateField = field("state", "categorical")
	const regionDetection: GeoFieldDetection = {
		regionFields: [
			{ field: stateField, level: "states", keyType: "name", matchRate: 1 },
		],
		latField: null,
		lonField: null,
		pointsLevel: "states",
	}

	it("switches to geographic at the assigned region field's level", () => {
		const next = mapConfigForVariation(
			choropleth,
			[{ channel: "connection", field: stateField }],
			regionDetection,
			DEFAULT_MAP_CONFIG
		)
		expect(next.coordSystem).toBe("geographic")
		expect(next.geographyLevel).toBe("states")
	})

	it("uses the detection's pointsLevel for the dot map", () => {
		const detection: GeoFieldDetection = {
			regionFields: [],
			latField: field("lat", "quantitative"),
			lonField: field("lon", "quantitative"),
			pointsLevel: "countries",
		}
		const next = mapConfigForVariation(dotMap, [], detection, DEFAULT_MAP_CONFIG)
		expect(next.coordSystem).toBe("geographic")
		expect(next.geographyLevel).toBe("countries")
	})

	it("turns a leftover geographic coord system OFF for non-map scaffolds", () => {
		const current = {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic" as const,
			showBasemap: false,
		}
		const next = mapConfigForVariation(barVariation, [], null, current)
		expect(next.coordSystem).toBe("noMap")
		// Other map settings survive so switching back is cheap.
		expect(next.showBasemap).toBe(false)
	})

	it("leaves a non-geographic config untouched for non-map scaffolds", () => {
		const next = mapConfigForVariation(barVariation, [], null, DEFAULT_MAP_CONFIG)
		expect(next).toBe(DEFAULT_MAP_CONFIG)
	})
})

describe("hierarchy / flow variations (circles / treemap / sunburst / sankey)", () => {
	const group = field("group", "categorical")
	const target = field("target", "categorical")
	const value = field("value", "quantitative")

	it("tree scaffolds set the layout, map area + connection, and seed hue with the rootGroup derived source", () => {
		for (const [type, layout] of [
			["circles", "pack"],
			["treemap", "treemap"],
			["sunburst", "sunburst"],
		] as const) {
			const variation = QUICK_START_VARIATIONS[type][0]!
			const assignments = assignFields(variation, [group, value], {})
			expect(assignments, type).not.toBeNull()
			const { encodings, configs } = applyVariation(variation, assignments!, {})
			expect(encodings.area.field).toBe("value")
			expect(encodings.connection.field).toBe("group")
			expect(encodings.hue.field).toBeNull()
			expect(encodings.hue.measureSource).toBe("rootGroup")
			expect(configs.connection?.hierarchyLayout).toBe(layout)
		}
	})

	it("tree scaffolds are satisfiable with one categorical + one quantitative", () => {
		expect(satisfiableVariationIndices("circles", [group, value], {})).toEqual([
			0,
		])
	})

	it("sankey requires a SECOND categorical for the auto-detected flow target", () => {
		expect(satisfiableVariationIndices("sankey", [group, value], {})).toEqual(
			[]
		)
		expect(
			satisfiableVariationIndices("sankey", [group, target, value], {})
		).toEqual([0])
	})

	it("sankey points hue at the source (connection) column and selects the sankey layout", () => {
		const variation = QUICK_START_VARIATIONS.sankey[0]!
		const assignments = assignFields(variation, [group, target, value], {})
		expect(assignments).not.toBeNull()
		const { encodings, configs } = applyVariation(variation, assignments!, {})
		expect(encodings.area.field).toBe("value")
		expect(encodings.connection.field).toBe(encodings.hue.field)
		expect(configs.connection?.hierarchyLayout).toBe("sankey")
	})

	it("field-type overrides count toward the sankey second-categorical check", () => {
		const numericTarget = field("code", "quantitative")
		expect(
			satisfiableVariationIndices("sankey", [group, numericTarget, value], {})
		).toEqual([])
		expect(
			satisfiableVariationIndices("sankey", [group, numericTarget, value], {
				code: "categorical",
			})
		).toEqual([0])
	})
})
