import { ColorInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const LegendSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => (
	<SectionGroup title="Legend" isReadOnly={isReadOnly}>
		<Section title="Legend defaults">
			<div className="flex flex-col gap-1.5">
				<span className="vc-text-muted text-sm">
					Legend background
				</span>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.legendBackgroundColor === null}
						onChange={() => set("legendBackgroundColor", null)}
					/>
					<span className="vc-text-2">
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
					<span className="vc-text-2">
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
				<span className="vc-text-muted text-sm">
					Legend swatch color
				</span>
				<p className="vc-text-faint text-xs">
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
