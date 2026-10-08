import { useCallback, useEffect, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	drawerHeightAtom,
	drawerOpenAtom,
	editorSheetOpenAtom,
	reshapePanelOpenAtom,
	sidebarCollapsedAtom,
	uploadNoticeAtom,
} from "../../store/atoms"
import { useHandleCsvUpload } from "../../store/useCreateNewDataset"
import {
	reshapeAppliedAtom,
	useCurrentDatasetView,
} from "../../store/useCurrentDatasetView"

import { DataTable } from "./DataTable"

const MIN_HEIGHT = 80
const MAX_HEIGHT = 600

export const DataDrawer = () => {
	const [height, setHeight] = useAtom(drawerHeightAtom)
	const [open, setOpen] = useAtom(drawerOpenAtom)
	const draggingRef = useRef(false)
	const startYRef = useRef(0)
	const startHeightRef = useRef(0)

	const handleCsvUpload = useHandleCsvUpload()
	const dataset = useCurrentDatasetView()
	const [reshapeOpen, setReshapeOpen] = useAtom(reshapePanelOpenAtom)
	const reshapeApplied = useAtomValue(reshapeAppliedAtom)
	const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom)
	const setSheetOpen = useSetAtom(editorSheetOpenAtom)
	const [dragOver, setDragOver] = useState(false)
	const [dropError, setDropError] = useState<string | null>(null)
	// Cost notes go to the root-level modal (see `uploadNoticeAtom`) — the
	// drawer header is a single-line strip with no room for a paragraph.
	const setUploadNotice = useSetAtom(uploadNoticeAtom)
	// Counter to handle nested drag enters/leaves (child elements) without
	// flicker. We only hide the overlay when the counter returns to zero.
	const dragDepthRef = useRef(0)

	const onPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			draggingRef.current = true
			startYRef.current = e.clientY
			startHeightRef.current = height
			;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
		},
		[height]
	)

	useEffect(() => {
		const onMove = (e: PointerEvent) => {
			if (!draggingRef.current) return
			const delta = startYRef.current - e.clientY
			const next = startHeightRef.current + delta
			setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next)))
		}
		const onUp = () => {
			draggingRef.current = false
		}
		window.addEventListener("pointermove", onMove)
		window.addEventListener("pointerup", onUp)
		return () => {
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
		}
	}, [setHeight])

	// --- Drag & drop --------------------------------------------------------
	const isFileDrag = (e: React.DragEvent): boolean =>
		[...(e.dataTransfer?.types ?? [])].includes("Files")

	const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(e)) return
		e.preventDefault()
		dragDepthRef.current += 1
		setDragOver(true)
	}
	const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(e)) return
		e.preventDefault()
		e.dataTransfer.dropEffect = "copy"
	}
	const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(e)) return
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
		if (dragDepthRef.current === 0) setDragOver(false)
	}
	const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
		if (!isFileDrag(e)) return
		e.preventDefault()
		dragDepthRef.current = 0
		setDragOver(false)
		setDropError(null)
		setUploadNotice(null)
		const file = e.dataTransfer.files?.[0]
		if (!file) return
		if (!file.name.toLowerCase().endsWith(".csv")) {
			setDropError("Only CSV files can be dropped.")
			return
		}
		const result = await handleCsvUpload(file)
		if (!result.ok) setDropError(result.error)
		else if (result.warning) setUploadNotice(result.warning)
	}

	return (
		<div
			className="vc-rule-t vc-bg relative flex flex-shrink-0 flex-col"
			// Collapsed, the tray is exactly its handle + header strip (no
			// fixed height: a pinned 36px used to be 5px short of that and
			// spilled past the page bottom). Open, it's the dragged height.
			style={open ? { height } : undefined}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			{/* `touch-none`: the drag is pointer-event driven, and without it a
			 *  finger's move is claimed by the browser for scrolling (the pointer
			 *  sequence gets cancelled) — so the tray could only be toggled, not
			 *  dragged, on touch. Same on the sidebar / rail resize handles. */}
			<div
				onPointerDown={onPointerDown}
				className="vc-drawer-handle group flex h-2 flex-shrink-0 cursor-ns-resize touch-none items-center justify-center pointer-coarse:h-4"
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize data table drawer"
			>
				<div className="vc-drawer-grip h-0.5 w-10 rounded-full" />
			</div>
			<div className="vc-rule-b vc-bg-muted flex items-center justify-between px-4 py-1.5">
				<span className="vc-text-section font-heading text-sm font-semibold tracking-wider uppercase">
					Data table
				</span>
				<div className="flex items-center gap-3">
					{dropError && (
						<span className="vc-text-danger text-sm">
							{dropError}
						</span>
					)}
					<span className="vc-text-faint hidden text-sm sm:inline">
						Drop a CSV to upload
					</span>
					{dataset && (
						<button
							type="button"
							title="Reshape wide data into long format (options open under Data in the left menu)"
							// Toggles only the options MENU — an applied reshape stays
							// applied with the menu closed (uncheck its Combine columns
							// to undo it).
							onClick={() => {
								const opening = !reshapeOpen
								setReshapeOpen(opening)
								// Surface the options: the panel lives in the Data
								// section of the left menu, which may be collapsed —
								// and on a narrow screen the menu itself is a sheet
								// that is closed by default.
								if (opening) {
									setSidebarCollapsed((prev) => ({ ...prev, Data: false }))
									setSheetOpen(true)
								}
							}}
							className={
								reshapeApplied
									? "vc-link-brand text-sm font-medium pointer-coarse:px-2 pointer-coarse:py-1.5"
									: "vc-link-muted text-sm transition-colors pointer-coarse:px-2 pointer-coarse:py-1.5"
							}
						>
							{reshapeApplied ? "Reshape ✓" : "Reshape"}
						</button>
					)}
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="vc-link-muted text-sm transition-colors pointer-coarse:px-2 pointer-coarse:py-1.5"
					>
						{open ? "Collapse" : "Expand"}
					</button>
				</div>
			</div>
			{open && (
				<div className="min-h-0 flex-1 overflow-auto">
					<DataTable />
				</div>
			)}
			{dragOver && (
				<div
					aria-hidden="true"
					className="vc-drawer-dropzone pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed text-sm font-medium"
				>
					Drop the CSV to upload
				</div>
			)}
		</div>
	)
}
