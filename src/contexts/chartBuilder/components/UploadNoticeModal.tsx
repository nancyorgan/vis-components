import { useAtom } from "jotai"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"
import { uploadNoticeAtom } from "../store/atoms"

/** Centered, acknowledge-to-continue notice for an upload that will be slow to
 *  chart (see `lib/datasetLimits.ts`). Rendered from RootLayout rather than
 *  from the upload controls: creating a new visualization navigates, and a
 *  notice owned by the sidebar disappeared on that remount before it could be
 *  read. Nothing auto-dismisses it and nothing about the data changed — the
 *  full data set is already imported; this only says charting it may be slow. */
export const UploadNoticeModal = () => {
	const [notice, setNotice] = useAtom(uploadNoticeAtom)
	return (
		<Modal
			open={notice !== null}
			onClose={() => setNotice(null)}
			title="Large data set"
			dismissOnBackdrop={false}
		>
			<div className="flex flex-col gap-4">
				<div className="text-sm text-stone-700 dark:text-stone-300">
					{notice}
				</div>
				<div className="flex justify-end">
					<Button compact onClick={() => setNotice(null)}>
						Got it
					</Button>
				</div>
			</div>
		</Modal>
	)
}
