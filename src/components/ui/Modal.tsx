import { useEffect, type ReactNode } from "react"
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
}

export const Modal = ({
	open,
	onClose,
	title,
	children,
	widthClass = "max-w-md",
	maxWidthPx,
	dismissOnBackdrop = true,
}: ModalProps) => {
	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [open, onClose])

	if (!open) return null

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4 dark:bg-stone-950/60"
			onClick={dismissOnBackdrop ? onClose : undefined}
			role="presentation"
		>
			{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- click here only stops propagation so panel clicks don't hit the backdrop's click-away; Escape closes via the keydown listener above */}
			<div
				className={c(
					"w-full overflow-hidden rounded-md border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900",
					maxWidthPx === undefined && widthClass
				)}
				style={
					maxWidthPx === undefined ? undefined : { maxWidth: maxWidthPx }
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
				<div className="p-4">{children}</div>
			</div>
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
	onCancel: () => void
	onConfirm: () => void
}) => (
	<Modal open={open} onClose={onCancel} title={title}>
		<div className="flex flex-col gap-4">
			<div className="text-sm text-stone-700 dark:text-stone-300">
				{message}
			</div>
			<div className="flex justify-end gap-2">
				<Button compact outline onClick={onCancel}>
					{cancelLabel}
				</Button>
				<Button
					compact
					onClick={onConfirm}
					className={
						destructive
							? "!bg-red-600 !text-white hover:!bg-red-700 dark:!bg-red-700 dark:hover:!bg-red-600"
							: undefined
					}
				>
					{confirmLabel}
				</Button>
			</div>
		</div>
	</Modal>
)
