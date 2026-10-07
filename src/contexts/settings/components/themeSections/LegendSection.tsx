import { SwatchShapePicker } from "../../../chartBuilder/components/sidebar/SwatchShapePicker"
import { ColorInput, NumberInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const LegendSection = ({ theme, set, isReadOnly }: ThemeSectionProps) => (
	<SectionGroup title="Legend" isReadOnly={isReadOnly}>
		<Section title="Legend defaults">
			<div className="flex flex-col gap-1.5">
				<span className="text-sm vc-muted">
					Legend background
				</span>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.legendBackgroundColor === null}
						onChange={() => set("legendBackgroundColor", null)}
					/>
					<span className="vc-text">
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
					<span className="vc-text">
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
				<span className="text-sm vc-muted">
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
		<Section title="Legend swatches">
			<p className="text-xs text-stone-500 dark:text-stone-400">
				What the discrete swatches of a color, saturation, brightness,
				pattern, opacity, or rug legend start as. A shape encoding keeps
				its own glyphs. The Legend panel&apos;s Swatches groups override
				these per visual.
			</p>
			<div className="flex flex-col gap-1.5">
				<span className="text-sm vc-muted">Swatch shape</span>
				<SwatchShapePicker
					value={theme.legendSwatchShape}
					onChange={(shape) => set("legendSwatchShape", shape)}
				/>
			</div>
			<NumberInput
				label="Swatch size"
				value={theme.legendSwatchSize}
				min={3}
				max={20}
				step={1}
				suffix="px"
				onChange={(v) => set("legendSwatchSize", v)}
			/>
			<NumberInput
				label="Outline width"
				value={theme.legendSwatchOutlineWidth}
				min={0}
				max={10}
				step={0.5}
				suffix="px"
				onChange={(v) => set("legendSwatchOutlineWidth", v)}
			/>
			<div className="flex flex-col gap-1.5">
				<span className="text-sm vc-muted">Outline color</span>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.legendSwatchOutlineColor === null}
						onChange={() => set("legendSwatchOutlineColor", null)}
					/>
					<span className="vc-text">
						Automatic (follows the marks&apos; outline)
					</span>
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.legendSwatchOutlineColor !== null}
						onChange={() =>
							set(
								"legendSwatchOutlineColor",
								theme.legendSwatchOutlineColor ?? "#cccccc"
							)
						}
					/>
					<span className="vc-text">Custom color</span>
				</label>
				{theme.legendSwatchOutlineColor !== null && (
					<ColorInput
						label="Color"
						value={theme.legendSwatchOutlineColor}
						onChange={(v) => set("legendSwatchOutlineColor", v)}
					/>
				)}
			</div>
		</Section>
	</SectionGroup>
)
