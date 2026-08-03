import { PATTERN_PALETTE } from "./patterns"

export type PatternDefSpec = {
	svgId: string
	paletteIdx: number
	bgColor: string
	inkColor: string
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

/** Renders the `<defs>` block with one `<pattern>` per unique spec.
 * Use inside an SVG. */
export const PatternDefs = ({ defs }: { defs: PatternDefSpec[] }) => (
	<defs>
		{dedupPatternDefs(defs).map(({ svgId, paletteIdx, bgColor, inkColor }) => {
			const def = PATTERN_PALETTE[paletteIdx % PATTERN_PALETTE.length]
			return (
				<pattern
					key={svgId}
					id={svgId}
					patternUnits="userSpaceOnUse"
					width={def.size}
					height={def.size}
				>
					<rect width={def.size} height={def.size} fill={bgColor} />
					{def.render(inkColor)}
				</pattern>
			)
		})}
	</defs>
)
