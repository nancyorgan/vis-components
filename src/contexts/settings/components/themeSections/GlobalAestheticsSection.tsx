import { Checkbox } from "../../../../components/ui/Checkbox"
import { panelBorderFromTheme } from "../../../chartBuilder/lib/themeConfig"
import {
	ColorInput,
	NumberInput,
	Section,
	SectionGroup,
} from "./controls"
import type { ThemeSectionProps } from "./types"

/** The panel border a new chart gets: a closed rectangle around every plot
 *  panel, independent of the axis spines. */
const PanelBorderRows = ({ theme, set }: ThemeSectionProps) => {
	const b = panelBorderFromTheme(theme)
	return (
		<div className="flex flex-col gap-1.5">
			<Checkbox
				label="Draw panel border"
				checked={b.enabled}
				onChange={(v) => set("panelBorderEnabled", v)}
			/>
			{b.enabled && (
				<>
					<NumberInput
						label="Line width"
						value={b.width}
						onChange={(v) => set("panelBorderWidth", v)}
						min={0}
						max={20}
						step={0.5}
						suffix="px"
					/>
					<ColorInput
						label="Line color"
						value={b.color}
						onChange={(v) => set("panelBorderColor", v)}
					/>
				</>
			)}
		</div>
	)
}

export const GlobalAestheticsSection = (props: ThemeSectionProps) => {
	const { theme, set, isReadOnly } = props
	return (
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
			<Section title="Panel border">
				<PanelBorderRows {...props} />
			</Section>
		</SectionGroup>
	)
}
