import { ColorInput, Section, SectionGroup } from "./controls"
import type { ThemeSectionProps } from "./types"

export const GlobalAestheticsSection = ({
	theme,
	set,
	isReadOnly,
}: ThemeSectionProps) => (
	<SectionGroup title="Global aesthetics" isReadOnly={isReadOnly}>
		<Section title="Backgrounds">
			<div className="flex flex-col gap-1.5">
				<span className="text-sm text-stone-600 dark:text-stone-400">
					Chart background
				</span>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.chartBackgroundColor === null}
						onChange={() => set("chartBackgroundColor", null)}
					/>
					<span className="text-stone-700 dark:text-stone-300">
						Transparent (host page shows through)
					</span>
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.chartBackgroundColor !== null}
						onChange={() =>
							set(
								"chartBackgroundColor",
								theme.chartBackgroundColor ?? "#ffffff"
							)
						}
					/>
					<span className="text-stone-700 dark:text-stone-300">
						Custom color
					</span>
				</label>
				{theme.chartBackgroundColor !== null && (
					<ColorInput
						label="Color"
						value={theme.chartBackgroundColor}
						onChange={(v) => set("chartBackgroundColor", v)}
					/>
				)}
			</div>
		</Section>
	</SectionGroup>
)
