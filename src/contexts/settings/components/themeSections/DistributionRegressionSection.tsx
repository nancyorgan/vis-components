import { ColorInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const DistributionRegressionSection = ({
	theme,
	set,
	isReadOnly,
}: ThemeSectionProps) => (
	<SectionGroup title="Distribution and regression" isReadOnly={isReadOnly}>
		{/* Distribution overlay defaults */}
		<Section title="Distribution overlay defaults">
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Stroke and fill used by violin and box-plot overlays when first
				enabled on a chart&apos;s value axis.
			</p>
			<ColorInput
				label="Stroke"
				value={theme.distributionOverlayStroke}
				onChange={(v) => set("distributionOverlayStroke", v)}
			/>
			<ColorInput
				label="Fill"
				value={theme.distributionOverlayFill}
				onChange={(v) => set("distributionOverlayFill", v)}
			/>
		</Section>

		{/* Regression overlay defaults */}
		<Section title="Regression line defaults">
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Line stroke and confidence-band fill used by the scatter
				regression line when first enabled.
			</p>
			<ColorInput
				label="Line"
				value={theme.regressionStroke}
				onChange={(v) => set("regressionStroke", v)}
			/>
			<ColorInput
				label="Band fill"
				value={theme.regressionCiFill}
				onChange={(v) => set("regressionCiFill", v)}
			/>
		</Section>
	</SectionGroup>
)
