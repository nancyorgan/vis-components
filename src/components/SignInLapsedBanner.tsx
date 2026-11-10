import { useSignInLapsed } from "../contexts/chartBuilder/lib/storage/signInLapsed"
import { Button } from "./ui/Button"

/** Shown once the API has answered 401 this page load: behind a sign-in
 *  proxy that means the session expired, and every save, load and presence
 *  heartbeat is failing silently. A reload signs the person back in without
 *  a prompt; the editor draft lives in localStorage, so a reload picks the
 *  unsaved work back up. Sits with `StaleBuildBanner`, same shape. */
export const SignInLapsedBanner = () => {
	const lapsed = useSignInLapsed()
	if (!lapsed) return null
	return (
		<div
			role="alert"
			className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
		>
			<span>
				Your sign-in has expired, so this tab can no longer save. Reload to
				sign in again — your unsaved changes are kept.
			</span>
			<Button compact onClick={() => window.location.reload()}>
				Reload
			</Button>
		</div>
	)
}
