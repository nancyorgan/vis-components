import type { DataLabelsConfig } from "../../../lib/channelConfig"

import { Toggle } from "../../../../../components/ui/Toggle"

// ---------------------------------------------------------------------------
// Text position — packed circles only. One checkbox per container level:
// checked levels draw their group name on an arc around the OUTSIDE of the
// circle (12 o'clock, via <textPath>) instead of inside the top rim.
// ---------------------------------------------------------------------------
const WRAP_LEVEL_LABELS = [
	"Top level circle",
	"Second level circle",
	"Third level circle",
	"Fourth level circle",
]
const wrapLevelLabel = (level: number): string =>
	WRAP_LEVEL_LABELS[level - 1] ?? `Level ${level} circle`

export const TextPositionPanel = ({
	cfg,
	onChange,
	levels,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	/** Container depths present in the current hierarchy (1 = top level). */
	levels: number[]
}) => {
	const wrapped = cfg.arcWrapLevels ?? []
	const toggle = (level: number, on: boolean) =>
		onChange({
			arcWrapLevels: on
				? [...wrapped, level].sort((a, b) => a - b)
				: wrapped.filter((l) => l !== level),
		})
	if (levels.length === 0) {
		return (
			<p className="vc-help">
				Labels can wrap around grouping circles once the chart has them —
				map a categorical field to the connection channel first.
			</p>
		)
	}
	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm text-stone-600 dark:text-stone-400">
				Wrap label around
			</span>
			{levels.map((level) => (
				<Toggle
					key={level}
					label={wrapLevelLabel(level)}
					checked={wrapped.includes(level)}
					onChange={(on) => toggle(level, on)}
				/>
			))}
			<p className="vc-help">
				Checked levels draw the group name on an arc around the outside of
				the circle; unchecked levels keep it inside the top rim.
			</p>
		</div>
	)
}
