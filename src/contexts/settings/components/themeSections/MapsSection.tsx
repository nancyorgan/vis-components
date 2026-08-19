import { dataLabelsConfigFromTheme } from "../../../chartBuilder/lib/themeConfig"

import { ColorInput, NumberInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const MapsSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => {
	// Resolved values: the theme's map fields with the built-in defaults
	// behind them — exactly what the Data Labels panel seeds and shows (the
	// same builder feeds both).
	const labels = dataLabelsConfigFromTheme(theme)
	return (
		<SectionGroup title="Maps" isReadOnly={isReadOnly}>
			<Section title="Data label leader lines">
				<p className="text-sm text-stone-600 dark:text-stone-400">
					Default stroke for the leader lines that connect a map&apos;s data
					labels back to their regions (&quot;Draw leader lines&quot; in the
					Data Labels panel).
				</p>
				<ColorInput
					label="Line color"
					value={labels.leaderLineColor ?? "#999999"}
					onChange={(v) => set("mapLeaderLineColor", v)}
				/>
				<NumberInput
					label="Line thickness"
					value={labels.leaderLineWidth ?? 1}
					onChange={(v) => set("mapLeaderLineThickness", v)}
					min={0}
					max={10}
					step={0.5}
					suffix="px"
				/>
			</Section>
		</SectionGroup>
	)
}
