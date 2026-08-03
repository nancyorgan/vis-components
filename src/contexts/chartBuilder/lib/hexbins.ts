// Hexbin binning — DATA-SPACE (ggplot2 geom_hex style), not pixel-space:
// counts depend only on data + bin count, so they are stable across
// resizes / facet panels / exports, and the Legend can compute the same
// [0, maxCount] gradient domain WITHOUT knowing plot pixel dimensions
// (it has none — mirrors histogramMeasureDomain's renderer/legend sharing).
// The renderer maps the normalized lattice to pixels affinely, so cells
// still tile exactly; hexagons stretch to the plot's aspect ratio.
import { extent } from "d3-array"
import { hexbin as d3Hexbin } from "d3-hexbin"
import { scaleLinear } from "d3-scale"

import { parseValue } from "./scales"

export const DEFAULT_HEXBIN_BIN_COUNT = 20

export type HexbinCell = {
	/** Cell center in normalized [0,1] coordinates over the axis domains
	 * (y NOT screen-inverted: 0 = domain min). */
	cx: number
	cy: number
	count: number
}

export type HexbinResult = {
	cells: HexbinCell[]
	maxCount: number
	/** Hexagon circumradius in normalized units. */
	radius: number
	/** The resolved (nice-d + user-overridden) domains, for callers that
	 * need to cross-check alignment with the axis scales. */
	xDomain: [number, number]
	yDomain: [number, number]
}

type Bounds = { min?: number; max?: number }

/** Domain exactly as the axis scale computes it: extent of parsed values →
 * d3 `.nice()`, then user bounds override WITHOUT re-nicing. Must match
 * `makePositionScale`'s quantitative branch + ScatterPlot's
 * `overrideLinearDomain` — if these drift, hex cells misalign with the
 * axes. */
const resolveDomain = (
	values: readonly number[],
	bounds?: Bounds
): [number, number] => {
	const [lo = 0, hi = 1] = extent(values) as [number, number]
	const [nLo, nHi] = scaleLinear().domain([lo, hi]).nice().domain() as [
		number,
		number,
	]
	return [bounds?.min ?? nLo, bounds?.max ?? nHi]
}

const parseNums = (raw: readonly unknown[]): Array<number | null> =>
	raw.map((v) => {
		const p = parseValue(v, "quantitative")
		return typeof p === "number" ? p : null
	})

/** Bin paired x/y values onto a pointy-top hex lattice in normalized
 * domain space. `binCount` = target hex columns across x. Rows where either
 * value is unparseable, or that fall outside the (possibly user-pinned)
 * domain, are skipped. `domainXRaw`/`domainYRaw` let faceted callers compute
 * the domain from the SHARED rows while binning only the panel's own rows.
 * Returns null when no point survives. */
export const resolveHexbinCells = (
	xRaw: readonly unknown[],
	yRaw: readonly unknown[],
	binCount: number,
	xBounds?: Bounds,
	yBounds?: Bounds,
	opts?: {
		domainXRaw?: readonly unknown[]
		domainYRaw?: readonly unknown[]
	}
): HexbinResult | null => {
	const xs = parseNums(xRaw)
	const ys = parseNums(yRaw)
	const domXs = opts?.domainXRaw
		? (parseNums(opts.domainXRaw).filter((v) => v !== null) as number[])
		: (xs.filter((v) => v !== null) as number[])
	const domYs = opts?.domainYRaw
		? (parseNums(opts.domainYRaw).filter((v) => v !== null) as number[])
		: (ys.filter((v) => v !== null) as number[])
	if (domXs.length === 0 || domYs.length === 0) return null
	const xDomain = resolveDomain(domXs, xBounds)
	const yDomain = resolveDomain(domYs, yBounds)
	const spanX = xDomain[1] - xDomain[0] || 1
	const spanY = yDomain[1] - yDomain[0] || 1

	const pts: Array<[number, number]> = []
	const n = Math.min(xs.length, ys.length)
	for (let i = 0; i < n; i++) {
		const x = xs[i]
		const y = ys[i]
		if (x === null || y === null) continue
		const nx = (x - xDomain[0]) / spanX
		const ny = (y - yDomain[0]) / spanY
		if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue
		pts.push([nx, ny])
	}
	if (pts.length === 0) return null

	// Pointy-top hexes: horizontal center spacing = sqrt(3) * radius, so
	// binCount columns across the unit x span → radius = 1/(binCount*sqrt(3)).
	const radius = 1 / (Math.max(1, binCount) * Math.sqrt(3))
	const bins = d3Hexbin<[number, number]>()
		.x((d) => d[0])
		.y((d) => d[1])
		.radius(radius)(pts)
	const cells = bins.map((b) => ({ cx: b.x, cy: b.y, count: b.length }))
	let maxCount = 0
	for (const c of cells) if (c.count > maxCount) maxCount = c.count
	return { cells, maxCount, radius, xDomain, yDomain }
}

/** Pointy-top hexagon corner offsets from a cell center, in NORMALIZED
 * units. The renderer multiplies dx by the plot's pixel width and dy by its
 * pixel height — the lattice's affine image still tiles exactly, hexagons
 * just stretch to the plot's aspect ratio. */
export const hexCornerOffsets = (
	radius: number
): ReadonlyArray<readonly [number, number]> =>
	Array.from({ length: 6 }, (_, i) => {
		const a = (Math.PI / 3) * i
		return [radius * Math.sin(a), -radius * Math.cos(a)] as const
	})
