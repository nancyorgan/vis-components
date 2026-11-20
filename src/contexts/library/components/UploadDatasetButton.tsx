import { useRef, useState } from "react"
import { Button } from "../../../components/ui/Button"
import type { DatasetMeta, Folder } from "../../chartBuilder/lib/types"
import { useUploadDatasetToLibrary } from "../hooks/useDatasetActions"
import { folderAncestors } from "../lib/folderSubtree"
import { FolderPickerModal } from "./FolderPickerModal"

/** One line about an upload, shown under the Data tab's header. */
export type UploadNotice = { kind: "done" | "warning" | "error"; text: string }

/** The Data tab's "Upload data set": pick one or more CSV files, pick the
 *  folder they go in, and they join the library as data sets — no
 *  visualization needed. With no folders of the user's there is nothing to
 *  pick, so the files upload straight into "not in a folder". `onNotices`
 *  gets a line per file: where it went, a size or performance warning, or
 *  why it wasn't stored. */
export const UploadDatasetButton = ({
	folders,
	initialFolderId,
	listed,
	onNotices,
}: {
	/** The user's own data folders — the stock shelf and the trash excluded. */
	folders: readonly Folder[]
	initialFolderId: string | null
	/** The data sets the Data tab lists, for the same-file check. */
	listed: Record<string, DatasetMeta>
	onNotices: (notices: UploadNotice[]) => void
}) => {
	const upload = useUploadDatasetToLibrary()
	const inputRef = useRef<HTMLInputElement>(null)
	// Files picked and waiting for a destination.
	const [pending, setPending] = useState<File[] | null>(null)
	const [busy, setBusy] = useState(false)

	const run = async (files: File[], folderId: string | null) => {
		setPending(null)
		setBusy(true)
		const where =
			folderId === null
				? "Not in a folder"
				: folderAncestors(folders, folderId)
						.map((f) => f.name)
						.join(" / ")
		const notices: UploadNotice[] = []
		for (const file of files) {
			const result = await upload(file, folderId, listed)
			if (result.ok) {
				notices.push({
					kind: "done",
					text: `Uploaded “${result.name}” to ${where}.`,
				})
				if (result.warning)
					notices.push({ kind: "warning", text: result.warning })
			} else if ("duplicateOf" in result) {
				notices.push({
					kind: "warning",
					text: `“${result.name}” is already in the library with the same contents, so it wasn't uploaded again.`,
				})
			} else {
				notices.push({
					kind: "error",
					text: `Couldn't upload “${result.name}”: ${result.error}`,
				})
			}
		}
		setBusy(false)
		onNotices(notices)
	}

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept=".csv,text/csv"
				multiple
				hidden
				aria-label="CSV files to upload"
				onChange={(e) => {
					const files = [...(e.target.files ?? [])]
					// Cleared so picking the same file again fires a change.
					e.target.value = ""
					if (files.length === 0) return
					if (folders.length === 0) void run(files, null)
					else setPending(files)
				}}
			/>
			<Button compact disabled={busy} onClick={() => inputRef.current?.click()}>
				{busy ? "Uploading…" : "Upload data set"}
			</Button>
			<FolderPickerModal
				open={pending !== null}
				title={
					pending?.length === 1
						? `Upload ${pending[0].name}`
						: `Upload ${pending?.length ?? 0} data sets`
				}
				confirmLabel="Upload"
				folders={folders}
				rootLabel="Not in a folder"
				initialTarget={initialFolderId}
				onCancel={() => setPending(null)}
				onConfirm={(folderId) => {
					if (pending) void run(pending, folderId)
				}}
			/>
		</>
	)
}
