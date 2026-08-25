import { useCallback, useEffect, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	drawerHeightAtom,
	drawerOpenAtom,
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

	const effectiveHeight = open ? height : 36

	return (
		<div
			className="relative flex flex-col border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
			style={{ height: effectiveHeight }}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<div
				onPointerDown={onPointerDown}
				className="group flex h-2 flex-shrink-0 cursor-ns-resize items-center justify-center bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize data table drawer"
			>
				<div className="h-0.5 w-10 rounded-full bg-stone-400 group-hover:bg-stone-600 dark:bg-stone-600 dark:group-hover:bg-stone-400" />
			</div>
			<div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-1.5 dark:border-stone-800 dark:bg-stone-900/50">
				<span className="font-heading text-vc-section-header text-sm font-semibold tracking-wider uppercase">
					Data table
				</span>
				<div className="flex items-center gap-3">
					{dropError && (
						<span className="text-sm text-red-700 dark:text-red-300">
							{dropError}
						</span>
					)}
					<span className="hidden text-sm text-stone-500 sm:inline dark:text-stone-500">
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
								// section of the left menu, which may be collapsed.
								if (opening)
									setSidebarCollapsed((prev) => ({ ...prev, Data: false }))
							}}
							className={
								reshapeApplied
									? "text-sm font-medium text-th-electric-indigo-700 hover:opacity-80 dark:text-th-electric-indigo-300"
									: "text-sm text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
							}
						>
							{reshapeApplied ? "Reshape ✓" : "Reshape"}
						</button>
					)}
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="text-sm text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
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
					className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-blue-500 bg-blue-50/80 text-sm font-medium text-blue-800 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-200"
				>
					Drop the CSV to upload
				</div>
			)}
		</div>
	)
}
