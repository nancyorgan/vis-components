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
			<p className="text-sm text-stone-600 dark:text-stone-400">
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
					<span className="text-sm font-medium text-stone-700 dark:text-stone-300">
						Per-hue ink overrides
					</span>
					{theme.categoricalPalettes.map((palette) => (
						<div
							key={palette.id}
							className="rounded-md border border-stone-200 p-3 dark:border-stone-700"
						>
							<div className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">
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
												className="block h-6 w-10 rounded border border-stone-300 dark:border-stone-700"
												style={{ backgroundColor: color }}
												aria-label={`Hue swatch ${i + 1}`}
											/>
											<input
												type="color"
												value={ink || theme.patternInkColor}
												onChange={(e) => setInk(e.target.value)}
												aria-label={`Pattern ink for hue ${i + 1}`}
												className={`h-6 w-10 cursor-pointer rounded border ${
													ink
														? "border-stone-400 dark:border-stone-500"
														: "border-dashed border-stone-300 dark:border-stone-700"
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
													className="text-[10px] leading-none text-stone-500 underline hover:text-stone-700 dark:text-stone-400 dark:hover:text-white"
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
