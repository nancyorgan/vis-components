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
				<span className="text-sm vc-muted">
					Chart background
				</span>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						checked={theme.chartBackgroundColor === null}
						onChange={() => set("chartBackgroundColor", null)}
					/>
					<span className="vc-text">
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
					<span className="vc-text">
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
