import { combine as c } from "../../../../../../lib/cls"

import { LABEL_COL } from "../../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../../components/ui/ResetLink"
import { Segmented } from "../../../../../../components/ui/Segmented"

import type { PatternPanel } from "./usePatternPanel"

const SEGMENT_PATTERN_SEGMENTS = [
	{ key: "dash", label: "Dash" },
	{ key: "fill", label: "Fill" },
] as const

/** The "Segments" toggle (scatter line segments, no connection): an
 *  explicit Dash / Fill pick, or auto (the key is absent — reset STRIPS it
 *  rather than writing null, so untouched saves don't grow a key). */
export const SegmentsRow = ({ p }: { p: PatternPanel }) => {
	const { configs, setConfigs, segmentContext } = p
	if (!segmentContext) return null
	const segmentPatternSet = configs.pattern?.segmentPattern !== undefined
	const resetSegmentPattern = () =>
		setConfigs((prev) => {
			if (!prev.pattern || prev.pattern.segmentPattern === undefined) return prev
			const { segmentPattern: _removed, ...rest } = prev.pattern
			return { ...prev, pattern: rest }
		})
	return (
		<div className="flex flex-col gap-1 px-2 text-sm">
			<div className="flex items-center gap-2">
				<span
					className={c(
						"shrink-0",
						LABEL_COL,
						segmentPatternSet && "font-semibold !text-vc-section-header"
					)}
				>
					Segments
				</span>
				<Segmented
					ariaLabel="Pattern on segments"
					value={segmentContext.mode}
					segments={SEGMENT_PATTERN_SEGMENTS}
					onChange={(segmentPattern) => p.updateCfg({ segmentPattern })}
				/>
				{segmentPatternSet && <ResetLink onClick={resetSegmentPattern} />}
			</div>
			{!segmentPatternSet && (
				<p className="vc-help">
					Auto: Fill once the segments are at least one pattern tile thick
					({Math.ceil(segmentContext.tileSide)}px), else Dash.
				</p>
			)}
		</div>
	)
}
