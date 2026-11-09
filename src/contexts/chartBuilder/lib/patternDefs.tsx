import {
	CUSTOM_PATTERN_TILE_PX,
	customPatternPath,
	isCustomPatternIdx,
	resolveCustomPattern,
	useCustomPatterns,
} from "./customPatterns"
import {
	effectivePatternRotation,
	effectivePatternScale,
	PATTERN_PALETTE,
} from "./patterns"

export type PatternDefSpec = {
	svgId: string
	paletteIdx: number
	bgColor: string
	inkColor: string
	/** Tile zoom (see `PatternConfig.scales`); absent = ×1. Resolved specs
	 * always carry it; hand-built ones (the map's no-data def) leave it out. */
	scale?: number
	/** Tile rotation in degrees (see `PatternConfig.rotations`); absent =
	 * 0°. */
	rotation?: number
}

/** Dedup pattern defs by svgId so we don't emit duplicate <pattern> elements. */
export const dedupPatternDefs = (specs: PatternDefSpec[]): PatternDefSpec[] => {
	const seen = new Set<string>()
	const out: PatternDefSpec[] = []
	for (const s of specs) {
		if (seen.has(s.svgId)) continue
		seen.add(s.svgId)
		out.push(s)
	}
	return out
}

/** One `<pattern>` element: the palette tile at `paletteIdx`, background +
 * ink baked in, zoomed by `scale`. The marks (dot radius, stripe width)
 * grow by the full scale; the tile — the spacing between them — grows by
 * `scale ^ spacingExponent` (see `PatternDef`), so dots and stripes
 * tighten up a little as they're zoomed in while the crosshatch and
 * checker magnify uniformly. Every pattern tile in the app — chart defs,
 * legend swatches, the Pattern menu's chips, the theme sampler, the map's
 * no-data chips — renders through here so they can't drift. Place inside
 * `<defs>`. */
/** Side (px) of the palette tile at `paletteIdx` zoomed by `scale` — the
 * repeat distance between marks, exactly as `PatternTile` sizes its
 * `<pattern>`. The segment-pattern auto rule compares a segment's thickness
 * against it (one full repeat must fit across the stroke). */
export const patternTileSide = (
	paletteIdx: number,
	scale?: number | null
): number => {
	const s = effectivePatternScale(scale)
	// Custom (uploaded) patterns are a fixed grid that zooms uniformly.
	if (isCustomPatternIdx(paletteIdx)) {
		return Number((CUSTOM_PATTERN_TILE_PX * s).toFixed(3))
	}
	const def = PATTERN_PALETTE[paletteIdx % PATTERN_PALETTE.length]
	// Rounded so float noise (10 × 0.3) doesn't leak into the attribute.
	return Number((def.size * s ** def.spacingExponent).toFixed(3))
}

/** The `patternTransform` that turns a tile by `rotation` degrees
 * (clockwise, about the user-space origin — the grid as a whole turns, so
 * stripes change direction without the tile seams drifting per mark);
 * `undefined` at 0° so unrotated defs serialize exactly as before. */
export const patternTransformFor = (
	rotation?: number | null
): string | undefined => {
	const r = effectivePatternRotation(rotation)
	return r === 0 ? undefined : `rotate(${r})`
}

export const PatternTile = ({
	id,
	paletteIdx,
	bgColor,
	inkColor,
	scale,
	rotation,
}: {
	id: string
	paletteIdx: number
	bgColor: string
	inkColor: string
	scale?: number | null
	rotation?: number | null
}) => {
	const customPatterns = useCustomPatterns()
	const s = effectivePatternScale(scale)
	const patternTransform = patternTransformFor(rotation)
	if (isCustomPatternIdx(paletteIdx)) {
		const custom = resolveCustomPattern(paletteIdx, customPatterns)
		// A deleted / unknown custom slot draws the first built-in pattern
		// rather than leaving the mark bare.
		if (!custom) {
			return (
				<PatternTile
					id={id}
					paletteIdx={0}
					bgColor={bgColor}
					inkColor={inkColor}
					scale={scale}
					rotation={rotation}
				/>
			)
		}
		const side = patternTileSide(paletteIdx, scale)
		if ("mask" in custom) {
			// The stored grayscale mask paints the ink: white = ink, black =
			// background, grays (antialiased edges) blend — so the upload's
			// curves stay smooth at any Scale. Defined inside the pattern so
			// each def carries its own mask id.
			const maskId = `${id}-mask`
			return (
				<pattern
					id={id}
					patternUnits="userSpaceOnUse"
					width={side}
					height={side}
					patternTransform={patternTransform}
				>
					<mask
						id={maskId}
						maskUnits="userSpaceOnUse"
						x={0}
						y={0}
						width={side}
						height={side}
					>
						<image
							href={custom.mask}
							width={side}
							height={side}
							preserveAspectRatio="none"
						/>
					</mask>
					<rect width={side} height={side} fill={bgColor} />
					<rect
						width={side}
						height={side}
						fill={inkColor}
						mask={`url(#${maskId})`}
					/>
				</pattern>
			)
		}
		return (
			<pattern
					id={id}
					patternUnits="userSpaceOnUse"
					width={side}
					height={side}
					patternTransform={patternTransform}
				>
				<rect width={side} height={side} fill={bgColor} />
				<path
					d={customPatternPath(custom)}
					transform={`scale(${Number((side / custom.size).toFixed(4))})`}
					fill={inkColor}
				/>
			</pattern>
		)
	}
	const def = PATTERN_PALETTE[paletteIdx % PATTERN_PALETTE.length]
	const side = patternTileSide(paletteIdx, scale)
	return (
		<pattern
					id={id}
					patternUnits="userSpaceOnUse"
					width={side}
					height={side}
					patternTransform={patternTransform}
				>
			<rect width={side} height={side} fill={bgColor} />
			{def.render(inkColor, { side, mark: s })}
		</pattern>
	)
}

/** Renders the `<defs>` block with one `<pattern>` per unique spec.
 * Use inside an SVG. */
export const PatternDefs = ({ defs }: { defs: PatternDefSpec[] }) => (
	<defs>
		{dedupPatternDefs(defs).map(
			({ svgId, paletteIdx, bgColor, inkColor, scale, rotation }) => (
				<PatternTile
					key={svgId}
					id={svgId}
					paletteIdx={paletteIdx}
					bgColor={bgColor}
					inkColor={inkColor}
					scale={scale}
					rotation={rotation}
				/>
			)
		)}
	</defs>
)
