import { useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import {
	SYSTEM_LIGHT_THEME,
	themeOf,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme, Theme } from "../../chartBuilder/lib/types"
import {
	editingThemeIdAtom,
	themesAtom,
	userDefaultThemeIdAtom,
} from "../../chartBuilder/store/atoms"
import { stringifyJsonDangerous } from "../../../lib/json"

import { ConfirmDialog } from "../../../components/ui/Modal"

import { AestheticRangesSection } from "./themeSections/AestheticRangesSection"
import { AnnotationsSection } from "./themeSections/AnnotationsSection"
import { AxesSection } from "./themeSections/AxesSection"
import { DistributionRegressionSection } from "./themeSections/DistributionRegressionSection"
import { GlobalAestheticsSection } from "./themeSections/GlobalAestheticsSection"
import { GradientsSection } from "./themeSections/GradientsSection"
import { LegendSection } from "./themeSections/LegendSection"
import { MarkSection } from "./themeSections/MarkSection"
import { PalettesSection } from "./themeSections/PalettesSection"
import { PatternsSection } from "./themeSections/PatternsSection"
import { TextSection } from "./themeSections/TextSection"

export const ThemesPage = () => {
	const [themes, setThemes] = useAtom(themesAtom)
	const [editingThemeId, setEditingThemeId] = useAtom(editingThemeIdAtom)
	const [userDefaultId, setUserDefaultId] = useAtom(
		userDefaultThemeIdAtom
	)

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

	// Every editor group takes the same three props: the plain theme view, the
	// single-key setter, and the read-only flag that disables its fieldset.
	const sectionProps = { theme, set, isReadOnly }

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

				<div className="flex flex-col gap-4">
					<GlobalAestheticsSection {...sectionProps} />
					<MarkSection {...sectionProps} />
					<AxesSection {...sectionProps} />
					<LegendSection {...sectionProps} />
					<TextSection {...sectionProps} />
					<PalettesSection {...sectionProps} />
					<GradientsSection {...sectionProps} />
					<PatternsSection {...sectionProps} />
					<DistributionRegressionSection {...sectionProps} />
					<AnnotationsSection {...sectionProps} />
					<AestheticRangesSection {...sectionProps} />
				</div>

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
