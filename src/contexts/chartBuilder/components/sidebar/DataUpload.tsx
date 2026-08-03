import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	describeAddedColumns,
	describeDiff,
	diffFields,
	isCompatible,
} from "../../lib/datasetCompat"
import { nameCollides } from "../../lib/nameUniqueness"
import type { Dataset, DatasetVersion } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentVisualNameAtom,
	datasetsAtom,
	pendingUploadAtom,
	previewVersionIdAtom,
} from "../../store/atoms"
import { useResetVisual, useSaveVisual } from "../../store/saveVisual"
import {
	useCreateNewDataset,
	useHandleCsvUpload,
} from "../../store/useCreateNewDataset"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

import { Button } from "../../../../components/ui/Button"
import { Input } from "../../../../components/ui/Input"
import { Modal } from "../../../../components/ui/Modal"

const newDatasetVersionId = () =>
	`dv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type Mode = "addVersion" | "newVisualization"

export const DataUpload = () => {
	const inputRef = useRef<HTMLInputElement>(null)
	const currentDataset = useCurrentDatasetView()
	const [error, setError] = useState<string | null>(null)
	const handleCsvUpload = useHandleCsvUpload()

	return (
		<div className="flex flex-col gap-2">
			<Button
				compact
				outline
				onClick={() => inputRef.current?.click()}
				className="w-full bg-white text-stone-800 hover:bg-stone-100 hover:text-stone-900 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
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
					const result = await handleCsvUpload(file)
					if (!result.ok) setError(result.error)
				}}
			/>
			{currentDataset && (
				<div className="text-sm text-stone-600 dark:text-stone-400">
					<div className="truncate font-medium text-stone-700 dark:text-stone-300">
						{currentDataset.name}
					</div>
					<div>
						{currentDataset.rows.length} row
						{currentDataset.rows.length === 1 ? "" : "s"} ·{" "}
						{currentDataset.fields.length} field
						{currentDataset.fields.length === 1 ? "" : "s"} ·{" "}
						{currentDataset.totalVersions === 1
							? "v1"
							: `v${currentDataset.versionIndex} of ${currentDataset.totalVersions}`}
					</div>
				</div>
			)}
			{error && (
				<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
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

/** Two-option prompt that appears when a CSV is uploaded into an open Visual.
 * The user picks between adding the upload as a new version of the bound
 * dataset (live iframes refresh, pinned ones don't) and starting a fresh
 * visualization that saves the current one to the library. */
const UploadPromptModal = () => {
	const [pending, setPending] = useAtom(pendingUploadAtom)
	const [datasets, setDatasets] = useAtom(datasetsAtom)
	const currentDatasetId = useAtomValue(currentDatasetIdAtom)
	const currentVisualName = useAtomValue(currentVisualNameAtom)
	const setDatasetId = useSetAtom(currentDatasetIdAtom)
	const setPreviewVersionId = useSetAtom(previewVersionIdAtom)
	const createNewDataset = useCreateNewDataset()
	const saveVisual = useSaveVisual()
	const resetVisual = useResetVisual()
	const navigate = useNavigate()

	const [mode, setMode] = useState<Mode>("addVersion")
	const [newName, setNewName] = useState("")

	// Re-initialize the modal whenever a new pending upload arrives. Key on
	// filename+rowcount so re-opening with the same file resets fields.
	const pendingKey = pending ? `${pending.filename}:${pending.rows.length}` : ""
	useEffect(() => {
		if (!pending) return
		setMode("addVersion")
		setNewName(pending.filename.replace(/\.csv$/i, ""))
		// eslint-disable-next-line react-hooks/exhaustive-deps -- pendingKey captures the identity change we care about
	}, [pendingKey])

	const datasetList = Object.values(datasets)
	const currentDataset = currentDatasetId
		? datasets[currentDatasetId]
		: undefined
	const diff =
		mode === "addVersion" && pending && currentDataset
			? diffFields(currentDataset.fields, pending.fields)
			: null
	const compatible = diff ? isCompatible(diff) : true
	const newNameCollides =
		mode === "newVisualization" && nameCollides(newName, datasetList)

	const appendVersion = (parsed: NonNullable<typeof pending>) => {
		if (!currentDataset) return
		const versionId = newDatasetVersionId()
		const version: DatasetVersion = {
			id: versionId,
			filename: parsed.filename,
			rows: parsed.rows,
			createdAt: Date.now(),
		}
		// Net-new columns are additive: merge them into the dataset's invariant
		// field list (appended after the existing fields) so the new variable is
		// selectable/encodable. Existing versions' rows simply lack the column and
		// read as empty for it. `missing`/`typeChanged` are already blocked above,
		// so the shared schema stays valid for every prior version.
		const addedFields =
			diff && diff.added.length > 0
				? parsed.fields.filter((f) => diff.added.includes(f.name))
				: []
		const next: Dataset = {
			...currentDataset,
			fields:
				addedFields.length > 0
					? [...currentDataset.fields, ...addedFields]
					: currentDataset.fields,
			versions: [...currentDataset.versions, version],
			latestVersionId: versionId,
		}
		setDatasets((prev) => ({ ...prev, [currentDataset.id]: next }))
		setDatasetId(currentDataset.id)
		setPreviewVersionId(null)
	}

	const startNewVisualization = async (parsed: NonNullable<typeof pending>) => {
		// Snapshot the current visual to the library before we wipe editor state,
		// so it survives intact regardless of what happens next.
		await saveVisual()
		await resetVisual()
		const newDatasetId = createNewDataset(parsed, newName)
		// Pass the dataset id via search params so VisualLoaderForNew's reset
		// doesn't strip the binding we just established.
		await navigate({
			to: "/editor/new",
			search: { datasetId: newDatasetId },
		})
	}

	const onConfirm = async () => {
		if (!pending) return
		if (mode === "addVersion") {
			if (!currentDataset || !compatible) return
			appendVersion(pending)
		} else {
			if (!newName.trim() || newNameCollides) return
			await startNewVisualization(pending)
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
					<div className="text-sm text-stone-600 dark:text-stone-400">
						<span className="font-medium text-stone-800 dark:text-stone-200">
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
							<div className="text-sm text-stone-600 dark:text-stone-400">
								Appends a new version to{" "}
								<span className="font-medium">
									{currentDataset?.name ?? "the bound data set"}
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
							<div className="text-sm text-stone-600 dark:text-stone-400">
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
										className="text-sm text-stone-600 dark:text-stone-400"
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
										<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
											A data set named &ldquo;{newName.trim()}&rdquo; already
											exists. Pick a different name.
										</div>
									)}
								</div>
							)}
						</div>
					</label>

					<div className="flex justify-end gap-2">
						<Button compact outline onClick={() => setPending(null)}>
							Cancel
						</Button>
						<Button
							compact
							onClick={onConfirm}
							disabled={
								(mode === "addVersion" && (!currentDataset || !compatible)) ||
								(mode === "newVisualization" &&
									(!newName.trim() || newNameCollides))
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
