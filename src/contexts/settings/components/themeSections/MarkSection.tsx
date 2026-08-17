import { SHAPE_PALETTE } from "../../../chartBuilder/lib/scales"

import {
	ColorInput,
	NumberInput,
	Section,
	SectionGroup,
	ShapeGlyph,
} from "./controls"
import type { ThemeSectionProps } from "./types"

export const MarkSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => (
	<SectionGroup title="Mark" isReadOnly={isReadOnly}>
		{/* Mark defaults */}
		<Section title="Mark defaults">
			<ColorInput
				label="Fill color"
				value={theme.defaultFill}
				onChange={(v) => set("defaultFill", v)}
			/>
			<NumberInput
				label="Point radius"
				value={theme.defaultRadius}
				onChange={(v) => set("defaultRadius", v)}
				min={1}
				max={200}
				step={1}
				suffix="px"
			/>
			<NumberInput
				label="Opacity"
				value={theme.defaultOpacity}
				onChange={(v) => set("defaultOpacity", v)}
				min={0}
				max={1}
				step={0.05}
			/>
			<div className="flex items-center gap-2 text-sm">
				<span className="w-32 text-stone-600 dark:text-stone-400">
					Default shape
				</span>
				<div className="flex gap-1" role="group" aria-label="Default shape">
					{SHAPE_PALETTE.map((_, idx) => {
						const selected = idx === theme.defaultShape
						return (
							<button
								// eslint-disable-next-line react/no-array-index-key
								key={idx}
								type="button"
								onClick={() => set("defaultShape", idx)}
								aria-label={`Shape ${idx + 1}`}
								aria-pressed={selected}
								className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
									selected
										? "border-stone-900 bg-white text-stone-900 dark:border-white dark:bg-stone-800 dark:text-white"
										: "border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900"
								}`}
							>
								<ShapeGlyph idx={idx} selected={selected} />
							</button>
						)
					})}
				</div>
			</div>
			<ColorInput
				label="Outline color"
				value={theme.outlineColor}
				onChange={(v) => set("outlineColor", v)}
			/>
			<NumberInput
				label="Outline width"
				value={theme.outlineWidth}
				onChange={(v) => set("outlineWidth", v)}
				min={0}
				max={10}
				step={0.5}
				suffix="px"
			/>
		</Section>

		{/* Connection (line) defaults */}
		<Section title="Connection (line) defaults">
			<p className="text-sm text-stone-600 dark:text-stone-400">
				Defaults applied when a connection (line / lollipop stem) is first
				mapped on a scatter plot.
			</p>
			<NumberInput
				label="Line thickness"
				value={theme.connectionThickness}
				onChange={(v) => set("connectionThickness", v)}
				min={0}
				max={10}
				step={0.5}
				suffix="px"
			/>
			<ColorInput
				label="Line color"
				value={theme.connectionColor}
				onChange={(v) => set("connectionColor", v)}
			/>
		</Section>
	</SectionGroup>
)
