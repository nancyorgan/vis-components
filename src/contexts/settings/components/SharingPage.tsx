import { useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { isEphemeralSeedId } from "../../chartBuilder/lib/exampleOverlay"
import { buildSeedBundle } from "../../chartBuilder/lib/exampleSeed"
import {
	LIBRARY_BUNDLE_FILENAME,
	mergeBundleIntoLibrary,
	parseLibraryBundle,
} from "../../chartBuilder/lib/libraryBundle"
import { loadUserDefaultThemeId } from "../../chartBuilder/lib/storage"
import { stringifyJsonDangerous } from "../../../lib/json"
import {
	datasetsAtom,
	foldersAtom,
	themesAtom,
	userDefaultThemeIdAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"

import { Button } from "../../../components/ui/Button"

const formatBytes = (n: number): string =>
	n >= 1024 * 1024
		? `${(n / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.max(1, Math.round(n / 1024))} KB`

const plural = (n: number, one: string, many = `${one}s`): string =>
	`${n} ${n === 1 ? one : many}`

/** Settings → Sharing: export the whole library as a JSON bundle (a backup,
 *  the file a colleague imports, AND the file that seeds a build's starter
 *  examples), and import someone else's bundle additively.
 *
 *  Import writes through the Jotai atoms rather than the storage functions:
 *  the library UI updates without a reload, and in server mode the diffing
 *  HTTP adapter turns each whole-collection save into per-item PUTs, so the
 *  imported work is backed up server-side too. */
export const SharingPage = () => {
	const [visuals, setVisuals] = useAtom(visualsAtom)
	const [datasets, setDatasets] = useAtom(datasetsAtom)
	const [folders, setFolders] = useAtom(foldersAtom)
	const [themes, setThemes] = useAtom(themesAtom)
	const setUserDefaultThemeId = useSetAtom(userDefaultThemeIdAtom)
	const currentUserDefaultThemeId = useAtomValue(userDefaultThemeIdAtom)
	const [status, setStatus] = useState<string | null>(null)
	const [exporting, setExporting] = useState(false)
	const [importStatus, setImportStatus] = useState<string | null>(null)
	const [importing, setImporting] = useState(false)
	const importInputRef = useRef<HTMLInputElement>(null)

	const onExport = async () => {
		if (exporting) return
		setExporting(true)
		setStatus(null)
		try {
			const bundle = await buildSeedBundle()
			const json = stringifyJsonDangerous(bundle as never)
			const blob = new Blob([json], { type: "application/json" })
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = LIBRARY_BUNDLE_FILENAME
			a.click()
			URL.revokeObjectURL(url)
			setStatus(
				`Exported ${plural(bundle.visuals.length, "visualization")} and ${plural(
					Object.keys(bundle.datasets).length,
					"data set"
				)} — ${formatBytes(json.length)}.`
			)
		} catch (error) {
			setStatus(
				`Export failed: ${error instanceof Error ? error.message : String(error)}`
			)
		} finally {
			setExporting(false)
		}
	}

	const onImport = async (file: File) => {
		if (importing) return
		setImporting(true)
		setImportStatus(null)
		try {
			const parsed = parseLibraryBundle(await file.text())
			if (!parsed.ok) {
				setImportStatus(`Import failed — ${parsed.error}. Nothing was changed.`)
				return
			}
			// The default-theme pointer is device-local in every mode, and is
			// adopted only when the user has never made a pick (mirroring the
			// example seed) — so the merge reads the RAW stored value, not the
			// atom, whose bootstrap substitutes system-light for "unset".
			const merged = mergeBundleIntoLibrary(parsed.bundle, {
				visuals,
				folders,
				datasets,
				themes,
				userDefaultThemeId: loadUserDefaultThemeId(),
			})
			// Folders and data sets first: the visuals write is what the library
			// renders from, so its targets should already exist.
			if (merged.added.folders > 0) setFolders(merged.folders)
			if (merged.added.datasets > 0) setDatasets(merged.datasets)
			if (merged.added.themes > 0) setThemes(merged.themes)
			if (merged.added.visuals > 0) setVisuals(merged.visuals)
			if (
				merged.userDefaultThemeId !== null &&
				merged.userDefaultThemeId !== currentUserDefaultThemeId
			) {
				setUserDefaultThemeId(merged.userDefaultThemeId)
			}
			const { added } = merged
			setImportStatus(
				`Imported ${plural(added.visuals, "visualization")} and ${plural(
					added.datasets,
					"data set"
				)}; created ${plural(added.folders, "folder")}${
					added.themes > 0 ? ` and ${plural(added.themes, "theme")}` : ""
				}.`
			)
		} catch (error) {
			setImportStatus(
				`Import failed: ${
					error instanceof Error ? error.message : String(error)
				}. Nothing was changed.`
			)
		} finally {
			setImporting(false)
		}
	}

	// Count what the export will actually contain: the user's own visuals
	// (buildSeedBundle strips the ephemeral example overlay — sandbox rows are
	// not the user's work) and the data sets some own visual references. The
	// store also holds orphans (uploads whose visuals were deleted or never
	// saved) that buildSeedBundle filters out.
	const ownVisuals = visuals.filter((v) => !isEphemeralSeedId(v.id))
	const datasetCount = new Set(
		ownVisuals
			.map((v) => v.datasetId)
			.filter((id) => id != null && id in datasets)
	).size

	return (
		<div className="mx-auto max-w-5xl px-8 py-8">
			<h1 className="mb-1 text-xl font-semibold text-stone-900 dark:text-white">
				Sharing
			</h1>
			<p className="mb-8 text-sm text-stone-600 dark:text-stone-400">
				Tools for backing up your library, handing it to someone else, and
				packaging this app as a single, self-contained HTML file.
			</p>

			<div className="mb-6 max-w-2xl rounded-lg border border-stone-200 p-5 dark:border-stone-700">
				<h2 className="mb-2 text-sm font-semibold text-stone-900 dark:text-white">
					Bundle your library as JSON
				</h2>
				<p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
					Downloads everything in your library — {ownVisuals.length}{" "}
					visualization
					{ownVisuals.length === 1 ? "" : "s"}, {datasetCount} data set
					{datasetCount === 1 ? "" : "s"}, previews, folders, and your custom
					themes — as a single{" "}
					<code className="text-xs">{LIBRARY_BUNDLE_FILENAME}</code> file. It is
					both a backup you can keep and an artifact you can share: a colleague
					imports it below and everything lands alongside their own work, with
					your folder structure preserved and nothing of theirs overwritten.
				</p>
				<p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
					The same file can seed a build&apos;s starter examples. Rename it to{" "}
					<code className="text-xs">src/seed/examples.local.json</code> in the
					repo (a gitignored override) — or{" "}
					<code className="text-xs">src/seed/examples.json</code> to publish it
					as the app&apos;s committed examples — and rebuild: everyone who opens
					that build for the first time starts with these already in their
					library.
				</p>
				<div className="flex items-center gap-3">
					<Button compact onClick={onExport} disabled={exporting}>
						{exporting ? "Exporting…" : "Download bundle"}
					</Button>
					{status && (
						<span className="text-sm text-stone-600 dark:text-stone-400">
							{status}
						</span>
					)}
				</div>
			</div>

			<div className="max-w-2xl rounded-lg border border-stone-200 p-5 dark:border-stone-700">
				<h2 className="mb-2 text-sm font-semibold text-stone-900 dark:text-white">
					Import a bundle
				</h2>
				<p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
					Adds the contents of a bundle file to this library. Imports are
					additive: your own visualizations, data, and themes are never replaced
					or overwritten. Folders are matched to yours by name — anything
					missing is created — and data sets identical to ones you already have
					are reused instead of stored twice.
				</p>
				<div className="flex items-center gap-3">
					<Button
						compact
						onClick={() => importInputRef.current?.click()}
						disabled={importing}
					>
						{importing ? "Importing…" : "Import bundle…"}
					</Button>
					{importStatus && (
						<span className="text-sm text-stone-600 dark:text-stone-400">
							{importStatus}
						</span>
					)}
				</div>
				<input
					ref={importInputRef}
					type="file"
					accept="application/json,.json"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0]
						e.target.value = ""
						if (file) void onImport(file)
					}}
				/>
			</div>
		</div>
	)
}
