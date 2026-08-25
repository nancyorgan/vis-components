import { useAtomValue } from "jotai"
import { useAtomCallback } from "jotai/utils"
import { useCallback, useState } from "react"
import { isManagedTheme, themeOf } from "../../lib/systemThemes"
import {
	configsFromTheme,
	dataLabelsConfigFromTheme,
	labelsFromTheme,
	legendConfigFromTheme,
} from "../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentThemeIdAtom,
	themeAtom,
	themesAtom,
	userDefaultThemeIdAtom,
} from "../../store/atoms"

import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { SelectInput } from "../../../../components/ui/SelectInput"

import { ManagedThemeGate } from "../ManagedThemeGate"

/** Per-visual theme picker. Picking a theme snapshots the saved theme's
 * values into the live editor atoms (theme, channelConfigs, labels,
 * legend) — the visual is "re-skinned" to match the chosen theme.
 *
 * The choice is saved alongside the visual via `currentThemeIdAtom` →
 * `Visual.themeId`, so subsequent loads of the same visual show the
 * dropdown selection. Editing the saved theme later does NOT silently
 * update the visual; the user has to re-pick to re-apply. */
export const ThemePanel = () => {
	const themes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const userDefaultThemeId = useAtomValue(userDefaultThemeIdAtom)
	const [gateOpen, setGateOpen] = useState(false)

	const applyTheme = useAtomCallback(
		useCallback(
			(_get, set, themeId: string) => {
				const saved = themes.find((t) => t.id === themeId)
				if (!saved) return
				const theme = themeOf(saved)
				// Snapshot values into the live editor — when the user moves on
				// from a chart and saves, these become part of the Visual.
				//
				// Preserve user customizations when switching themes (the user
				// reported "toggling themes wipes my titles, gradient
				// customizations, etc."). We update ONLY the fields the theme
				// actually drives — fonts/palettes/default colors — and leave
				// user-typed titles, alignments, per-category overrides, and
				// hue configurations intact. Switching back to a prior theme
				// then restores their customizations rather than starting
				// over.
				set(themeAtom, theme)
				set(currentChannelConfigsAtom, (prev) => {
					const fromTheme = configsFromTheme(theme)
					const mergedShape = prev.shape
						? {
								...prev.shape,
								outlineColor:
									fromTheme.shape?.outlineColor ?? prev.shape.outlineColor,
								outlineWidth:
									fromTheme.shape?.outlineWidth ?? prev.shape.outlineWidth,
							}
						: fromTheme.shape
					const mergedPattern = prev.pattern
						? {
								...prev.pattern,
								backgroundColor:
									fromTheme.pattern?.backgroundColor ??
									prev.pattern.backgroundColor,
							}
						: fromTheme.pattern
					const mergedText = prev.text
						? {
								...prev.text,
								color: fromTheme.text?.color ?? prev.text.color,
								palette: fromTheme.text?.palette ?? prev.text.palette,
							}
						: fromTheme.text
					return {
						...prev,
						// Theme-controlled defaults (overwritten).
						defaultFill: fromTheme.defaultFill,
						defaultRadius: fromTheme.defaultRadius,
						defaultOpacity: fromTheme.defaultOpacity,
						defaultShape: fromTheme.defaultShape,
						categoricalPaletteId: fromTheme.categoricalPaletteId,
						categoricalPalette: fromTheme.categoricalPalette,
						categoricalPalettePatternInks:
							fromTheme.categoricalPalettePatternInks,
						ordinalPaletteId: fromTheme.ordinalPaletteId,
						ordinalPalette: fromTheme.ordinalPalette,
						ordinalPalettePatternInks: fromTheme.ordinalPalettePatternInks,
						defaultGradientId: fromTheme.defaultGradientId,
						defaultGradientColors: fromTheme.defaultGradientColors,
						patternInkColor: fromTheme.patternInkColor,
						defaultPatternInk: fromTheme.defaultPatternInk,
						// Merge nested configs so user overrides survive.
						shape: mergedShape,
						pattern: mergedPattern,
						text: mergedText,
					}
				})
				set(currentLabelsAtom, (prev) => ({
					...prev,
					baseFont: labelsFromTheme(theme).baseFont,
				}))
				set(currentLegendConfigAtom, (prev) => {
					const fromTheme = legendConfigFromTheme(theme)
					// Legend layout (position, orientation, enabled, border)
					// is user-driven; only the theme-default background color
					// flows through on a theme switch.
					return {
						...prev,
						backgroundColor: fromTheme.backgroundColor,
					}
				})
				set(currentDataLabelsConfigAtom, (prev) => {
					const fromTheme = dataLabelsConfigFromTheme(theme)
					// Only the theme-driven font knobs (plus the single fallback
					// color and the map leader-line stroke) flow through; label
					// encodings, per-value color overrides, offsets, and templates
					// are user-driven.
					return {
						...prev,
						color: fromTheme.color,
						fontFamily: fromTheme.fontFamily,
						fontSize: fromTheme.fontSize,
						fontWeight: fromTheme.fontWeight,
						italic: fromTheme.italic,
						underline: fromTheme.underline,
						leaderLineColor: fromTheme.leaderLineColor,
						leaderLineWidth: fromTheme.leaderLineWidth,
					}
				})
				set(currentThemeIdAtom, themeId)
			},
			[themes]
		)
	)

	const setDefault = useAtomCallback(
		useCallback((_get, set, themeId: string) => {
			set(userDefaultThemeIdAtom, themeId)
		}, [])
	)

	const activeId = currentThemeId ?? userDefaultThemeId
	// The default theme seeds every new visualization on this server, so
	// only a managed theme can hold the slot — and claiming it goes through
	// the administrator dialog EVERY time, like every other reach for a
	// managed theme. (Settings → Themes has the matching toggle; the two
	// must agree.)
	const activeTheme = themes.find((t) => t.id === activeId)
	const canBecomeDefault =
		activeTheme !== undefined &&
		activeTheme.id !== userDefaultThemeId &&
		isManagedTheme(activeTheme)

	const themeOptions = themes.map((t) => ({
		value: t.id,
		label: `${t.name}${isManagedTheme(t) ? " (managed)" : ""}${
			t.id === userDefaultThemeId ? " ★" : ""
		}`,
	}))

	return (
		<CollapsibleSubsection title="Theme">
			<div className="flex flex-col gap-2">
				<SelectInput
					label="Theme"
					labelClassName="sr-only"
					value={activeId ?? ""}
					options={themeOptions}
					onChange={(id) => applyTheme(id)}
					selectClassName="flex-1"
				/>
				{canBecomeDefault && activeId && (
					<button
						type="button"
						onClick={() => setGateOpen(true)}
						className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
					>
						Make this the default theme
					</button>
				)}
				<ManagedThemeGate
					open={gateOpen}
					onCancel={() => setGateOpen(false)}
					onConfirm={() => {
						setGateOpen(false)
						if (activeId) setDefault(activeId)
					}}
				/>
				<p className="vc-help">
					Picking a theme re-themes this visualization with the theme&apos;s palette,
					fonts, and gridline colors. Edits to a saved theme <b>don&apos;t</b> retroactively
					update visualizations using it.
				</p>
			</div>
		</CollapsibleSubsection>
	)
}
