import { ConfirmDialog } from "../../../components/ui/Modal"

/** The honor-system gate on managed themes. There are no user accounts yet
 *  — the whole team shares one library — so this asks rather than checks,
 *  and a "yes" unlocks managed themes for the rest of the session (see
 *  `managedThemesUnlockedAtom`).
 *
 *  Lives beside the theme model rather than in Settings because both the
 *  Settings folders and the editor sidebar's default-theme link have to
 *  put up the SAME dialog — one wording, one behavior. It fires on EVERY
 *  reach for a managed theme, not once per session: the warning is the
 *  whole mechanism, so it isn't something a single "Yes" can switch off. */
export const ManagedThemeGate = ({
	open,
	onCancel,
	onConfirm,
}: {
	open: boolean
	onCancel: () => void
	onConfirm: () => void
}) => (
	<ConfirmDialog
		open={open}
		title="Managed themes"
		message="These themes are managed by the administrator. Are you sure you have permission to edit them?"
		confirmLabel="Yes, proceed"
		cancelLabel="No, exit"
		warning
		onCancel={onCancel}
		onConfirm={onConfirm}
	/>
)
