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

		{/* Axis spines — per-axis fields written on edit; the legacy shared
		    spineColor/spineThickness remain the fallback for old themes. */}
		<Section title="X spine defaults">
			<ColorInput
				label="Color"
				value={theme.xSpineColor ?? theme.spineColor}
				onChange={(v) => set("xSpineColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.xSpineThickness ?? theme.spineThickness}
				onChange={(v) => set("xSpineThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
		</Section>

		<Section title="Y spine defaults">
			<ColorInput
				label="Color"
				value={theme.ySpineColor ?? theme.spineColor}
				onChange={(v) => set("ySpineColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.ySpineThickness ?? theme.spineThickness}
				onChange={(v) => set("ySpineThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
		</Section>

		<Section title="Polar spine defaults">
			<ColorInput
				label="Color"
				value={theme.polarSpineColor ?? theme.spineColor}
				onChange={(v) => set("polarSpineColor", v)}
			/>
			<NumberInput
				label="Thickness"
				value={theme.polarSpineThickness ?? theme.spineThickness}
				onChange={(v) => set("polarSpineThickness", v)}
				min={0}
				max={5}
				step={0.5}
				suffix="px"
			/>
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Spokes and perimeter on radar charts, and the ring axis on chord
				diagrams.
			</p>
		</Section>
	</SectionGroup>
)
