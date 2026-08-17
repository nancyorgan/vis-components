import { ColorInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const LegendSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => (
	<SectionGroup title="Legend" isReadOnly={isReadOnly}>
		<Section title="Legend defaults">
			<div className="flex flex-col gap-1.5">
				<span className="text-sm text-stone-600 dark:text-stone-400">
					Legend background
				</span>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.legendBackgroundColor === null}
						onChange={() => set("legendBackgroundColor", null)}
					/>
					<span className="text-stone-700 dark:text-stone-300">
						Transparent
					</span>
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.legendBackgroundColor !== null}
						onChange={() =>
							set(
								"legendBackgroundColor",
								theme.legendBackgroundColor ?? "#ffffff"
							)
						}
					/>
					<span className="text-stone-700 dark:text-stone-300">
						Custom color
					</span>
				</label>
				{theme.legendBackgroundColor !== null && (
					<ColorInput
						label="Color"
						value={theme.legendBackgroundColor}
						onChange={(v) => set("legendBackgroundColor", v)}
					/>
				)}
			</div>
			<div className="flex flex-col gap-1.5">
				<span className="text-sm text-stone-600 dark:text-stone-400">
					Legend swatch color
				</span>
				<p className="text-xs text-stone-500 dark:text-stone-400">
					Default fill and outline for length / angle / area / opacity
					legend swatches when they render alongside a gradient (no hue
					color to inherit). The outline applies to the area (size)
					swatch. Per-visual overrides live in the Legend panel.
				</p>
				<ColorInput
					label="Fill"
					value={theme.legendSwatchColor}
					onChange={(v) => set("legendSwatchColor", v)}
				/>
				<ColorInput
					label="Outline"
					value={theme.legendSwatchStroke}
					onChange={(v) => set("legendSwatchStroke", v)}
				/>
			</div>
		</Section>
	</SectionGroup>
)
