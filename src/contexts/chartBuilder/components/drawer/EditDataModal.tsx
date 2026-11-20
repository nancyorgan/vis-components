import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react"
import { useAtomValue } from "jotai"
import { useAtomCallback } from "jotai/utils"
import { sameFieldFilters, type FieldFilter } from "../../lib/columnFilter"
import {
	alignEditedRows,
	planEditedFields,
	rowsAfterRenames,
	rowsUnderFieldNames,
	type EditedCells,
	type FieldPlan,
} from "../../lib/datasetEdits"
import {
	filteredOutCount,
	gridFieldFilters,
	gridFromView,
	gridIssue,
	gridToCsv,
	withFieldFilters,
	type Grid,
} from "../../lib/editGrid"
import { resolveDatasetView } from "../../lib/resolveDatasetVersion"
import { nameCollides } from "../../lib/nameUniqueness"
import type { DatasetView } from "../../lib/types"
import {
	currentDatasetIdAtom,
	datasetIndexAtom,
	getDatasetBody,
} from "../../store/atoms"
import { parsePastedData } from "../../store/useCreateNewDataset"
import { currentRawDatasetViewAtom } from "../../store/useCurrentDatasetView"
import { suggestedCopyName } from "../../store/commitDatasetVersion"
import {
	editSaveMode,
	planOptionsFor,
	useSaveEditedData,
} from "../../store/useEditDataset"

import { Button } from "../../../../components/ui/Button"
import { Input } from "../../../../components/ui/Input"
import { Modal } from "../../../../components/ui/Modal"
import { EditDataGrid, useGridHistory } from "./EditDataGrid"

type Props = {
	open: boolean
	onClose: () => void
}

/** The data tray's Edit dialog: the version shown as a grid of cells the
 *  user changes in place (`EditDataGrid`), saved as hand-edited data. The
 *  first change to imported data creates a NEW data set (the imported one is
 *  never touched — other visuals may share it); an edit of a data set that
 *  is already a working copy — edited, reshaped, or given a derived
 *  variable — adds a version to it. Column filters are saved as one more
 *  version on top, holding the rows they keep. The grid serializes to the same CSV
 *  text the dialog's text box used to hold, so the save path
 *  (`store/useEditDataset.ts`) is unchanged. */
export const EditDataModal = ({ open, onClose }: Props) => (
	<Modal
		open={open}
		onClose={onClose}
		title="Edit data"
		widthClass="max-w-5xl"
		tipDialog="edit-data"
	>
		{/* The Modal renders nothing while closed, so the form (and its draft
		 *  grid, undo history, name and errors) remounts fresh on every open. */}
		<EditDataForm onClose={onClose} />
	</Modal>
)

const EditDataForm = ({ onClose }: { onClose: () => void }) => {
	const view = useAtomValue(currentRawDatasetViewAtom)
	// The grid seeds ONCE from the view as the dialog opened (the Modal
	// remounts the form on every open), so a background refresh of the
	// data set can't wipe the edits in progress.
	const [seedGrid] = useState(() => (view ? gridFromView(view) : null))
	if (!view || !seedGrid) {
		return <div className="text-sm vc-muted">No data set is loaded.</div>
	}
	return <EditDataBody view={view} seedGrid={seedGrid} onClose={onClose} />
}

/** The grid, its change summary, the name box and the save. The editor's
 *  dialog edits the version the visualization shows; the library's Data tab
 *  passes `detached` and edits `view` without the editor (the save then
 *  leaves the open visualization alone). `intro` replaces the explanatory
 *  line above the grid.
 *
 *  A version that column filters made opens over the rows it was filtered
 *  FROM, with those filters set — so a filter can be loosened or taken off
 *  and the rows it removed come back. */
export const EditDataBody = (props: BodyProps) => {
	const source = useFilterSource(props.view)
	if (source.status === "loading")
		return <div className="text-sm vc-muted">Loading the data…</div>
	if (source.status === "ready")
		return (
			<EditDataInner
				{...props}
				view={source.view}
				seedGrid={source.grid}
				initialFilters={source.filters}
				reopened
			/>
		)
	return <EditDataInner {...props} initialFilters={NO_FILTERS} reopened={false} />
}

type BodyProps = {
	view: DatasetView
	seedGrid: Grid
	onClose: () => void
	detached?: boolean
	intro?: ReactNode
	closeLabel?: string
}

const NO_FILTERS: FieldFilter[] = []

type FilterSource =
	| { status: "none" }
	| { status: "loading" }
	| { status: "ready"; view: DatasetView; grid: Grid; filters: FieldFilter[] }

/** When `view` is a version column filters made: the version it was
 *  filtered from (loaded — its rows may not be in memory) as a grid with
 *  those filters set. "none" for any other version, or when the source
 *  version no longer exists — the filtered rows are then edited as they
 *  are. Decided once, as the dialog opens. */
const useFilterSource = (view: DatasetView): FilterSource => {
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const [plan] = useState(() => {
		const version = datasetIndex[view.id]?.versions.find(
			(v) => v.id === view.versionId
		)
		const filters = version?.transform?.filter
		return version?.editedFrom && filters && filters.length > 0
			? { sourceId: version.editedFrom, filters }
			: null
	})
	const loadVersion = useAtomCallback(
		useCallback(async (get, _set, datasetId: string, versionId: string) => {
			const body = await getDatasetBody(get, datasetId).catch(() => null)
			const found = resolveDatasetView(body ?? undefined, versionId)
			return found?.versionId === versionId ? found : undefined
		}, [])
	)
	const [state, setState] = useState<FilterSource>(
		plan ? { status: "loading" } : { status: "none" }
	)
	useEffect(() => {
		if (!plan) return
		let live = true
		void loadVersion(view.id, plan.sourceId).then((source) => {
			if (!live) return
			setState(
				source
					? {
							status: "ready",
							view: source,
							grid: withFieldFilters(gridFromView(source), plan.filters),
							filters: plan.filters,
						}
					: { status: "none" }
			)
		})
		return () => {
			live = false
		}
		// Once, for the version the dialog opened on.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])
	return state
}

const EditDataInner = ({
	view,
	seedGrid,
	onClose,
	detached = false,
	intro,
	closeLabel = "Cancel",
	initialFilters,
	reopened,
}: BodyProps & {
	/** The filters the grid opened with (a filtered version reopened). */
	initialFilters: FieldFilter[]
	/** `view` is the version a filtered one was made from, not the one
	 *  shown: the save is made from it. */
	reopened: boolean
}) => {
	const editorDatasetId = useAtomValue(currentDatasetIdAtom)
	const datasetId = detached ? view.id : editorDatasetId
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const meta = datasetId ? datasetIndex[datasetId] : undefined
	const mode = meta ? editSaveMode(meta) : "fork"
	const history = useGridHistory(seedGrid)
	const seed = useMemo(() => gridToCsv(seedGrid), [seedGrid])
	// What the grid would save: the same CSV text the dialog's text box once
	// held, so the summary and the save path read it exactly as before.
	const issue = gridIssue(history.grid)
	const text = useMemo(
		() => (issue ? null : gridToCsv(history.grid)),
		[history.grid, issue]
	)
	// The columns' filters, saved as a version of their own.
	const filters = useMemo(() => gridFieldFilters(history.grid), [history.grid])
	const filteredOut = useMemo(() => filteredOutCount(history.grid), [history.grid])
	const filtersChanged = !sameFieldFilters(filters, initialFilters)
	const [name, setName] = useState(() =>
		mode === "fork" ? suggestedCopyName(view.name, "edited") : view.name
	)
	const [submitError, setSubmitError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const saveEditedData = useSaveEditedData()

	// The summary re-parses and re-aligns the whole table; deferring it keeps
	// editing a large one responsive.
	const deferredText = useDeferredValue(text)
	const preview = useMemo<EditPreview>(
		() =>
			issue
				? { kind: "error", error: issue }
				: deferredText === null
					? { kind: "unchanged" }
					: previewEdits(view, seed, deferredText, mode),
		[view, seed, deferredText, mode, issue]
	)

	// Same-named data sets are allowed (the id is the identity); a collision
	// only warns. Appending keeps the data set, so its own name doesn't count.
	const collides = nameCollides(
		name,
		Object.values(datasetIndex),
		mode === "append" ? (datasetId ?? undefined) : undefined
	)
	const canSave =
		!busy &&
		text !== null &&
		(preview.kind === "changed" ||
			(preview.kind === "unchanged" && filtersChanged)) &&
		name.trim() !== "" &&
		// The deferred summary lags the text; don't save a stale read.
		deferredText === text

	const onSave = async () => {
		if (!canSave || text === null) return
		setBusy(true)
		setSubmitError(null)
		const edited = preview.kind === "changed"
		const result = await saveEditedData(
			text,
			name,
			detached || reopened ? view : undefined,
			{ filters, edited, unfilter: !edited && filters.length === 0 && filtersChanged }
		)
		setBusy(false)
		if (!result.ok) {
			setSubmitError(result.error)
			return
		}
		onClose()
	}

	return (
		<div className="flex flex-col gap-3">
			{intro ?? (
				<div className="text-sm vc-muted">
					Editing data here creates a new data set version. Edited cells will
					be highlighted in the table so that you can track what changed. Use
					a column&rsquo;s filter icon to remove rows. Edit column names under
					Fields in the main menu.
				</div>
			)}
			<EditDataGrid
				grid={history.grid}
				seed={seedGrid}
				commit={history.commit}
				undo={history.undo}
				redo={history.redo}
				canUndo={history.canUndo}
				canRedo={history.canRedo}
			/>
			<div
				role="status"
				className={
					preview.kind === "error"
						? "vc-notice-error"
						: "text-sm vc-muted"
				}
			>
				{preview.kind === "error" && preview.error}
				{preview.kind === "unchanged" &&
					(!filtersChanged
						? "No changes yet."
						: filters.length > 0
							? describeFilters(filters.length, filteredOut)
							: `Filters removed · all ${plural(seedGrid.rows.length, "row")} restored`)}
				{preview.kind === "changed" &&
					describeEdits(preview) +
						(filters.length > 0
							? ` · ${describeFilters(filters.length, filteredOut)}`
							: "")}
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor="edit-data-name" className="text-sm vc-muted">
					Data set name
				</label>
				<Input
					id="edit-data-name"
					data-tip="edit-data-name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void onSave()
					}}
				/>
				{collides && (
					<div className="vc-notice-warning">
						A data set named &ldquo;{name.trim()}&rdquo; already exists. This will
						be saved as a separate data set with the same name.
					</div>
				)}
			</div>
			{submitError && (
				<div className="vc-notice-error">
					{submitError}
				</div>
			)}
			<div className="flex justify-end gap-2">
				<Button compact onClick={onClose}>
					{closeLabel}
				</Button>
				<Button compact onClick={() => void onSave()} disabled={!canSave}>
					{mode === "fork" ? "Save as new data set" : "Save new version"}
				</Button>
			</div>
		</div>
	)
}

type EditPreview =
	| { kind: "unchanged" }
	| { kind: "error"; error: string }
	| {
			kind: "changed"
			rows: number
			columns: number
			plan: FieldPlan
			cells: EditedCells
	  }

/** What the text would save as, against the version shown: the parse
 *  complaint, "unchanged", or the counts the summary line reads out. */
const previewEdits = (
	view: DatasetView,
	seed: string,
	text: string,
	mode: "fork" | "append"
): EditPreview => {
	if (text.trim() === seed.trim()) return { kind: "unchanged" }
	try {
		const parsed = parsePastedData(text)
		const plan = planEditedFields(view.fields, parsed.fields, planOptionsFor(mode))
		const names = plan.fields
			.filter((f) => plan.headerOf[f.name] !== undefined)
			.map((f) => f.name)
		const cells = alignEditedRows(
			rowsAfterRenames(plan, view.rows),
			rowsUnderFieldNames(plan, parsed.rows),
			names
		)
		return {
			kind: "changed",
			rows: parsed.rows.length,
			columns: parsed.fields.length,
			plan,
			cells,
		}
	} catch (error) {
		return {
			kind: "error",
			error:
				error instanceof Error ? error.message : "Couldn't parse the edited data",
		}
	}
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

const describeFilters = (filters: number, rowsOut: number): string =>
	`${plural(filters, "filter")} ${filters === 1 ? "removes" : "remove"} ${plural(rowsOut, "row")}`

const describeEdits = (p: Extract<EditPreview, { kind: "changed" }>): string => {
	const parts = [plural(p.rows, "row"), plural(p.columns, "column")]
	if (p.cells.changedCellCount > 0)
		parts.push(`${plural(p.cells.changedCellCount, "cell")} changed`)
	if (p.cells.addedRowCount > 0)
		parts.push(`${plural(p.cells.addedRowCount, "row")} added`)
	if (p.cells.removedRowCount > 0)
		parts.push(`${plural(p.cells.removedRowCount, "row")} removed`)
	if (p.plan.added.length > 0) parts.push(`added: ${p.plan.added.join(", ")}`)
	if (p.plan.dropped.length > 0) parts.push(`dropped: ${p.plan.dropped.join(", ")}`)
	if (p.plan.renames.length > 0)
		parts.push(
			`renamed: ${p.plan.renames.map((r) => `${r.from} → ${r.to}`).join(", ")}`
		)
	if (parts.length === 2) parts.push("no cells changed")
	return parts.join(" · ")
}
