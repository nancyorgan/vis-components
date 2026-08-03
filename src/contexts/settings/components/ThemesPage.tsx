import { useId, useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import type { PaletteName } from "../../chartBuilder/lib/channelConfig"
import { FONT_FAMILY_OPTIONS } from "../../chartBuilder/lib/labelsConfig"
import { SHAPE_PALETTE, symbolPath } from "../../chartBuilder/lib/scales"
import {
	SYSTEM_LIGHT_THEME,
	themeOf,
} from "../../chartBuilder/lib/systemThemes"
import type {
	SavedCategoricalPalette,
	SavedDivergingGradient,
	SavedLinearGradient,
	SavedTheme,
	Theme,
} from "../../chartBuilder/lib/types"
import {
	editingThemeIdAtom,
	themesAtom,
	userDefaultThemeIdAtom,
} from "../../chartBuilder/store/atoms"
import { stringifyJsonDangerous } from "../../../lib/json"

import { ColorInput as UiColorInput } from "../../../components/ui/ColorInput"
import { ConfirmDialog } from "../../../components/ui/Modal"
import { NumberInput as UiNumberInput } from "../../../components/ui/NumberInput"
import { SelectInput as UiSelectInput } from "../../../components/ui/SelectInput"

const PALETTE_NAMES: PaletteName[] = [
	"viridis",
	"plasma",
	"inferno",
	"magma",
	"blues",
	"BrBG",
	"PiYG",
	"PRGn",
	"PuOr",
	"RdBu",
	"RdYlBu",
	"Spectral",
]

const Section = ({
	title,
	children,
}: {
	title: string
	children: React.ReactNode
}) => (
	<div className="flex flex-col gap-3">
		<h3 className="text-sm font-semibold text-stone-900 dark:text-white">
			{title}
		</h3>
		<div className="flex flex-col gap-2">{children}</div>
	</div>
)

/** Fixed-width label column used by every settings row on this page so the
 *  controls line up vertically. Passed to the shared primitives via
 *  `labelClassName` (the established pattern for pinning width + color). */
const THEME_LABEL_CLASS = "w-32 text-stone-600 dark:text-stone-400"

/** Thin page-local wrappers around the shared UI primitives — they only
 *  pin the page's label column so the ~45 call sites below stay terse. */
const ColorInput = (props: {
	label: string
	value: string
	onChange: (v: string) => void
}) => <UiColorInput labelClassName={THEME_LABEL_CLASS} {...props} />

const NumberInput = (props: {
	label: string
	value: number
	onChange: (v: number) => void
	min: number
	max: number
	step: number
	suffix?: string
}) => <UiNumberInput labelClassName={THEME_LABEL_CLASS} {...props} />

const SelectInput = (props: {
	label: string
	value: string
	onChange: (v: string) => void
	options: Array<{ label: string; value: string }>
}) => (
	<UiSelectInput
		labelClassName={THEME_LABEL_CLASS}
		selectClassName="flex-1"
		{...props}
	/>
)

const ShapeGlyph = ({ idx, selected }: { idx: number; selected: boolean }) => (
	<svg width={20} height={20} viewBox="-10 -10 20 20" aria-hidden="true">
		<path d={symbolPath(idx, 6)} fill={selected ? "currentColor" : "#94a3b8"} />
	</svg>
)

export const ThemesPage = () => {
	const [themes, setThemes] = useAtom(themesAtom)
	const [editingThemeId, setEditingThemeId] = useAtom(editingThemeIdAtom)
	const [userDefaultId, setUserDefaultId] = useAtom(
		userDefaultThemeIdAtom
	)
	// Stable id linking the "Default text label palette" label to its select
	// (the label and control are separated by a description paragraph, so a
	// wrapping <label> would drag the prose into the accessible name).
	const textPaletteSelectId = useId()

	// Resolve the theme being edited. When no explicit selection exists
	// yet, prefer the first user-created theme — system themes are
	// read-only, so landing on one isn't useful. Falls back to a system
	// theme only when the user has no custom themes (and to
	// system-light if the id is stale, e.g. deleted externally).
	const editingTheme: SavedTheme = useMemo(
		() =>
			themes.find((t) => t.id === editingThemeId) ??
			themes.find((t) => !t.isSystem) ??
			themes[0] ??
			SYSTEM_LIGHT_THEME,
		[themes, editingThemeId]
	)
	const isReadOnly = editingTheme.isSystem
	// Plain Theme view (without the SavedTheme metadata) so the existing
	// section components can stay untouched.
	const theme = themeOf(editingTheme)

	const set = <K extends keyof Theme>(key: K, value: Theme[K]) => {
		if (isReadOnly) return
		setThemes((prev) =>
			prev.map((t) => (t.id === editingTheme.id ? { ...t, [key]: value } : t))
		)
	}

	const renameTheme = (name: string) => {
		if (isReadOnly) return
		setThemes((prev) =>
			prev.map((t) => (t.id === editingTheme.id ? { ...t, name } : t))
		)
	}

	// Modal state for the styled confirm dialogs (delete + replace-default).
	// Pending file for import override is staged so we can preview the name in
	// the confirm dialog before committing.
	const [deleteOpen, setDeleteOpen] = useState(false)
	const [pendingDefault, setPendingDefault] = useState(false)
	const [pendingImport, setPendingImport] = useState<File | null>(null)

	const requestDelete = () => {
		if (isReadOnly) return
		const remaining = themes.filter((t) => t.id !== editingTheme.id)
		if (remaining.length === 0) return
		setDeleteOpen(true)
	}
	const confirmDelete = () => {
		setDeleteOpen(false)
		const remaining = themes.filter((t) => t.id !== editingTheme.id)
		if (remaining.length === 0) return
		setThemes(remaining)
		setEditingThemeId(remaining[0]?.id ?? null)
		if (userDefaultId === editingTheme.id) {
			setUserDefaultId(SYSTEM_LIGHT_THEME.id)
		}
	}

	// --- "Make this the default theme" toggle ---
	const isDefault = editingTheme.id === userDefaultId
	const requestSetDefault = (next: boolean) => {
		if (!next) {
			// Toggling OFF means "no longer be the default" — fall back to
			// system-light, the safe pre-customization baseline.
			if (isDefault) setUserDefaultId(SYSTEM_LIGHT_THEME.id)
			return
		}
		// Toggling ON: if a different theme already holds the default slot,
		// confirm with the user before stealing it. The very first time
		// (default = system-light from a fresh install) we silently promote.
		if (userDefaultId && userDefaultId !== editingTheme.id) {
			setPendingDefault(true)
			return
		}
		setUserDefaultId(editingTheme.id)
	}
	const previousDefaultName = (() => {
		const t = themes.find((x) => x.id === userDefaultId)
		return t?.name ?? "the previous default"
	})()
	const confirmSetDefault = () => {
		setPendingDefault(false)
		setUserDefaultId(editingTheme.id)
	}

	// --- Single-theme JSON export / import ---
	// Single-theme exports keep the round-trip simple: one file = one theme.
	// The Add-theme dialog (in `SettingsLayout.tsx`) accepts both single-theme
	// shape and the older `{themes: [...]}` bundle for back-compat.
	const fileInputRef = useRef<HTMLInputElement>(null)

	const exportTheme = () => {
		const payload = {
			version: 1,
			exportedAt: new Date().toISOString(),
			theme: editingTheme,
		}
		const blob = new Blob([stringifyJsonDangerous(payload as never)], {
			type: "application/json",
		})
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		const safeName = (editingTheme.name || "theme")
			.toLowerCase()
			.replaceAll(/[^a-z0-9]+/g, "-")
			.replaceAll(/(^-|-$)/g, "")
		a.download = `vis-components-theme-${safeName || "export"}-${new Date().toISOString().slice(0, 10)}.json`
		document.body.append(a)
		a.click()
		a.remove()
		URL.revokeObjectURL(url)
	}

	const performImportOverride = async (file: File) => {
		try {
			const text = await file.text()
			const parsed = JSON.parse(text)
			// Accept both the new single-theme shape and the older bundle for
			// import-into-current. We take only the FIRST theme because the
			// current-theme slot can only hold one.
			const candidate: SavedTheme | undefined = ((): SavedTheme | undefined => {
				if (parsed?.theme) return parsed.theme
				if (Array.isArray(parsed?.themes)) return parsed.themes[0]
				if (parsed?.id) return parsed
				return undefined
			})()
			if (!candidate) {
				window.alert("That doesn't look like a theme export file.")
				return
			}
			// Override the current theme's content but keep its id, name, and
			// isSystem-status. System themes can't be imported into directly —
			// the toggle UI suppresses the button when read-only.
			setThemes((prev) =>
				prev.map((t) =>
					t.id === editingTheme.id
						? {
								...candidate,
								id: editingTheme.id,
								name: editingTheme.name,
								isSystem: false,
							}
						: t
				)
			)
		} catch (error) {
			window.alert(
				`Couldn't import theme: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}
	const confirmImport = async () => {
		const file = pendingImport
		setPendingImport(null)
		if (file) await performImportOverride(file)
	}

	// --- Categorical palette helpers ---
	const updateCatPalette = (
		id: string,
		patch: Partial<SavedCategoricalPalette>
	) =>
		set(
			"categoricalPalettes",
			theme.categoricalPalettes.map((p) =>
				p.id === id ? { ...p, ...patch } : p
			)
		)

	const addCatPalette = () => {
		const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("categoricalPalettes", [
			...theme.categoricalPalettes,
			{
				id,
				name: "New palette",
				colors: ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f"],
			},
		])
	}

	const deleteCatPalette = (id: string) => {
		const next = theme.categoricalPalettes.filter((p) => p.id !== id)
		if (next.length === 0) return
		set("categoricalPalettes", next)
		if (theme.defaultCategoricalPaletteId === id) {
			set("defaultCategoricalPaletteId", next[0].id)
		}
	}

	// --- Ordinal palette helpers (mirror the categorical helpers) ---
	const ordinalPalettes = theme.ordinalPalettes ?? []
	const updateOrdPalette = (
		id: string,
		patch: Partial<SavedCategoricalPalette>,
	) =>
		set(
			"ordinalPalettes",
			ordinalPalettes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
		)

	const addOrdPalette = () => {
		const id = `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("ordinalPalettes", [
			...ordinalPalettes,
			{
				id,
				name: "New ordinal palette",
				colors: ["#deebf7", "#9ecae1", "#4292c6", "#2171b5"],
			},
		])
	}

	const deleteOrdPalette = (id: string) => {
		const next = ordinalPalettes.filter((p) => p.id !== id)
		if (next.length === 0) return
		set("ordinalPalettes", next)
		if (theme.defaultOrdinalPaletteId === id) {
			set("defaultOrdinalPaletteId", next[0].id)
		}
	}

	// --- Linear gradient helpers ---
	const updateLinGradient = (id: string, patch: Partial<SavedLinearGradient>) =>
		set(
			"linearGradients",
			theme.linearGradients.map((g) => (g.id === id ? { ...g, ...patch } : g))
		)

	const addLinGradient = () => {
		const id = `lin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("linearGradients", [
			...theme.linearGradients,
			{ id, name: "New gradient", low: "#f7fbff", high: "#08306b" },
		])
	}

	const deleteLinGradient = (id: string) => {
		const next = theme.linearGradients.filter((g) => g.id !== id)
		set("linearGradients", next)
		if (theme.defaultGradientPalette === id) {
			set("defaultGradientPalette", "viridis")
		}
	}

	// --- Diverging gradient helpers ---
	const updateDivGradient = (
		id: string,
		patch: Partial<SavedDivergingGradient>
	) =>
		set(
			"divergingGradients",
			theme.divergingGradients.map((g) =>
				g.id === id ? { ...g, ...patch } : g
			)
		)

	const addDivGradient = () => {
		const id = `div-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		set("divergingGradients", [
			...theme.divergingGradients,
			{
				id,
				name: "New diverging",
				low: "#d73027",
				mid: "#ffffbf",
				high: "#1a9850",
			},
		])
	}

	const deleteDivGradient = (id: string) => {
		const next = theme.divergingGradients.filter((g) => g.id !== id)
		set("divergingGradients", next)
		if (theme.defaultGradientPalette === id) {
			set("defaultGradientPalette", "viridis")
		}
	}

	return (
		<div className="mx-auto max-w-5xl px-8 py-8">
			{/* Theme editor */}
			<div className="min-w-0">
				<div className="mb-6 flex items-start justify-between gap-4">
					<div className="min-w-0 flex-1">
						<input
							type="text"
							value={editingTheme.name}
							onChange={(e) => renameTheme(e.target.value)}
							disabled={isReadOnly}
							aria-label="Theme name"
							className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xl font-semibold text-stone-900 disabled:cursor-not-allowed disabled:opacity-70 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
						/>
						<p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
							{isReadOnly
								? "System themes are read-only. Add a new theme to customize."
								: "These values seed every new visualization that picks this theme."}
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<button
							type="button"
							onClick={exportTheme}
							className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
							title={`Download "${editingTheme.name}" as a JSON file`}
						>
							Export theme
						</button>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							disabled={isReadOnly}
							className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
							title="Replace this theme's settings with a JSON file"
						>
							Import theme…
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept="application/json,.json"
							aria-label="Import theme file"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0]
								e.target.value = ""
								if (file) setPendingImport(file)
							}}
						/>
					</div>
				</div>
				{/* Default-theme toggle. Wraps the requestSetDefault flow so a user
				 *  flipping it ON when ANOTHER theme already holds the default slot
				 *  sees the styled confirm dialog. Hidden on system themes since
				 *  they're already always available as defaults out of the box —
				 *  setting them as the user-default still works via this toggle. */}
				<label className="mb-6 flex items-center gap-2 rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900/50">
					<input
						type="checkbox"
						checked={isDefault}
						onChange={(e) => requestSetDefault(e.target.checked)}
					/>
					<span className="text-stone-700 dark:text-stone-300">
						Make this the default theme for all new visualizations?
					</span>
				</label>

				<fieldset
					disabled={isReadOnly}
					className="flex flex-col gap-8 disabled:opacity-70"
				>
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

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Fonts */}
					<Section title="Title fonts">
						<SelectInput
							label="Family"
							value={theme.titleFontFamily}
							onChange={(v) => set("titleFontFamily", v)}
							options={FONT_FAMILY_OPTIONS}
						/>
						<ColorInput
							label="Color"
							value={theme.titleFontColor}
							onChange={(v) => set("titleFontColor", v)}
						/>
						<NumberInput
							label="Title size"
							value={theme.titlePrimarySize}
							onChange={(v) => set("titlePrimarySize", v)}
							min={8}
							max={48}
							step={1}
							suffix="px"
						/>
						<NumberInput
							label="Subtitle size"
							value={theme.titleSubtitleSize}
							onChange={(v) => set("titleSubtitleSize", v)}
							min={8}
							max={36}
							step={1}
							suffix="px"
						/>
						<NumberInput
							label="Axis title size"
							value={theme.titleSecondarySize}
							onChange={(v) => set("titleSecondarySize", v)}
							min={8}
							max={36}
							step={1}
							suffix="px"
						/>
						<StyleToggleRow
							bold={theme.titleFontBold ?? false}
							italic={theme.titleFontItalic ?? false}
							underline={theme.titleFontUnderline ?? false}
							onBold={(v) => set("titleFontBold", v)}
							onItalic={(v) => set("titleFontItalic", v)}
							onUnderline={(v) => set("titleFontUnderline", v)}
						/>
					</Section>

					<Section title="Text fonts">
						<SelectInput
							label="Family"
							value={theme.textFontFamily}
							onChange={(v) => set("textFontFamily", v)}
							options={FONT_FAMILY_OPTIONS}
						/>
						<ColorInput
							label="Color"
							value={theme.textFontColor}
							onChange={(v) => set("textFontColor", v)}
						/>
						<NumberInput
							label="Size"
							value={theme.textFontSize}
							onChange={(v) => set("textFontSize", v)}
							min={8}
							max={24}
							step={1}
							suffix="px"
						/>
						<StyleToggleRow
							bold={theme.textFontBold ?? false}
							italic={theme.textFontItalic ?? false}
							underline={theme.textFontUnderline ?? false}
							onBold={(v) => set("textFontBold", v)}
							onItalic={(v) => set("textFontItalic", v)}
							onUnderline={(v) => set("textFontUnderline", v)}
						/>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Categorical palettes */}
					<Section title="Categorical palettes">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Named color palettes assigned to categories when hue is mapped to
							a categorical field. Mark one as the default for new
							visualizations.
						</p>
						{theme.categoricalPalettes.map((palette) => {
							const isDefault = palette.id === theme.defaultCategoricalPaletteId
							return (
								<div
									key={palette.id}
									className="flex flex-col gap-1.5 rounded-lg border border-stone-200 p-3 dark:border-stone-700"
								>
									<div className="flex items-center gap-2">
										<button
											type="button"
											title={isDefault ? "Default palette" : "Set as default"}
											aria-label={
												isDefault ? "Default palette" : "Set as default"
											}
											aria-pressed={isDefault}
											onClick={() =>
												set("defaultCategoricalPaletteId", palette.id)
											}
											className={`text-lg leading-none ${isDefault ? "text-amber-500" : "text-stone-300 hover:text-amber-400 dark:text-stone-600"}`}
										>
											{isDefault ? "\u2605" : "\u2606"}
										</button>
										<input
											type="text"
											value={palette.name}
											aria-label="Palette name"
											onChange={(e) =>
												updateCatPalette(palette.id, {
													name: e.target.value,
												})
											}
											className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
										/>
										<button
											type="button"
											disabled={theme.categoricalPalettes.length <= 1}
											onClick={() => deleteCatPalette(palette.id)}
											className="ml-auto text-sm text-stone-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:text-red-400"
										>
											Delete
										</button>
									</div>
									<div className="flex flex-wrap gap-1">
										{palette.colors.map((color, i) => (
											<UiColorInput
												// eslint-disable-next-line react/no-array-index-key
												key={i}
												label={`Hue ${i + 1}`}
												labelClassName="sr-only"
												showHexInput={false}
												value={color}
												onChange={(hex) => {
													const next = [...palette.colors]
													next[i] = hex
													updateCatPalette(palette.id, { colors: next })
												}}
											/>
										))}
										<button
											type="button"
											onClick={() => {
												const colors = [...palette.colors, "#888888"]
												const inks = palette.patternInks
													? [...palette.patternInks, null]
													: undefined
												updateCatPalette(palette.id, {
													colors,
													...(inks ? { patternInks: inks } : {}),
												})
											}}
											className="flex h-6 w-10 items-center justify-center self-start rounded border border-dashed border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600 dark:border-stone-700"
											title="Add color"
											aria-label="Add color"
										>
											+
										</button>
									</div>
									{palette.colors.length > 2 && (
										<button
											type="button"
											onClick={() => {
												const colors = palette.colors.slice(0, -1)
												const inks = palette.patternInks?.slice(0, -1)
												updateCatPalette(palette.id, {
													colors,
													...(inks ? { patternInks: inks } : {}),
												})
											}}
											className="self-start text-sm text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-white"
										>
											Remove last color
										</button>
									)}
								</div>
							)
						})}
						<button
							type="button"
							onClick={addCatPalette}
							className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						>
							Add palette
						</button>
						<div className="flex flex-col gap-1 border-t border-stone-200 pt-3 dark:border-stone-700">
							<label
								htmlFor={textPaletteSelectId}
								className="text-sm font-medium text-stone-700 dark:text-stone-300"
							>
								Default text label palette
							</label>
							<p className="text-xs text-stone-500 dark:text-stone-400">
								Used to color text-encoded labels per category — pick a palette
								of darker shades to pair with your default categorical palette.
							</p>
							<select
								id={textPaletteSelectId}
								value={theme.defaultTextPaletteId ?? "__none__"}
								onChange={(e) =>
									set(
										"defaultTextPaletteId",
										e.target.value === "__none__" ? null : e.target.value
									)
								}
								className="self-start rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
							>
								<option value="__none__">
									No palette (single fallback color)
								</option>
								{theme.categoricalPalettes.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</div>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Ordinal palettes — separate from categorical so themes can
					 *  supply sequential (lighter→darker) ramps for ordered
					 *  discrete fields. See spec §4.1 / §12. */}
					<Section title="Ordinal palettes">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Discrete palettes used when hue is mapped to an ordinal field.
							Use these for ordered categories (e.g., &quot;low / medium / high&quot;)
							where a sequential ramp reads as ordered, instead of the
							arbitrary colors a categorical palette uses.
						</p>
						{ordinalPalettes.map((palette) => {
							const isDefault = palette.id === theme.defaultOrdinalPaletteId
							return (
								<div
									key={palette.id}
									className="flex flex-col gap-1.5 rounded-lg border border-stone-200 p-3 dark:border-stone-700"
								>
									<div className="flex items-center gap-2">
										<button
											type="button"
											title={isDefault ? "Default palette" : "Set as default"}
											aria-label={
												isDefault ? "Default palette" : "Set as default"
											}
											aria-pressed={isDefault}
											onClick={() => set("defaultOrdinalPaletteId", palette.id)}
											className={`text-lg leading-none ${isDefault ? "text-amber-500" : "text-stone-300 hover:text-amber-400 dark:text-stone-600"}`}
										>
											{isDefault ? "★" : "☆"}
										</button>
										<input
											type="text"
											value={palette.name}
											aria-label="Palette name"
											onChange={(e) =>
												updateOrdPalette(palette.id, { name: e.target.value })
											}
											className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
										/>
										<button
											type="button"
											disabled={ordinalPalettes.length <= 1}
											onClick={() => deleteOrdPalette(palette.id)}
											className="ml-auto text-sm text-stone-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:text-red-400"
										>
											Delete
										</button>
									</div>
									<div className="flex flex-wrap gap-1">
										{palette.colors.map((color, i) => (
											<UiColorInput
												// eslint-disable-next-line react/no-array-index-key
												key={i}
												label={`Step ${i + 1}`}
												labelClassName="sr-only"
												showHexInput={false}
												value={color}
												onChange={(hex) => {
													const next = [...palette.colors]
													next[i] = hex
													updateOrdPalette(palette.id, { colors: next })
												}}
											/>
										))}
										<button
											type="button"
											onClick={() => {
												const colors = [...palette.colors, "#888888"]
												const inks = palette.patternInks
													? [...palette.patternInks, null]
													: undefined
												updateOrdPalette(palette.id, {
													colors,
													...(inks ? { patternInks: inks } : {}),
												})
											}}
											className="flex h-6 w-10 items-center justify-center self-start rounded border border-dashed border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600 dark:border-stone-700"
											title="Add color"
											aria-label="Add color"
										>
											+
										</button>
									</div>
									{palette.colors.length > 2 && (
										<button
											type="button"
											onClick={() => {
												const colors = palette.colors.slice(0, -1)
												const inks = palette.patternInks?.slice(0, -1)
												updateOrdPalette(palette.id, {
													colors,
													...(inks ? { patternInks: inks } : {}),
												})
											}}
											className="self-start text-sm text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-white"
										>
											Remove last color
										</button>
									)}
								</div>
							)
						})}
						<button
							type="button"
							onClick={addOrdPalette}
							className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						>
							Add ordinal palette
						</button>
					</Section>

					{/* Gradients (umbrella) — visually separates gradient configs
					 *  from the categorical-palette section above. */}
					<hr className="border-stone-200 dark:border-stone-700" />
					<h2 className="text-base font-semibold text-stone-900 dark:text-white">
						Gradients
					</h2>
					<Section title="Default gradient">
						<SelectInput
							label="Default"
							value={theme.defaultGradientPalette}
							onChange={(v) => set("defaultGradientPalette", v)}
							options={[
								...PALETTE_NAMES.map((n) => ({
									label: n,
									value: n,
								})),
								...theme.linearGradients.map((g) => ({
									label: `${g.name} (linear)`,
									value: g.id,
								})),
								...theme.divergingGradients.map((g) => ({
									label: `${g.name} (diverging)`,
									value: g.id,
								})),
							]}
						/>
					</Section>

					{/* Linear gradients */}
					<Section title="Linear gradients">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Two-stop gradients for quantitative fields.
						</p>
						{theme.linearGradients.map((gradient) => {
							const isDefault = gradient.id === theme.defaultGradientPalette
							return (
								<div
									key={gradient.id}
									className="flex flex-col gap-1.5 rounded-lg border border-stone-200 p-3 dark:border-stone-700"
								>
									<div className="flex items-center gap-2">
										<button
											type="button"
											title={
												isDefault
													? "Default gradient"
													: "Set as default gradient"
											}
											aria-label={
												isDefault
													? "Default gradient"
													: "Set as default gradient"
											}
											aria-pressed={isDefault}
											onClick={() => set("defaultGradientPalette", gradient.id)}
											className={`text-lg leading-none ${isDefault ? "text-amber-500" : "text-stone-300 hover:text-amber-400 dark:text-stone-600"}`}
										>
											{isDefault ? "\u2605" : "\u2606"}
										</button>
										<input
											type="text"
											value={gradient.name}
											aria-label="Gradient name"
											onChange={(e) =>
												updateLinGradient(gradient.id, {
													name: e.target.value,
												})
											}
											className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
										/>
										<button
											type="button"
											onClick={() => deleteLinGradient(gradient.id)}
											className="ml-auto text-sm text-stone-500 hover:text-red-600 dark:text-stone-400 dark:hover:text-red-400"
										>
											Delete
										</button>
									</div>
									<div
										className="h-6 w-full rounded"
										style={{
											background: `linear-gradient(to right, ${gradient.low}, ${gradient.high})`,
										}}
									/>
									<div className="flex justify-between">
										<label className="flex flex-col items-center gap-0.5">
											<input
												type="color"
												value={gradient.low}
												onChange={(e) =>
													updateLinGradient(gradient.id, {
														low: e.target.value,
													})
												}
												className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
											/>
											<span className="text-sm text-stone-600 dark:text-stone-400">
												Low
											</span>
										</label>
										<label className="flex flex-col items-center gap-0.5">
											<input
												type="color"
												value={gradient.high}
												onChange={(e) =>
													updateLinGradient(gradient.id, {
														high: e.target.value,
													})
												}
												className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
											/>
											<span className="text-sm text-stone-600 dark:text-stone-400">
												High
											</span>
										</label>
									</div>
								</div>
							)
						})}
						<button
							type="button"
							onClick={addLinGradient}
							className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						>
							Add gradient
						</button>
					</Section>

					{/* Diverging gradients */}
					<Section title="Diverging gradients">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Three-stop gradients for data with a meaningful midpoint.
						</p>
						{theme.divergingGradients.map((gradient) => {
							const isDefault = gradient.id === theme.defaultGradientPalette
							return (
								<div
									key={gradient.id}
									className="flex flex-col gap-1.5 rounded-lg border border-stone-200 p-3 dark:border-stone-700"
								>
									<div className="flex items-center gap-2">
										<button
											type="button"
											title={
												isDefault
													? "Default gradient"
													: "Set as default gradient"
											}
											aria-label={
												isDefault
													? "Default gradient"
													: "Set as default gradient"
											}
											aria-pressed={isDefault}
											onClick={() => set("defaultGradientPalette", gradient.id)}
											className={`text-lg leading-none ${isDefault ? "text-amber-500" : "text-stone-300 hover:text-amber-400 dark:text-stone-600"}`}
										>
											{isDefault ? "\u2605" : "\u2606"}
										</button>
										<input
											type="text"
											value={gradient.name}
											aria-label="Gradient name"
											onChange={(e) =>
												updateDivGradient(gradient.id, {
													name: e.target.value,
												})
											}
											className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
										/>
										<button
											type="button"
											onClick={() => deleteDivGradient(gradient.id)}
											className="ml-auto text-sm text-stone-500 hover:text-red-600 dark:text-stone-400 dark:hover:text-red-400"
										>
											Delete
										</button>
									</div>
									<div
										className="h-6 w-full rounded"
										style={{
											background: `linear-gradient(to right, ${gradient.low}, ${gradient.mid}, ${gradient.high})`,
										}}
									/>
									<div className="flex justify-between">
										<label className="flex flex-col items-center gap-0.5">
											<input
												type="color"
												value={gradient.low}
												onChange={(e) =>
													updateDivGradient(gradient.id, {
														low: e.target.value,
													})
												}
												className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
											/>
											<span className="text-sm text-stone-600 dark:text-stone-400">
												Low
											</span>
										</label>
										<label className="flex flex-col items-center gap-0.5">
											<input
												type="color"
												value={gradient.mid}
												onChange={(e) =>
													updateDivGradient(gradient.id, {
														mid: e.target.value,
													})
												}
												className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
											/>
											<span className="text-sm text-stone-600 dark:text-stone-400">
												Mid
											</span>
										</label>
										<label className="flex flex-col items-center gap-0.5">
											<input
												type="color"
												value={gradient.high}
												onChange={(e) =>
													updateDivGradient(gradient.id, {
														high: e.target.value,
													})
												}
												className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
											/>
											<span className="text-sm text-stone-600 dark:text-stone-400">
												High
											</span>
										</label>
									</div>
								</div>
							)
						})}
						<button
							type="button"
							onClick={addDivGradient}
							className="self-start rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
						>
							Add gradient
						</button>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

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
													updateCatPalette(palette.id, {
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

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Text encoding defaults */}
					<Section title="Text encoding defaults">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Initial font and color used when a user maps the text channel.
						</p>
						<ColorInput
							label="Color"
							value={theme.textEncodingColor}
							onChange={(v) => set("textEncodingColor", v)}
						/>
						<NumberInput
							label="Font size"
							value={theme.textEncodingFontSize}
							onChange={(v) => set("textEncodingFontSize", v)}
							min={6}
							max={48}
							step={1}
							suffix="px"
						/>
						<label className="flex items-center gap-2 text-sm">
							<span className="w-32 text-stone-600 dark:text-stone-400">
								Font weight
							</span>
							<select
								value={theme.textEncodingFontWeight}
								onChange={(e) =>
									set(
										"textEncodingFontWeight",
										Number(e.target.value) as 400 | 500 | 600 | 700
									)
								}
								className="rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
							>
								{[400, 500, 600, 700].map((w) => (
									<option key={w} value={w}>
										{w}
									</option>
								))}
							</select>
						</label>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Distribution overlay defaults */}
					<Section title="Distribution overlay defaults">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Stroke and fill used by violin and box-plot overlays when first
							enabled on a chart&apos;s value axis.
						</p>
						<ColorInput
							label="Stroke"
							value={theme.distributionOverlayStroke}
							onChange={(v) => set("distributionOverlayStroke", v)}
						/>
						<ColorInput
							label="Fill"
							value={theme.distributionOverlayFill}
							onChange={(v) => set("distributionOverlayFill", v)}
						/>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Regression overlay defaults */}
					<Section title="Regression line defaults">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Line stroke and confidence-band fill used by the scatter
							regression line when first enabled.
						</p>
						<ColorInput
							label="Line"
							value={theme.regressionStroke}
							onChange={(v) => set("regressionStroke", v)}
						/>
						<ColorInput
							label="Band fill"
							value={theme.regressionCiFill}
							onChange={(v) => set("regressionCiFill", v)}
						/>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

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
							min={0.5}
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

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Aesthetic-channel range defaults */}
					<Section title="Aesthetic range defaults">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Min and max bounds used when each aesthetic channel is first
							mapped.
						</p>
						<div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
							<NumberInput
								label="Length min"
								value={theme.lengthMin}
								onChange={(v) => set("lengthMin", v)}
								min={0}
								max={1000}
								step={1}
								suffix="px"
							/>
							<NumberInput
								label="Length max"
								value={theme.lengthMax}
								onChange={(v) => set("lengthMax", v)}
								min={0}
								max={1000}
								step={1}
								suffix="px"
							/>
							<NumberInput
								label="Angle min"
								value={theme.angleMin}
								onChange={(v) => set("angleMin", v)}
								min={-360}
								max={360}
								step={1}
								suffix="°"
							/>
							<NumberInput
								label="Angle max"
								value={theme.angleMax}
								onChange={(v) => set("angleMax", v)}
								min={-360}
								max={360}
								step={1}
								suffix="°"
							/>
							<NumberInput
								label="Area min"
								value={theme.areaMin}
								onChange={(v) => set("areaMin", v)}
								min={0}
								max={200}
								step={1}
								suffix="px"
							/>
							<NumberInput
								label="Area max"
								value={theme.areaMax}
								onChange={(v) => set("areaMax", v)}
								min={0}
								max={200}
								step={1}
								suffix="px"
							/>
							<NumberInput
								label="Saturation min"
								value={theme.saturationMin}
								onChange={(v) => set("saturationMin", v)}
								min={0}
								max={1}
								step={0.05}
							/>
							<NumberInput
								label="Saturation max"
								value={theme.saturationMax}
								onChange={(v) => set("saturationMax", v)}
								min={0}
								max={1}
								step={0.05}
							/>
							<NumberInput
								label="Brightness min"
								value={theme.brightnessMin}
								onChange={(v) => set("brightnessMin", v)}
								min={0}
								max={1}
								step={0.05}
							/>
							<NumberInput
								label="Brightness max"
								value={theme.brightnessMax}
								onChange={(v) => set("brightnessMax", v)}
								min={0}
								max={1}
								step={0.05}
							/>
						</div>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Gridlines — separate per-axis defaults. Each falls back to
					 * the legacy shared `gridlineColor` / `gridlineThickness` when
					 * the per-axis value hasn't been set yet, so unchanged themes
					 * keep their previous look. */}
					<Section title="X gridline defaults">
						<ColorInput
							label="Color"
							value={theme.xGridlineColor ?? theme.gridlineColor}
							onChange={(v) => set("xGridlineColor", v)}
						/>
						<NumberInput
							label="Thickness"
							value={theme.xGridlineThickness ?? theme.gridlineThickness}
							onChange={(v) => set("xGridlineThickness", v)}
							min={0.5}
							max={5}
							step={0.5}
							suffix="px"
						/>
					</Section>

					<Section title="Y gridline defaults">
						<ColorInput
							label="Color"
							value={theme.yGridlineColor ?? theme.gridlineColor}
							onChange={(v) => set("yGridlineColor", v)}
						/>
						<NumberInput
							label="Thickness"
							value={theme.yGridlineThickness ?? theme.gridlineThickness}
							onChange={(v) => set("yGridlineThickness", v)}
							min={0.5}
							max={5}
							step={0.5}
							suffix="px"
						/>
					</Section>

					<Section title="R gridline defaults">
						<ColorInput
							label="Color"
							value={theme.rGridlineColor ?? theme.gridlineColor}
							onChange={(v) => set("rGridlineColor", v)}
						/>
						<NumberInput
							label="Thickness"
							value={theme.rGridlineThickness ?? theme.gridlineThickness}
							onChange={(v) => set("rGridlineThickness", v)}
							min={0.5}
							max={5}
							step={0.5}
							suffix="px"
						/>
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Concentric rings on radar charts. By default, one gridline is
							drawn per labeled axis tick; adjust the count per-visualization
							from the X, Y, or R axis panel.
						</p>
					</Section>

					{/* Tick marks */}
					<Section title="Tick mark defaults">
						<ColorInput
							label="Color"
							value={theme.tickmarkColor}
							onChange={(v) => set("tickmarkColor", v)}
						/>
						<NumberInput
							label="Thickness"
							value={theme.tickmarkThickness}
							onChange={(v) => set("tickmarkThickness", v)}
							min={0.5}
							max={5}
							step={0.5}
							suffix="px"
						/>
						<NumberInput
							label="Length"
							value={theme.tickmarkLength}
							onChange={(v) => set("tickmarkLength", v)}
							min={0}
							max={20}
							step={1}
							suffix="px"
						/>
					</Section>

					<hr className="border-stone-200 dark:border-stone-700" />

					{/* Axis spine */}
					<Section title="Axis spine defaults">
						<ColorInput
							label="Color"
							value={theme.spineColor}
							onChange={(v) => set("spineColor", v)}
						/>
						<NumberInput
							label="Thickness"
							value={theme.spineThickness}
							onChange={(v) => set("spineThickness", v)}
							min={0}
							max={5}
							step={0.5}
							suffix="px"
						/>
					</Section>
				</fieldset>

				{/* Delete sits at the bottom — destructive actions live below the
				 *  thing they destroy, not in the header where they're easy to
				 *  hit by accident. Suppressed for system themes since those
				 *  ship with the app and can't be removed. */}
				{!isReadOnly && (
					<div className="mt-10 flex justify-end border-t border-stone-200 pt-4 dark:border-stone-700">
						<button
							type="button"
							onClick={requestDelete}
							className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-stone-900 dark:text-red-400 dark:hover:bg-red-900/20"
						>
							Delete this theme
						</button>
					</div>
				)}
			</div>
			<ConfirmDialog
				open={deleteOpen}
				title="Delete this theme?"
				message={
					<>
						Delete the theme{" "}
						<span className="font-medium text-stone-900 dark:text-white">
							&ldquo;{editingTheme.name}&rdquo;
						</span>
						? This cannot be undone.
					</>
				}
				confirmLabel="Delete theme"
				destructive
				onCancel={() => setDeleteOpen(false)}
				onConfirm={confirmDelete}
			/>
			<ConfirmDialog
				open={pendingDefault}
				title="Replace the default theme?"
				message={
					<>
						This theme will replace{" "}
						<span className="font-medium text-stone-900 dark:text-white">
							&ldquo;{previousDefaultName}&rdquo;
						</span>{" "}
						as the default for all new visualizations. Continue?
					</>
				}
				confirmLabel="Make default"
				onCancel={() => setPendingDefault(false)}
				onConfirm={confirmSetDefault}
			/>
			<ConfirmDialog
				open={pendingImport !== null}
				title="Replace this theme?"
				message={
					<>
						Importing will overwrite the contents of{" "}
						<span className="font-medium text-stone-900 dark:text-white">
							&ldquo;{editingTheme.name}&rdquo;
						</span>
						. The theme&rsquo;s name stays the same. To import as a new theme
						instead, cancel and use <strong>+ Add a new theme</strong>.
					</>
				}
				confirmLabel="Replace theme"
				destructive
				onCancel={() => setPendingImport(null)}
				onConfirm={() => void confirmImport()}
			/>
		</div>
	)
}

/** Three-button B/I/U toggle row used inside the Title fonts + Text
 * fonts sections. Mirrors the styling of the per-label override toggle
 * in LabelsPanel so the chart-edit and theme-edit surfaces feel like
 * the same control. */
const StyleToggleRow = ({
	bold,
	italic,
	underline,
	onBold,
	onItalic,
	onUnderline,
}: {
	bold: boolean
	italic: boolean
	underline: boolean
	onBold: (v: boolean) => void
	onItalic: (v: boolean) => void
	onUnderline: (v: boolean) => void
}) => {
	const Btn = ({
		on,
		label,
		className,
		ariaLabel,
		onClick,
	}: {
		on: boolean
		label: string
		className: string
		ariaLabel: string
		onClick: () => void
	}) => (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			aria-pressed={on}
			className={`h-7 w-7 rounded border text-sm ${className} ${
				on
					? "border-stone-700 bg-stone-200 text-stone-900 dark:border-stone-300 dark:bg-stone-700 dark:text-white"
					: "border-stone-300 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
			}`}
		>
			{label}
		</button>
	)
	return (
		<div className="flex items-center gap-1.5">
			<span className="w-16 text-sm text-stone-600 dark:text-stone-400">
				Style
			</span>
			<Btn
				on={bold}
				label="B"
				className="font-bold"
				ariaLabel="Bold"
				onClick={() => onBold(!bold)}
			/>
			<Btn
				on={italic}
				label="I"
				className="italic"
				ariaLabel="Italic"
				onClick={() => onItalic(!italic)}
			/>
			<Btn
				on={underline}
				label="U"
				className="underline"
				ariaLabel="Underline"
				onClick={() => onUnderline(!underline)}
			/>
		</div>
	)
}
