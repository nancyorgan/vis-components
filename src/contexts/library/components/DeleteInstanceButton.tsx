import { useSetAtom } from "jotai"
import { removeInstance } from "../../chartBuilder/lib/embedInstances"
import { embedInstancesAtom } from "../../chartBuilder/store/atoms"

type Props = {
	instanceId: string
}

/** Delete a single embed-instance row from the landing page. No confirm
 * modal: instance rows are recoverable (the user can just re-copy the embed
 * code to recreate one) and a modal per row would be heavy UX for what's
 * effectively a hide-this-row action. */
export const DeleteInstanceButton = ({ instanceId }: Props) => {
	const setEmbedInstances = useSetAtom(embedInstancesAtom)
	return (
		<button
			type="button"
			onClick={() =>
				setEmbedInstances((prev) => removeInstance(prev, instanceId))
			}
			className="text-sm text-stone-500 hover:text-red-700 dark:text-stone-400 dark:hover:text-red-300"
			title="Remove this embed row from the landing page"
		>
			Remove
		</button>
	)
}
