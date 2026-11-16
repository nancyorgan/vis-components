import {
	type CanvasZoom,
	MAX_ZOOM,
	MIN_ZOOM,
	formatZoom,
	zoomInFrom,
	zoomOutFrom,
} from "../lib/canvasZoom"

const BUTTON =
	"flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
const IDLE =
	"vc-text hover:enabled:bg-stone-100 hover:enabled:text-stone-900 dark:hover:enabled:bg-stone-800 dark:hover:enabled:text-white"

/** Floating zoom pill over a fixed canvas's gray viewport: zoom out, the
 *  current percentage (click → back to 100%), zoom in (capped at 100%),
 *  and Fit (whole canvas in view, tracking viewport resizes). Display
 *  only — see `lib/canvasZoom.ts`. */
export const CanvasZoomControls = ({
	zoom,
	scale,
	onChange,
}: {
	zoom: CanvasZoom
	/** The scale currently applied (resolved from `zoom`). */
	scale: number
	onChange: (zoom: CanvasZoom) => void
}) => {
	const fitOn = zoom === "fit"
	return (
		<div
			role="toolbar"
			aria-label="Canvas zoom"
			className="absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-full border border-stone-200 bg-white/95 p-0.5 text-xs shadow-md dark:border-stone-700 dark:bg-stone-900/95"
		>
			<button
				type="button"
				className={`${BUTTON} ${IDLE}`}
				onClick={() => onChange(zoomOutFrom(scale))}
				disabled={scale <= MIN_ZOOM}
				title="Zoom out"
				aria-label="Zoom out"
			>
				<svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
					<path d="M3 8h10" stroke="currentColor" strokeWidth={1.5} />
				</svg>
			</button>
			<button
				type="button"
				className={`${BUTTON} ${IDLE} w-12 tabular-nums`}
				onClick={() => onChange(MAX_ZOOM)}
				disabled={scale >= MAX_ZOOM && !fitOn}
				title="Reset zoom"
				aria-label={`Zoom ${formatZoom(scale)}, reset to 100%`}
			>
				{formatZoom(scale)}
			</button>
			<button
				type="button"
				className={`${BUTTON} ${IDLE}`}
				onClick={() => onChange(zoomInFrom(scale))}
				disabled={scale >= MAX_ZOOM}
				title="Zoom in"
				aria-label="Zoom in"
			>
				<svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
					<path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth={1.5} />
				</svg>
			</button>
			<button
				type="button"
				className={`${BUTTON} ${fitOn ? "vc-toggle-on" : IDLE} px-2.5`}
				onClick={() => onChange("fit")}
				aria-pressed={fitOn}
				title="Fit to view"
			>
				Fit
			</button>
		</div>
	)
}
