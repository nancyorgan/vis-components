import { NumberInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const AestheticRangesSection = ({
	theme,
	set,
	isReadOnly,
}: ThemeSectionProps) => (
	<SectionGroup title="Aesthetic ranges" isReadOnly={isReadOnly}>
		{/* Aesthetic-channel range defaults */}
		<Section title="Aesthetic range defaults">
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Min and max bounds used when each aesthetic channel is first
				mapped.
			</p>
			<div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
				<NumberInput
					label="Length min"
					value={theme.lengthMin}
					onChange={(v) => set("lengthMin", v)}
					min={0}
					max={1000}
					step={1}
					suffix="px"
				/>
				<NumberInput
					label="Length max"
					value={theme.lengthMax}
					onChange={(v) => set("lengthMax", v)}
					min={0}
					max={1000}
					step={1}
					suffix="px"
				/>
				<NumberInput
					label="Angle min"
					value={theme.angleMin}
					onChange={(v) => set("angleMin", v)}
					min={-360}
					max={360}
					step={1}
					suffix="°"
				/>
				<NumberInput
					label="Angle max"
					value={theme.angleMax}
					onChange={(v) => set("angleMax", v)}
					min={-360}
					max={360}
					step={1}
					suffix="°"
				/>
				<NumberInput
					label="Area min"
					value={theme.areaMin}
					onChange={(v) => set("areaMin", v)}
					min={0}
					max={200}
					step={1}
					suffix="px"
				/>
				<NumberInput
					label="Area max"
					value={theme.areaMax}
					onChange={(v) => set("areaMax", v)}
					min={0}
					max={200}
					step={1}
					suffix="px"
				/>
				<NumberInput
					label="Saturation min"
					value={theme.saturationMin}
					onChange={(v) => set("saturationMin", v)}
					min={0}
					max={1}
					step={0.05}
				/>
				<NumberInput
					label="Saturation max"
					value={theme.saturationMax}
					onChange={(v) => set("saturationMax", v)}
					min={0}
					max={1}
					step={0.05}
				/>
				<NumberInput
					label="Brightness min"
					value={theme.brightnessMin}
					onChange={(v) => set("brightnessMin", v)}
					min={0}
					max={1}
					step={0.05}
				/>
				<NumberInput
					label="Brightness max"
					value={theme.brightnessMax}
					onChange={(v) => set("brightnessMax", v)}
					min={0}
					max={1}
					step={0.05}
				/>
			</div>
		</Section>
	</SectionGroup>
)
