import { ColorInput, Section, SectionGroup } from "./controls"
import { updateCategoricalPalette } from "./paletteHelpers"
import type { ThemeSectionProps } from "./types"

export const PatternsSection = ({
	theme,
	set,
	isReadOnly,
}: ThemeSectionProps) => (
	<SectionGroup title="Patterns" isReadOnly={isReadOnly}>
		{/* Pattern defaults */}
		<Section title="Pattern defaults">
			<p className="vc-text-muted text-sm">
				Background color is used when patterns sit on a mark with no hue
				mapping. Ink color is the default pattern stroke; per-palette
				overrides below let you pair a specific ink with each hue swatch.
			</p>
			<ColorInput
				label="Ink color"
				value={theme.patternInkColor}
				onChange={(v) => set("patternInkColor", v)}
			/>
			<ColorInput
				label="Background"
				value={theme.patternBackgroundColor}
				onChange={(v) => set("patternBackgroundColor", v)}
			/>
			{theme.categoricalPalettes.length > 0 && (
				<div className="mt-2 flex flex-col gap-3">
					<span className="vc-text-2 text-sm font-medium">
						Per-hue ink overrides
					</span>
					{theme.categoricalPalettes.map((palette) => (
						<div
							key={palette.id}
							className="vc-border rounded-md p-3"
						>
							<div className="vc-text-2 mb-2 text-sm font-medium">
								{palette.name}
							</div>
							<div className="flex flex-wrap gap-2">
								{palette.colors.map((color, i) => {
									const inkArray = palette.patternInks ?? []
									const ink = inkArray[i] ?? ""
									const setInk = (next: string | null) => {
										const updated = [...inkArray]
										while (updated.length < palette.colors.length) {
											updated.push(null)
										}
										updated[i] = next
										updateCategoricalPalette(theme, set, palette.id, {
											patternInks: updated,
										})
									}
									return (
										<div
											// eslint-disable-next-line react/no-array-index-key
											key={i}
											className="flex flex-col items-center gap-1"
										>
											<span
												className="vc-border-color-strong block h-6 w-10 rounded border"
												style={{ backgroundColor: color }}
												aria-label={`Hue swatch ${i + 1}`}
											/>
											<input
												type="color"
												value={ink || theme.patternInkColor}
												onChange={(e) => setInk(e.target.value)}
												aria-label={`Pattern ink for hue ${i + 1}`}
												className={`h-6 w-10 flex-shrink-0 cursor-pointer rounded border ${
													ink
														? "vc-settings-ink-override"
														: "vc-border-color-strong border-dashed"
												}`}
												title={
													ink
														? `Pattern ink paired with this hue`
														: `Using global ink — click to override`
												}
											/>
											{ink && (
												<button
													type="button"
													onClick={() => setInk(null)}
													className="vc-link-faint text-[10px] leading-none underline"
													title="Reset to global default"
												>
													reset
												</button>
											)}
										</div>
									)
								})}
							</div>
						</div>
					))}
				</div>
			)}
		</Section>
	</SectionGroup>
)
