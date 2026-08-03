import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	type AxisConfig,
	type ChannelConfigs,
} from "./channelConfig"
import type { GeoFieldDetection } from "./geo/detectGeoFields"
import { DEFAULT_MAP_CONFIG, type MapConfig } from "./mapConfig"
import type {
	QuickStartChartType,
	QuickStartVariation,
} from "./quickStartVariations"
import { QUICK_START_VARIATIONS } from "./quickStartVariations"
import type {
	DataLabelsEncodings,
	EncodingChannel,
	Encodings,
	Field,
	FieldType,
} from "./types"
import { emptyDataLabelsEncodings, emptyEncodings } from "./types"

/** A successful field assignment for one channel. */
export type ChannelAssignment = {
	channel: EncodingChannel
	field: Field
}

/** Field types acceptable for an opportunistic hue assignment. Defined at
 * module scope (rather than per-call) so the Set stays constant across
 * repeated assignments. */
const CATEGORICAL_FILL_TYPES: readonly FieldType[] = ["categorical", "ordinal"]
const QUANTITATIVE_FILL_TYPES: readonly FieldType[] = [
	"quantitative",
	"ordinal",
]
/** Types that drive a CONTINUOUS (gradient) hue. Kept distinct from
 * `QUANTITATIVE_FILL_TYPES` (which includes ordinal) so an opportunistic
 * quantitative hue lands on a true gradient field, not an ordinal one that
 * reads better as a categorical palette. */
const CONTINUOUS_HUE_TYPES: readonly FieldType[] = ["quantitative", "temporal"]

/** Probability levers for the showcase fill — the single place to tune how
 * often the auto-gen reaches for each optional aesthetic. `0` = never, `1` =
 * always. `pattern` / `shape` are rolled independently; `colorModulation` is
 * the chance of including exactly ONE of brightness/saturation/opacity (none
 * otherwise). Hue is always prioritized and `area` is always added on point
 * charts, so neither has a lever here. */
export const AUTOGEN_FILL_WEIGHTS = {
	pattern: 0.45,
	shape: 0.4,
	colorModulation: 0.55,
	/** Chance that an opportunistic hue maps a QUANTITATIVE (gradient) field
	 * instead of a categorical (palette) one — so the autogen alternates
	 * between the two color modes. Falls back to whichever type the dataset
	 * actually has. */
	quantitativeHue: 0.4,
}

/** Per-family plan for the showcase fill (see `assignFields`). Channels are
 * NEVER required — the fill skips any with no eligible field and reuses
 * fields freely, so it never affects satisfiability.
 *   - `alwaysQuant`: filled every time (point size on point charts).
 *   - `decorativeCat`: categorical glyph channels, each rolled by its weight.
 *   - `colorModQuant`: brightness/saturation/opacity — at most one is chosen.
 * Tile omits opacity/shape/area (glyph channels flip it to scatter); the
 * non-point families (bar/area/pie/radar) omit shape/area (no point marks). */
const AESTHETIC_FILL: Record<
	QuickStartChartType,
	{
		alwaysQuant: readonly EncodingChannel[]
		decorativeCat: readonly EncodingChannel[]
		colorModQuant: readonly EncodingChannel[]
	}
> = {
	bar: {
		alwaysQuant: [],
		decorativeCat: ["pattern"],
		colorModQuant: ["brightness", "saturation", "opacity"],
	},
	scatter: {
		alwaysQuant: ["area"],
		decorativeCat: ["pattern", "shape"],
		colorModQuant: ["brightness", "saturation", "opacity"],
	},
	line: {
		alwaysQuant: ["area"],
		decorativeCat: ["pattern", "shape"],
		colorModQuant: ["brightness", "saturation", "opacity"],
	},
	area: {
		alwaysQuant: [],
		decorativeCat: ["pattern"],
		colorModQuant: ["brightness", "saturation", "opacity"],
	},
	pie: {
		alwaysQuant: [],
		decorativeCat: ["pattern"],
		colorModQuant: ["brightness", "saturation", "opacity"],
	},
	radar: {
		alwaysQuant: [],
		decorativeCat: ["pattern"],
		colorModQuant: ["brightness", "saturation", "opacity"],
	},
	violin: {
		alwaysQuant: ["area"],
		decorativeCat: ["pattern", "shape"],
		colorModQuant: ["brightness", "saturation", "opacity"],
	},
	tile: {
		alwaysQuant: [],
		decorativeCat: ["pattern"],
		colorModQuant: ["brightness", "saturation"],
	},
	// Maps: pattern is the one showcase channel the geo renderers draw
	// (patterned region fills / dots / bubbles). Positional + size channels
	// stay out — the geo chart modes detect off which channels are mapped (an
	// `area` fill would flip a choropleth into a symbol map) — and the geo
	// fill resolvers don't apply color modulation.
	map: {
		alwaysQuant: [],
		decorativeCat: ["pattern"],
		colorModQuant: [],
	},
	// Hierarchy trees + flows: hue is seeded by the variation itself
	// (`hueMeasureSource` / `hueFrom`), the size channel IS the required
	// `area`, and a random extra categorical on pattern/shape wouldn't land
	// on anything these renderers draw — keep the showcase fill empty.
	circles: { alwaysQuant: [], decorativeCat: [], colorModQuant: [] },
	treemap: { alwaysQuant: [], decorativeCat: [], colorModQuant: [] },
	sunburst: { alwaysQuant: [], decorativeCat: [], colorModQuant: [] },
	sankey: { alwaysQuant: [], decorativeCat: [], colorModQuant: [] },
}

/** Resolve a field's effective type (user override if set, else the inferred
 * type). Extracted to keep the quick-start helpers free of the `effectiveType`
 * import, which requires a `Dataset` object — we operate on just the field
 * list. */
const effectiveTypeOf = (
	field: Field,
	overrides: Record<string, FieldType>
): FieldType => overrides[field.name] ?? field.inferredType

/** Return the variation's (channel, allowedTypes) entries ordered from most
 * restrictive (fewest allowed types) to least. Ordering the greedy match by
 * restrictiveness sidesteps the pathological case where a looser channel grabs
 * the only field a tighter channel could have accepted. */
const restrictiveFirst = (
	variation: QuickStartVariation
): Array<[EncodingChannel, readonly FieldType[]]> => {
	const entries = Object.entries(variation.channels) as Array<
		[EncodingChannel, readonly FieldType[] | undefined]
	>
	return entries
		.filter((e): e is [EncodingChannel, readonly FieldType[]] => !!e[1])
		.sort((a, b) => a[1].length - b[1].length)
}

/** Try to assign one field per required channel. Returns null if no valid
 * assignment exists (the variation is unsatisfiable against this dataset).
 *
 * When the variation permits it (`allowOpportunisticHue`, default `true`),
 * a spare categorical field is also assigned to `hue` after the required
 * channels are filled. The opportunistic step is silent — if no suitable
 * categorical remains the scaffold just omits hue rather than failing.
 *
 * `pickIndex(eligible, channel)` chooses one field from the eligible list for
 * a given channel. Defaulting to `0` (first eligible) gives deterministic
 * satisfiability checks; passing a randomized picker gives the scaffold a
 * fresh assignment on each click. */
export const assignFields = (
	variation: QuickStartVariation,
	fields: readonly Field[],
	overrides: Record<string, FieldType>,
	pickIndex: (
		eligible: readonly Field[],
		channel: EncodingChannel
	) => number = () => 0,
	/** When provided, after the required + hue channels are filled, every
	 * remaining aesthetic channel for this chart family (see `AESTHETIC_FILL`)
	 * is filled opportunistically so the auto-gen visual exercises as many
	 * encodings as possible. Omit it (as `isVariationSatisfiable` does) to get
	 * the bare required-channel assignment — the fill never changes whether a
	 * variation is satisfiable. */
	chartType?: QuickStartChartType,
	/** 0..1 source for the showcase fill's probability rolls (which optional
	 * aesthetics to include). Defaults to `Math.random`; tests pass a fixed
	 * value to force inclusion (`() => 0`) or exclusion (`() => 0.99`). */
	random: () => number = Math.random,
	/** Geographic field detection for the dataset (see `detectGeoFields`).
	 * Required by map variations (`variation.geo`), which assign their geo
	 * channels from detected fields rather than by field type — without it (or
	 * without the needed detected fields) a map variation is unsatisfiable. */
	geo?: GeoFieldDetection | null
): ChannelAssignment[] | null => {
	const used = new Set<string>()
	const assignments: ChannelAssignment[] = []

	// Map variations: the geo channels come from VALUE-based detection, not the
	// type-based loop below. Assigned first so the measure channels prefer other
	// fields over reusing the geographic ones.
	if (variation.geo) {
		if (variation.geo === "points") {
			const lat = geo?.latField
			const lon = geo?.lonField
			if (!lat || !lon) return null
			// geoPoints mode convention: x carries longitude, y latitude.
			used.add(lon.name)
			used.add(lat.name)
			assignments.push({ channel: "x", field: lon })
			assignments.push({ channel: "y", field: lat })
		} else {
			const pool = (geo?.regionFields ?? []).map((r) => r.field)
			if (pool.length === 0) return null
			const idx = pickIndex(pool, "connection")
			const picked = pool[Math.max(0, Math.min(idx, pool.length - 1))]
			if (!picked) return null
			// Region maps join the region-key field via `connection` (the same
			// channel the manual maps flow uses).
			used.add(picked.name)
			assignments.push({ channel: "connection", field: picked })
		}
	}

	for (const [channel, allowed] of restrictiveFirst(variation)) {
		const typeEligible = fields.filter((f) =>
			allowed.includes(effectiveTypeOf(f, overrides))
		)
		// A channel is only unsatisfiable when NO field has the right type.
		// Reusing a field across channels is fine — a single quantitative
		// column can legitimately drive x, y AND area (a diagonal bubble
		// chart), so we don't fail just because every type-eligible field is
		// already mapped elsewhere.
		if (typeEligible.length === 0) return null
		// Prefer a not-yet-used field so field-rich datasets spread across
		// distinct columns; fall back to the full type-eligible pool (allowing
		// repeats) when the dataset doesn't have enough of the required type.
		const fresh = typeEligible.filter((f) => !used.has(f.name))
		const pool = fresh.length > 0 ? fresh : typeEligible
		const idx = pickIndex(pool, channel)
		const clamped = Math.max(0, Math.min(idx, pool.length - 1))
		const picked = pool[clamped]
		if (!picked) return null
		used.add(picked.name)
		assignments.push({ channel, field: picked })
	}

	// Flow variations lean on the auto-detected flow TARGET column, and
	// `resolveFlowTargetField` never picks the source column itself — so a
	// dataset must keep a spare categorical after the source + value picks or
	// the flow graph has no target and renders nothing. (The runtime detector
	// can also match a non-categorical overlap column, so this check is
	// slightly conservative — a satisfiable-but-disabled edge case, never a
	// blank chart.)
	if (variation.requiresFlowTarget) {
		const sourceName = assignments.find((a) => a.channel === "connection")
			?.field.name
		const valueName = assignments.find((a) => a.channel === "area")?.field.name
		const hasTarget = fields.some(
			(f) =>
				f.name !== sourceName &&
				f.name !== valueName &&
				CATEGORICAL_FILL_TYPES.includes(effectiveTypeOf(f, overrides))
		)
		if (!hasTarget) return null
	}

	// Distribution overlays (violin / box) color each shape by its category,
	// so hue follows the category axis — the axis OPPOSITE the overlay (a
	// vertical violin overlays the y/value axis, so x is the category). This
	// is why these variations disable opportunistic hue: picking a *different*
	// field would fight the per-category coloring. Map it explicitly so the
	// autogen actually introduces color instead of rendering monochrome.
	if (variation.distributionOverlay && variation.channels.hue === undefined) {
		const categoryAxis =
			variation.distributionOverlay.axis === "y" ? "x" : "y"
		const catAssign = assignments.find((a) => a.channel === categoryAxis)
		if (catAssign) {
			used.add(catAssign.field.name)
			assignments.push({ channel: "hue", field: catAssign.field })
		}
	}

	const hueAlreadyMapped = assignments.some((a) => a.channel === "hue")
	const opportunisticHueEnabled = variation.allowOpportunisticHue !== false
	if (
		opportunisticHueEnabled &&
		variation.channels.hue === undefined &&
		!hueAlreadyMapped
	) {
		// Alternate between a categorical (palette) hue and a quantitative
		// (gradient) hue so the autogen demonstrates both color modes. The roll
		// prefers one type, but falls back to the other so hue still appears on
		// type-poor datasets. Either way hue is prioritized — prefer a fresh
		// field, but reuse one rather than leave the chart monochrome.
		const catEligible = fields.filter((f) =>
			CATEGORICAL_FILL_TYPES.includes(effectiveTypeOf(f, overrides))
		)
		const quantEligible = fields.filter((f) =>
			CONTINUOUS_HUE_TYPES.includes(effectiveTypeOf(f, overrides))
		)
		const wantQuant = random() < AUTOGEN_FILL_WEIGHTS.quantitativeHue
		const primary = wantQuant ? quantEligible : catEligible
		const fallback = wantQuant ? catEligible : quantEligible
		const hueEligible = primary.length > 0 ? primary : fallback
		if (hueEligible.length > 0) {
			const fresh = hueEligible.filter((f) => !used.has(f.name))
			const pool = fresh.length > 0 ? fresh : hueEligible
			const idx = pickIndex(pool, "hue")
			const clamped = Math.max(0, Math.min(idx, pool.length - 1))
			const picked = pool[clamped]
			if (picked) {
				used.add(picked.name)
				assignments.push({ channel: "hue", field: picked })
			}
		}
	}

	// Showcase fill: opportunistically pack in extra aesthetic channels so the
	// auto-gen visual demonstrates the tool's range — but probabilistically,
	// not all-at-once, so successive clicks feel varied. Reuses fields freely
	// and skips any channel with no eligible field, so it never affects
	// satisfiability (only runs when chartType is given — i.e. at scaffold
	// time, not in `isVariationSatisfiable`). See `AUTOGEN_FILL_WEIGHTS`.
	if (chartType) {
		const assignedChannels = new Set(assignments.map((a) => a.channel))
		const hueField = assignments.find((a) => a.channel === "hue")?.field ?? null
		/** Map `channel` to an eligible field. `preferField`, when type-eligible,
		 * wins outright (used to point pattern at the hue field). */
		const fill = (
			channel: EncodingChannel,
			types: readonly FieldType[],
			preferField?: Field | null
		) => {
			if (
				assignedChannels.has(channel) ||
				variation.channels[channel] !== undefined
			) {
				return
			}
			const typeEligible = fields.filter((f) =>
				types.includes(effectiveTypeOf(f, overrides))
			)
			if (typeEligible.length === 0) return
			let picked: Field | undefined
			if (preferField && typeEligible.some((f) => f.name === preferField.name)) {
				picked = preferField
			} else {
				const fresh = typeEligible.filter((f) => !used.has(f.name))
				const pool = fresh.length > 0 ? fresh : typeEligible
				const idx = pickIndex(pool, channel)
				picked = pool[Math.max(0, Math.min(idx, pool.length - 1))]
			}
			if (!picked) return
			used.add(picked.name)
			assignedChannels.add(channel)
			assignments.push({ channel, field: picked })
		}

		const plan = AESTHETIC_FILL[chartType]
		// Point size: always, on chart families with point marks.
		for (const channel of plan.alwaysQuant) fill(channel, QUANTITATIVE_FILL_TYPES)
		// Decorative glyph channels: each rolled independently. Pattern points
		// at the hue field when possible so its ink pairs with the categorical
		// palette (colored patterns) instead of the dark default.
		for (const channel of plan.decorativeCat) {
			const weight =
				channel === "shape"
					? AUTOGEN_FILL_WEIGHTS.shape
					: AUTOGEN_FILL_WEIGHTS.pattern
			if (random() >= weight) continue
			fill(
				channel,
				CATEGORICAL_FILL_TYPES,
				channel === "pattern" ? hueField : null
			)
		}
		// Color modulation: at most ONE of brightness / saturation / opacity.
		if (
			plan.colorModQuant.length > 0 &&
			random() < AUTOGEN_FILL_WEIGHTS.colorModulation
		) {
			const i = Math.min(
				Math.floor(random() * plan.colorModQuant.length),
				plan.colorModQuant.length - 1
			)
			const channel = plan.colorModQuant[i]
			if (channel) fill(channel, QUANTITATIVE_FILL_TYPES)
		}
	}

	return assignments
}

/** A variation is satisfiable when `assignFields` can produce a full
 * assignment deterministically. */
export const isVariationSatisfiable = (
	variation: QuickStartVariation,
	fields: readonly Field[],
	overrides: Record<string, FieldType>,
	geo?: GeoFieldDetection | null
): boolean =>
	assignFields(variation, fields, overrides, undefined, undefined, undefined, geo) !==
	null

/** The indices of every variation in `QUICK_START_VARIATIONS[chartType]` that
 * this dataset can satisfy, in declaration order. Empty array means the icon
 * should be disabled. */
export const satisfiableVariationIndices = (
	chartType: QuickStartChartType,
	fields: readonly Field[],
	overrides: Record<string, FieldType>,
	geo?: GeoFieldDetection | null
): number[] =>
	QUICK_START_VARIATIONS[chartType]
		.map((v, i) => (isVariationSatisfiable(v, fields, overrides, geo) ? i : -1))
		.filter((i) => i >= 0)

/** Given the user's current cycle counter for a chart type and the list of
 * satisfiable variation indices, return the next variation's index in the
 * full table. Cycle position advances modulo the satisfiable count so a user
 * who cycles past the last satisfiable variation wraps back to the first. */
export const nextVariationIndex = (
	cyclePosition: number,
	satisfiableIndices: readonly number[]
): number | null => {
	if (satisfiableIndices.length === 0) return null
	const wrapped =
		((cyclePosition % satisfiableIndices.length) + satisfiableIndices.length) %
		satisfiableIndices.length
	return satisfiableIndices[wrapped] ?? null
}

/** Pure scaffold step: take a variation + its field assignments + the user's
 * current `ChannelConfigs`, and return the new encodings + configs that the
 * atoms should be set to.
 *
 * Encoding reset is total: every channel starts from empty, then just the
 * variation's channels get written. The Data Labels encodings reset the same
 * way — they come back empty unless the variation opts in via
 * `dataLabelsValueFrom`, so labels from a previous chart never leak onto the
 * new scaffold. For configs, most of the map is
 * preserved (axis formats, labels, existing color picks, facet settings)
 * and only the channels whose behavior the variation explicitly tunes —
 * `hue` (stackMode) and `connection` (fill/line) — are rewritten to known
 * defaults with the variation's knobs. Keeps "scaffold" narrow to the
 * encoding → channel-config surface that actually differentiates variations. */
export const applyVariation = (
	variation: QuickStartVariation,
	assignments: readonly ChannelAssignment[],
	currentConfigs: ChannelConfigs
): {
	encodings: Encodings
	configs: ChannelConfigs
	dataLabels: DataLabelsEncodings
} => {
	const encodings = emptyEncodings()
	for (const { channel, field } of assignments) {
		encodings[channel] = { field: field.name }
	}

	// Data labels ride the separate DataLabelsEncodings atom, not an encoding
	// channel. When the variation asks for them, label with the field that
	// landed on the named channel (the tile heatmap points this at `hue`, so
	// each cell prints the value that drives its color).
	const dataLabels = emptyDataLabelsEncodings()
	if (variation.dataLabelsValueFrom) {
		const source = assignments.find(
			(a) => a.channel === variation.dataLabelsValueFrom
		)
		if (source) dataLabels.value = { field: source.field.name }
	}

	const configs: ChannelConfigs = { ...currentConfigs }

	// Apply hue config when hue ended up in the assignments — either because
	// the variation required it or because the scaffold picked it up
	// opportunistically. Checking the assignments (rather than the variation
	// declaration) means opportunistic hue gets the right categorical config
	// and stack mode automatically.
	const hueAssigned = assignments.some((a) => a.channel === "hue")
	if (hueAssigned) {
		configs.hue = {
			...DEFAULT_CATEGORICAL_HUE_CONFIG,
			stackMode:
				variation.stackMode ?? DEFAULT_CATEGORICAL_HUE_CONFIG.stackMode,
		}
	}

	// Variation-seeded hue: flows point hue at the field another channel got
	// (`hueFrom: "connection"` → color by node over the endpoint union); trees
	// point it at the rootGroup DERIVED source (color by top-level group).
	// Both bypass `assignFields` — hue here isn't a fresh field pick.
	if (variation.hueFrom) {
		const source = assignments.find((a) => a.channel === variation.hueFrom)
		if (source) {
			encodings.hue = { field: source.field.name }
			configs.hue = { ...DEFAULT_CATEGORICAL_HUE_CONFIG }
		}
	}
	if (variation.hueMeasureSource) {
		encodings.hue = { field: null, measureSource: variation.hueMeasureSource }
		configs.hue = { ...DEFAULT_CATEGORICAL_HUE_CONFIG }
	}

	// Map variations also reset connection: their region-key field rides the
	// `connection` channel (via `variation.geo`, not `channels`), and stale
	// knobs from a previous chart (radar polygon fill, area fill) shouldn't
	// leak onto the map join.
	if (
		variation.channels.connection !== undefined ||
		variation.geo === "choropleth" ||
		variation.geo === "symbols"
	) {
		configs.connection = {
			...DEFAULT_CONNECTION_CONFIG,
			fill: variation.connectionFill ?? DEFAULT_CONNECTION_CONFIG.fill,
			// Radar-only knob — `RadarPlot.buildPolygons` reads this to
			// fill closed polygons with their hue color. The renderer
			// ignores it outside radar mode, so leaving it on a config
			// that gets re-applied to (e.g.) a line chart is benign.
			// `fillOpacity` shifts to 0.25 for filled-polygon variants so
			// the new chart lands at the canonical "watercolor radar"
			// look instead of a solid disc.
			...(variation.polygonFill
				? { fillPolygon: true, fillOpacity: 0.25 }
				: {}),
			// Hierarchy/flow scaffolds pick their layout here — the shared
			// area+connection signature renders whatever this selects (the
			// mode registry dispatches on it). Id / target columns stay on
			// auto-detect.
			...(variation.hierarchyLayout
				? { hierarchyLayout: variation.hierarchyLayout }
				: {}),
		}
	}

	// Strip-plot variants enable a violin or box overlay on the value axis.
	// We re-stamp the entire axis config from defaults so a previous chart's
	// custom gridline / spine settings don't leak in unexpected ways.
	if (variation.distributionOverlay) {
		const axis = variation.distributionOverlay.axis
		const previous: AxisConfig = configs[axis] ?? DEFAULT_AXIS_CONFIG
		configs[axis] = {
			...previous,
			distributionOverlay: {
				...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
				showDensityViolin: variation.distributionOverlay.mode === "violin",
				showBoxPlot: variation.distributionOverlay.mode === "box",
			},
		}
		// The opposite axis must NOT also have an overlay — clear it in case a
		// previous variation left one behind.
		const otherAxis = axis === "x" ? "y" : "x"
		const other = configs[otherAxis]
		if (other?.distributionOverlay) {
			configs[otherAxis] = {
				...other,
				distributionOverlay: {
					...other.distributionOverlay,
					showDensityViolin: false,
					showBoxPlot: false,
				},
			}
		}
	} else {
		// Non-strip variations should clear any leftover overlay from a prior
		// strip-plot click — without this, switching from "violin" to "scatter"
		// keeps the violins floating around.
		for (const axis of ["x", "y"] as const) {
			const cfg = configs[axis]
			if (cfg?.distributionOverlay) {
				configs[axis] = {
					...cfg,
					distributionOverlay: {
						...cfg.distributionOverlay,
						showDensityViolin: false,
						showBoxPlot: false,
					},
				}
			}
		}
	}

	// Variations that don't map length should clear any sticky `defaultLength`
	// from a previous variation — otherwise marks keep rendering as line
	// segments after switching to (e.g.) plain scatter.
	if (variation.channels.length === undefined) {
		configs.defaultLength = null
	}

	return { encodings, configs, dataLabels }
}

/** The map config a scaffold should install alongside its encodings.
 *
 * Map variations get a fresh geographic config pointed at the detected
 * geography level — the assigned region field's level, or the lat/long
 * points' level for a dot map. Non-map variations turn OFF a leftover
 * geographic coord system (otherwise the geo chart modes would keep claiming
 * the new x/y/connection encodings) but leave the user's other map settings
 * untouched so switching back is cheap. */
export const mapConfigForVariation = (
	variation: QuickStartVariation,
	assignments: readonly ChannelAssignment[],
	geo: GeoFieldDetection | null,
	current: MapConfig
): MapConfig => {
	if (!variation.geo) {
		return current.coordSystem === "geographic"
			? { ...current, coordSystem: "noMap" }
			: current
	}
	let level: "states" | "countries"
	if (variation.geo === "points") {
		level = geo?.pointsLevel ?? "states"
	} else {
		const regionName = assignments.find((a) => a.channel === "connection")
			?.field.name
		level =
			geo?.regionFields.find((r) => r.field.name === regionName)?.level ??
			"states"
	}
	return {
		...DEFAULT_MAP_CONFIG,
		coordSystem: "geographic",
		geographyLevel: level,
	}
}
