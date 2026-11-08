import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { describeAddedColumns, describeDiff } from "../../lib/datasetCompat"
import { findDuplicateByHash, withFreshContentHash } from "../../lib/datasetDedupe"
import { downloadDatasetCsv } from "../../lib/downloadDataset"
import { nameCollides } from "../../lib/nameUniqueness"
import {
	describeReplayApplied,
	describeReplaySkipped,
	previewImport,
} from "../../lib/versionReplay"
import {
	currentDatasetIdAtom,
	currentVisualNameAtom,
	datasetIndexAtom,
	mutateDatasetBodyAtom,
	pendingUploadAtom,
	uploadNoticeAtom,
} from "../../store/atoms"
import { useAppendImportVersion } from "../../store/appendImportVersion"
import { useResetVisual, useSaveVisual } from "../../store/saveVisual"
import {
	useCreateNewDataset,
	useHandleCsvUpload,
} from "../../store/useCreateNewDataset"
import {
	currentRawDatasetViewAtom,
	useCurrentDatasetView,
} from "../../store/useCurrentDatasetView"

import { Button } from "../../../../components/ui/Button"
import { Input } from "../../../../components/ui/Input"
import { Modal } from "../../../../components/ui/Modal"

type Mode = "addVersion" | "newVisualization"

export const DataUpload = () => {
	const inputRef = useRef<HTMLInputElement>(null)
	const currentDataset = useCurrentDatasetView()
	// The download hands back the RAW version — cells as imported, no
	// conversions and no per-visual reshape / derived columns — so it
	// re-uploads cleanly. An imported version (no `editedFrom`) may keep
	// its own file name; an edited or computed one is named after the set.
	const rawDataset = useAtomValue(currentRawDatasetViewAtom)
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const rawImported =
		rawDataset !== undefined &&
		datasetIndex[rawDataset.id]?.versions.find(
			(v) => v.id === rawDataset.versionId
		)?.editedFrom === undefined
	const [error, setError] = useState<string | null>(null)
	// The cost note goes to a root-level modal, not to local state: the
	// new-visualization path navigates and would remount this away.
	const setUploadNotice = useSetAtom(uploadNoticeAtom)
	const handleCsvUpload = useHandleCsvUpload()

	return (
		<div className="flex flex-col gap-2">
			<Button
				compact
				onClick={() => inputRef.current?.click()}
				className="w-full"
				data-tip="upload-data"
			>
				{currentDataset ? "Upload data…" : "Upload CSV…"}
			</Button>
			<input
				ref={inputRef}
				type="file"
				accept=".csv,text/csv"
				className="hidden"
				onChange={async (e) => {
					const file = e.target.files?.[0]
					e.target.value = ""
					if (!file) return
					setError(null)
					setUploadNotice(null)
					const result = await handleCsvUpload(file)
					if (!result.ok) setError(result.error)
					else if (result.warning) setUploadNotice(result.warning)
				}}
			/>
			{currentDataset && (
				<div className="text-sm vc-muted">
					<DatasetNameEditor id={currentDataset.id} name={currentDataset.name} />
					<div>
						{currentDataset.rows.length} row
						{currentDataset.rows.length === 1 ? "" : "s"} ·{" "}
						{currentDataset.fields.length} field
						{currentDataset.fields.length === 1 ? "" : "s"} ·{" "}
						{currentDataset.totalVersions === 1
							? "v1"
							: `v${currentDataset.versionIndex} of ${currentDataset.totalVersions}`}
						{rawDataset && (
							<>
								{" "}
								·{" "}
								<button
									type="button"
									onClick={() =>
										void downloadDatasetCsv(rawDataset, {
											imported: rawImported,
										})
									}
									className="py-0.5 text-brand-500 underline hover:text-brand-600 dark:text-indigo-400"
								>
									download data
								</button>
							</>
						)}
					</div>
				</div>
			)}
			{error && (
				<div
					role="alert"
					className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300"
				>
					{error}
				</div>
			)}
			{/* Shared upload-prompt modal — opens whenever `pendingUploadAtom` is
			 *  set by the Upload button above or the drawer drop handler. Only
			 *  populated when a Visual is already open; first-time uploads on
			 *  /editor/new skip the modal and create directly. */}
			<UploadPromptModal />
		</div>
	)
}

/** Click-to-edit rename control for the bound data set — the same hover-
 *  pencil affordance the Fields panel gives a column. Enter/blur commits,
 *  Escape cancels, and an emptied box cancels too (a data set always has a
 *  name). Same-named data sets are allowed — the id is the identity — so a
 *  name another data set already carries only warns while typing. The rename
 *  goes through `mutateDatasetBodyAtom` (which loads the body first when this
 *  session only holds the lazy per-version rows) and refreshes the content
 *  hash, which covers the name: a stale hash would make the next upload of
 *  this file under its new name miss the reuse hint. The index derives from
 *  the loaded body, so the library table/grid and the version badge pick the
 *  new name up without any further write. */
const DatasetNameEditor = ({ id, name }: { id: string; name: string }) => {
	const mutateDatasetBody = useSetAtom(mutateDatasetBodyAtom)
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(name)
	const [error, setError] = useState<string | null>(null)
	const noteId = useId()
	const collides =
		editing && nameCollides(draft, Object.values(datasetIndex), id)

	const startEditing = () => {
		setDraft(name)
		setError(null)
		setEditing(true)
	}

	const cancel = () => {
		setDraft(name)
		setError(null)
		setEditing(false)
	}

	const commit = async () => {
		const trimmed = draft.trim()
		if (trimmed === "" || trimmed === name) {
			cancel()
			return
		}
		try {
			const found = await mutateDatasetBody(id, (d) =>
				withFreshContentHash({ ...d, name: trimmed })
			)
			if (!found) throw new Error("dataset not found")
			setError(null)
			setEditing(false)
		} catch {
			setError(
				"Couldn't load this data set to rename it. Check your connection and try again."
			)
		}
	}

	if (!editing) {
		return (
			<button
				type="button"
				onClick={startEditing}
				title={`${name} — click to rename`}
				aria-label={`${name} — rename data set`}
				className="group -mt-0.5 flex w-full min-w-0 items-center gap-1 py-0.5 text-left font-medium vc-text"
			>
				<span className="min-w-0 truncate">{name}</span>
				<svg
					viewBox="0 0 16 16"
					width={11}
					height={11}
					aria-hidden
					className="flex-shrink-0 opacity-0 group-hover:opacity-100 vc-muted"
				>
					<path
						d="M11.7 1.6l2.7 2.7-9.2 9.2-3.4.7.7-3.4 9.2-9.2z"
						fill="currentColor"
					/>
				</svg>
			</button>
		)
	}

	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<input
				type="text"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => void commit()}
				onKeyDown={(e) => {
					if (e.key === "Enter") void commit()
					if (e.key === "Escape") cancel()
				}}
				aria-label="New data set name"
				aria-invalid={error ? true : undefined}
				aria-describedby={collides || error ? noteId : undefined}
				// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the inline rename editor the user just opened
				autoFocus
				onFocus={(e) => e.target.select()}
				className="vc-focus-ring min-w-0 rounded border border-blue-400 bg-white px-1 py-0 text-sm font-medium dark:bg-stone-900 vc-text"
			/>
			<div id={noteId} className="contents">
				{collides && (
					<p className="text-xs text-amber-800 dark:text-amber-300">
						A data set named &ldquo;{draft.trim()}&rdquo; already exists.
					</p>
				)}
				{error && (
					<p className="text-xs text-red-700 dark:text-red-300">{error}</p>
				)}
			</div>
		</div>
	)
}

/** Two-option prompt that appears when a CSV is uploaded into an open Visual.
 * The user picks between adding the upload as a new version of the bound
 * dataset (live iframes refresh, pinned ones don't) and starting a fresh
 * visualization that saves the current one to the library. */
const UploadPromptModal = () => {
	const [pending, setPending] = useAtom(pendingUploadAtom)
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const currentDatasetId = useAtomValue(currentDatasetIdAtom)
	const currentVisualName = useAtomValue(currentVisualNameAtom)
	const appendImport = useAppendImportVersion()
	const createNewDataset = useCreateNewDataset()
	const saveVisual = useSaveVisual()
	const resetVisual = useResetVisual()
	const navigate = useNavigate()

	const [mode, setMode] = useState<Mode>("addVersion")
	const [newName, setNewName] = useState("")
	// Confirm can now fail: appending and starting fresh both load the bound
	// dataset's full body first (lazily, possibly over the network). A silent
	// rejection would leave the modal open with the user's confirmed upload
	// quietly dropped.
	const [confirmError, setConfirmError] = useState<string | null>(null)

	// Re-initialize the modal whenever a new pending upload arrives. Key on
	// filename+rowcount so re-opening with the same file resets fields.
	const pendingKey = pending ? `${pending.filename}:${pending.rows.length}` : ""
	useEffect(() => {
		if (!pending) return
		setMode("addVersion")
		setNewName(pending.filename.replace(/\.csv$/i, ""))
		setConfirmError(null)
		// eslint-disable-next-line react-hooks/exhaustive-deps -- pendingKey captures the identity change we care about
	}, [pendingKey])

	// Everything display-level here — the bound dataset's name and fields for
	// the compatibility diff, the same-name warning, the duplicate hint —
	// is metadata, so it reads the INDEX, which knows every dataset. The
	// loaded-bodies map only holds what this session opened; reading it here
	// made the schema guard and both collision checks silently blind.
	const datasetList = Object.values(datasetIndex)
	const currentDatasetMeta = currentDatasetId
		? datasetIndex[currentDatasetId]
		: undefined
	// Compatibility is judged against the IMPORT the data set's current
	// chain descends from, and the chain's reshape / derived variables are
	// dry-run over the upload's columns, so the dialog can say what the new
	// version will inherit (`lib/versionReplay.ts`).
	const preview = useMemo(
		() =>
			mode === "addVersion" && pending && currentDatasetMeta
				? previewImport(currentDatasetMeta, pending)
				: null,
		[mode, pending, currentDatasetMeta]
	)
	const diff = preview?.diff ?? null
	const compatible = preview ? preview.compatible : true
	const willReapply = preview ? describeReplayApplied(preview.plan) : []
	const cantReapply = preview ? describeReplaySkipped(preview.plan) : []
	// An upload identical to an existing dataset (same exact name AND content)
	// is reused rather than stored as a second copy. Display-level hint via the
	// cached content hash; the actual reuse decision inside
	// `useCreateNewDataset` re-verifies against that dataset's real rows before
	// acting. A same-named upload with DIFFERENT content is allowed (the id is
	// the identity) and only warns, so the user knows two names will match.
	// Memoized (and the hash inside is computed lazily, only on a name match):
	// this runs per keystroke in the name field, and hashing stringifies every
	// pending row.
	const reusableDatasetId = useMemo(
		() =>
			mode === "newVisualization" && pending
				? findDuplicateByHash(datasetIndex, {
						name: newName.trim() || pending.filename,
						fields: pending.fields,
						versions: [
							{
								id: "candidate",
								filename: pending.filename,
								rows: pending.rows,
								createdAt: 0,
							},
						],
					})
				: null,
		[mode, pending, datasetIndex, newName]
	)
	const newNameCollides =
		mode === "newVisualization" &&
		reusableDatasetId === null &&
		nameCollides(newName, datasetList)

	// Appends the upload as an imported version and re-applies the working
	// copy's reshape and derived variables over it (`appendImportVersion`);
	// the editor follows the data set to its new latest.
	const appendVersion = async (
		parsed: NonNullable<typeof pending>
	): Promise<boolean> => {
		if (!currentDatasetMeta) return false
		const result = await appendImport(currentDatasetMeta.id, parsed)
		if (!result.ok) {
			setConfirmError(result.error)
			return false
		}
		return true
	}

	const startNewVisualization = async (parsed: NonNullable<typeof pending>) => {
		// Snapshot the current visual to the library before we wipe editor state,
		// so it survives intact regardless of what happens next.
		await saveVisual()
		await resetVisual()
		const newDatasetId = await createNewDataset(parsed, newName)
		// Pass the dataset id via search params so VisualLoaderForNew's reset
		// doesn't strip the binding we just established.
		await navigate({
			to: "/editor/new",
			search: { datasetId: newDatasetId },
		})
	}

	const onConfirm = async () => {
		if (!pending) return
		setConfirmError(null)
		try {
			if (mode === "addVersion") {
				if (!currentDatasetMeta || !compatible) return
				if (!(await appendVersion(pending))) return
			} else {
				if (!newName.trim()) return
				await startNewVisualization(pending)
			}
		} catch (error) {
			// The body load (or the save/navigate) failed — keep the modal (and
			// the pending upload) so the user can retry, and say why nothing
			// happened. A failed duplicate check carries its own user-facing
			// message; anything else gets the generic connection line.
			setConfirmError(
				error instanceof Error && error.name === "DatasetCompareError"
					? error.message
					: "Couldn't load the existing data set to update it. Check your connection and try again."
			)
			return
		}
		setPending(null)
	}

	return (
		<Modal
			open={pending !== null}
			onClose={() => setPending(null)}
			title="Add data"
			widthClass="max-w-lg"
		>
			{pending && (
				<div className="flex flex-col gap-4">
					<div className="text-sm vc-muted">
						<span className="font-medium vc-text">
							{pending.filename}
						</span>{" "}
						· {pending.rows.length} row
						{pending.rows.length === 1 ? "" : "s"} · {pending.fields.length}{" "}
						field{pending.fields.length === 1 ? "" : "s"}
					</div>

					<label className="flex items-start gap-2 text-sm">
						<input
							type="radio"
							className="mt-1"
							checked={mode === "addVersion"}
							onChange={() => setMode("addVersion")}
						/>
						<div className="flex-1">
							<div className="font-medium text-stone-900 dark:text-stone-100">
								Add as a new data version for this visualization
							</div>
							<div className="text-sm vc-muted">
								Appends a new version to{" "}
								<span className="font-medium">
									{currentDatasetMeta?.name ?? "the bound data set"}
								</span>
								. Live iframes refresh; pinned iframes stay on their version.
							</div>
							{mode === "addVersion" && diff && !compatible && (
								<div className="mt-2 rounded-sm border border-amber-300 bg-amber-50 px-2 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
									Cannot add as a new version: {describeDiff(diff)}.
									<br />
									New versions must keep the same columns and types as the
									original (new columns may be added). To drop or retype
									columns, choose <strong>Start a new visualization</strong>{" "}
									instead.
								</div>
							)}
							{mode === "addVersion" &&
								diff &&
								compatible &&
								diff.added.length > 0 && (
									<div className="mt-2 rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-2 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
										{describeAddedColumns(diff)} Earlier versions won&rsquo;t
										have data for{" "}
										{diff.added.length === 1 ? "this column" : "these columns"}.
									</div>
								)}
							{mode === "addVersion" && compatible && willReapply.length > 0 && (
								<div className="mt-2 rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-2 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
									Will re-apply: {willReapply.join(", ")}.
								</div>
							)}
							{mode === "addVersion" && compatible && cantReapply.length > 0 && (
								<div className="mt-2 rounded-sm border border-amber-300 bg-amber-50 px-2 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
									Can&rsquo;t re-apply: {cantReapply.join("; ")}. Make{" "}
									{cantReapply.length === 1 ? "it" : "them"} again on the new
									version if you still need{" "}
									{cantReapply.length === 1 ? "it" : "them"}.
								</div>
							)}
						</div>
					</label>

					<label className="flex items-start gap-2 text-sm">
						<input
							type="radio"
							className="mt-1"
							checked={mode === "newVisualization"}
							onChange={() => setMode("newVisualization")}
						/>
						<div className="flex-1">
							<div className="font-medium text-stone-900 dark:text-stone-100">
								Start a new visualization
							</div>
							<div className="text-sm vc-muted">
								Saves{" "}
								<span className="font-medium">
									&ldquo;{currentVisualName}&rdquo;
								</span>{" "}
								to your library and opens a fresh editor with this data set.
							</div>
							{mode === "newVisualization" && (
								<div className="mt-2 flex flex-col gap-1">
									<label
										htmlFor="data-upload-new-name"
										className="text-sm vc-muted"
									>
										Data set name
									</label>
									<Input
										id="data-upload-new-name"
										value={newName}
										onChange={(e) => setNewName(e.target.value)}
										// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the name field the user just chose to fill in this dialog
										autoFocus
									/>
									{newNameCollides && (
										<div className="rounded-sm border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
											A data set named &ldquo;{newName.trim()}&rdquo; already
											exists. This upload will be saved as a separate data set
											with the same name.
										</div>
									)}
									{reusableDatasetId !== null && (
										<div className="rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
											This upload matches the existing data set &ldquo;
											{newName.trim()}&rdquo; exactly — it will be reused, not
											duplicated.
										</div>
									)}
								</div>
							)}
						</div>
					</label>

					{confirmError && (
						<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
							{confirmError}
						</div>
					)}

					<div className="flex justify-end gap-2">
						<Button compact onClick={() => setPending(null)}>
							Cancel
						</Button>
						<Button
							compact
							onClick={onConfirm}
							disabled={
								(mode === "addVersion" && (!currentDatasetMeta || !compatible)) ||
								(mode === "newVisualization" && !newName.trim())
							}
						>
							{mode === "addVersion"
								? "Add version"
								: "Start new visualization"}
						</Button>
					</div>
				</div>
			)}
		</Modal>
	)
}
