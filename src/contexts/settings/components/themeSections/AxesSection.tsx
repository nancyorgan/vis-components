import { ColorInput, NumberInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const AxesSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => (
	<SectionGroup title="Axes and gridlines" isReadOnly={isReadOnly}>
		<Section title="X gridline defaults">
			<ColorInput
				label="Color"
				value={theme.xGridlineColor ?? theme.gridlineColor}
				onChange={(v) => set("xGridlineColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.xGridlineThickness ?? theme.gridlineThickness}
				onChange={(v) => set("xGridlineThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
		</Section>

		<Section title="Y gridline defaults">
			<ColorInput
				label="Color"
				value={theme.yGridlineColor ?? theme.gridlineColor}
				onChange={(v) => set("yGridlineColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.yGridlineThickness ?? theme.gridlineThickness}
				onChange={(v) => set("yGridlineThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
		</Section>

		<Section title="R gridline defaults">
			<ColorInput
				label="Color"
				value={theme.rGridlineColor ?? theme.gridlineColor}
				onChange={(v) => set("rGridlineColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.rGridlineThickness ?? theme.gridlineThickness}
				onChange={(v) => set("rGridlineThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Concentric rings on radar charts. By default, one gridline is
				drawn per labeled axis tick; adjust the count per-visualization
				from the X, Y, or R axis panel.
			</p>
		</Section>

		{/* Tick marks */}
		<Section title="Tick mark defaults">
			<ColorInput
				label="Color"
				value={theme.tickmarkColor}
				onChange={(v) => set("tickmarkColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.tickmarkThickness}
				onChange={(v) => set("tickmarkThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
			<NumberInput
				label="Length"
				value={theme.tickmarkLength}
				onChange={(v) => set("tickmarkLength", v)}
				min={0}
				max={20}
				step={1}
				suffix="px"
			/>
		</Section>

		{/* Axis spine */}
		<Section title="Axis spine defaults">
			<ColorInput
				label="Color"
				value={theme.spineColor}
				onChange={(v) => set("spineColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.spineThickness}
				onChange={(v) => set("spineThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
		</Section>
	</SectionGroup>
)
