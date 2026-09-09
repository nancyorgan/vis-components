import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { combine as c } from "../../lib/cls"

import { Button } from "./Button"

// Lightweight portal-based modal. No headless-ui dependency to keep the
// vis-components bundle small. Esc/backdrop close, focus stays in document
// flow (good enough for the upload prompt and export modal use cases).

type ModalProps = {
	open: boolean
	onClose: () => void
	title?: ReactNode
	children: ReactNode
	/** Tailwind width class for the panel. Defaults to max-w-md. */
	widthClass?: string
	/** When false, clicking the backdrop does NOT close the modal — for
	 * notices that must be acknowledged rather than clicked past. Escape and
	 * the panel's own buttons still close. Defaults to true. */
	dismissOnBackdrop?: boolean
	/** Explicit pixel cap for the panel width. Overrides `widthClass`'s
	 * max-width when set — used by the export modal to grow the popup to the
	 * chosen image size. Still bounded by the viewport via `w-full`. */
	maxWidthPx?: number
	/** Extra classes on the panel itself — for a dialog that needs to look
	 * different from the neutral default (e.g. the red frame on a warning).
	 * Appended last, so a border/ring here overrides the default one. */
	panelClassName?: string
	/** When true, the panel is anchored to the top of the viewport instead of
	 * vertically centered — for a dialog whose height changes with its content
	 * (the export modal's preview): growth extends the bottom edge only, so
	 * the controls at the top stay pinned in place. */
	anchorTop?: boolean
	/** When true, the panel hugs its content's width instead of filling
	 * `maxWidthPx` — inside a fixed slot of that width, LEFT-aligned, so the
	 * left edge (and the controls along it) stays pinned while the panel grows
	 * rightward with its content. Requires `maxWidthPx`. */
	fitWidth?: boolean
	/** With `fitWidth`: indents the panel's pinned left edge this far into the
	 * slot, so a viewport-spanning slot can still start the panel at a
	 * comfortable position (rather than hugging the screen's left edge) while
	 * leaving all the room to its right for growth. */
	fitWidthOffsetPx?: number
	/** Extra classes on the body wrapper (the padded region under the title).
	 * For a fixed-height dialog that owns its own inner scroll region: pair
	 * `panelClassName="flex h-… flex-col"` with
	 * `bodyClassName="flex min-h-0 flex-1 flex-col"` so the body can hand a
	 * child the leftover space instead of growing the panel. */
	bodyClassName?: string
}

export const Modal = ({
	open,
	onClose,
	title,
	children,
	widthClass = "max-w-md",
	maxWidthPx,
	anchorTop = false,
	fitWidth = false,
	fitWidthOffsetPx,
	dismissOnBackdrop = true,
	panelClassName,
	bodyClassName,
}: ModalProps) => {
	// A text-selection drag that starts inside the panel (e.g. highlighting a
	// dimension input) and releases over the backdrop fires the click on the
	// backdrop — the common ancestor of press and release — so a bare onClick
	// close would dismiss the modal mid-selection. Only close when the press
	// itself began on the backdrop.
	const pressBeganOnBackdrop = useRef(false)

	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [open, onClose])

	if (!open) return null

	const panel = (
		/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- click here only stops propagation so panel clicks don't hit the backdrop's click-away; Escape closes via the keydown listener above */
		<div
			className={c(
				// max-h + overflow-y-auto is a backstop: a panel taller than the
				// viewport (minus the backdrop's padding) scrolls internally
				// instead of extending past the screen edges, where the title and
				// buttons would be unreachable. Panels are expected to size
				// themselves to fit; the scrollbar only appears when one doesn't.
				"max-h-full overflow-y-auto rounded-md border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900",
				fitWidth ? "w-fit max-w-full" : "w-full",
				maxWidthPx === undefined && !fitWidth && widthClass,
				panelClassName
			)}
			style={
				maxWidthPx === undefined || fitWidth
					? undefined
					: { maxWidth: maxWidthPx }
			}
			onClick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
		>
			{title && (
				<div className="border-b border-stone-200 px-4 py-3 text-sm font-medium text-stone-900 dark:border-stone-700 dark:text-white">
					{title}
				</div>
			)}
			<div className={c("p-4", bodyClassName)}>{children}</div>
		</div>
	)

	return createPortal(
		<div
			className={c(
				"fixed inset-0 z-50 flex justify-center bg-stone-900/40 px-4 py-6 dark:bg-stone-950/60",
				anchorTop ? "items-start" : "items-center"
			)}
			onMouseDown={(e) => {
				pressBeganOnBackdrop.current = e.target === e.currentTarget
			}}
			onClick={
				dismissOnBackdrop
					? (e) => {
							if (e.target === e.currentTarget && pressBeganOnBackdrop.current)
								onClose()
					  }
					: undefined
			}
			role="presentation"
		>
			{fitWidth ? (
				/* Fixed-width slot the fit-width panel is LEFT-aligned inside: the
				   slot (not the panel) is what the backdrop centers, so the panel's
				   left edge stays pinned while its width follows the content. h-full
				   gives the panel's max-h backstop a definite height to resolve
				   against. */
				<div
					className="flex h-full items-start justify-start"
					style={{
						width: maxWidthPx,
						maxWidth: "100%",
						paddingLeft: fitWidthOffsetPx,
					}}
				>
					{panel}
				</div>
			) : (
				panel
			)}
		</div>,
		document.body
	)
}

/** Styled confirm dialog for destructive / mode-changing actions. Built on
 * Modal so it picks up the same backdrop, focus trap, and ESC handling,
 * rather than the bare `window.confirm()` browser alert. */
export const ConfirmDialog = ({
	open,
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	warning = false,
	onCancel,
	onConfirm,
}: {
	open: boolean
	title: string
	message: ReactNode
	confirmLabel?: string
	cancelLabel?: string
	/** When true, the confirm button uses the red destructive style. */
	destructive?: boolean
	/** When true, the WHOLE dialog reads as a warning — red frame and title
	 * rule, not just a red button. For a dialog that cautions about what
	 * you're stepping into rather than confirming one destructive act.
	 * Implies the destructive confirm button. */
	warning?: boolean
	onCancel: () => void
	onConfirm: () => void
}) => (
	<Modal
		open={open}
		onClose={onCancel}
		title={
			warning ? (
				<span className="text-red-700 dark:text-red-300">{title}</span>
			) : (
				title
			)
		}
		// `!` because these fight the panel's own neutral border utilities,
		// which Tailwind emits at the same specificity — source order in the
		// class attribute wouldn't decide the winner.
		panelClassName={
			warning
				? "!border-2 !border-red-500 [&>div:first-child]:!border-red-300 dark:[&>div:first-child]:!border-red-800"
				: undefined
		}
	>
		<div className="flex flex-col gap-4">
			<div className="text-sm text-stone-700 dark:text-stone-300">
				{message}
			</div>
			<div className="flex justify-end gap-2">
				<Button compact outline onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button compact danger={destructive || warning} onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</div>
		</div>
	</Modal>
)
