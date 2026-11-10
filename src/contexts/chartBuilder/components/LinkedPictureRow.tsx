import { useId } from "react"

import { CopyButton } from "../../../components/ui/CopyButton"
import { Input } from "../../../components/ui/Input"
import type { PictureFailures } from "../store/publishEmbed"

export const LINKED_PICTURE_LABEL = "Linked picture (experimental)"
export const LINKED_PICTURE_HELP =
	"Link either in PowerPoint (Insert → Pictures → paste the link → Insert and Link); it refreshes when the deck is opened. The SVG stays sharp at any zoom and in PDF or print, drawn with the fonts installed on the viewer's machine; the PNG looks the same everywhere."
export const LINKED_PICTURE_RETRY = "Picture didn't publish. Republish to retry."
export const LINKED_PICTURE_PNG = "PNG"
export const LINKED_PICTURE_SVG = "SVG"

/** One picture format's row: its stable url with a copy chip, or the retry
 *  hint (plus the reason this session saw, when it did) if that upload
 *  failed. */
const PictureLink = ({
	format,
	url,
	reason,
}: {
	format: string
	url: string | undefined
	reason: string | undefined
}) => {
	const inputId = useId()
	if (url === undefined) {
		return (
			<div className="flex flex-col gap-1">
				<span className="vc-muted text-xs">{format}</span>
				<p className="vc-help">{LINKED_PICTURE_RETRY}</p>
				{reason !== undefined && <p className="vc-help break-words">{reason}</p>}
			</div>
		)
	}
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={inputId} className="vc-muted text-xs">
				{format}
			</label>
			<div className="relative group/copy">
				<Input
					id={inputId}
					value={url}
					readOnly
					className="w-full font-mono pr-9"
					onFocus={(e) => e.currentTarget.select()}
				/>
				<CopyButton value={url} label={`Copy ${format} link`} ghost />
			</div>
		</div>
	)
}

/** Export modal → Embed tab, under the iframe snippets of a published embed:
 *  the stable urls of the chart pictures published alongside it — the PNG
 *  (`image.png`) and the vector SVG (`image.svg`) — each with a copy chip
 *  (a purple chip inside the field that shows on hover), or a retry hint for
 *  a format whose upload failed, with the failure's reason when this
 *  session saw it. */
export const LinkedPictureRow = ({
	imageUrl,
	vectorUrl,
	failures,
}: {
	/** The PNG picture's url, undefined when that upload failed. */
	imageUrl: string | undefined
	/** The SVG picture's url, undefined when that upload failed. */
	vectorUrl: string | undefined
	/** Why either upload failed, when it failed in this session. */
	failures?: PictureFailures
}) => (
	<div className="flex flex-col gap-2">
		<span className="vc-heading text-sm font-medium">{LINKED_PICTURE_LABEL}</span>
		<PictureLink format={LINKED_PICTURE_PNG} url={imageUrl} reason={failures?.image} />
		<PictureLink format={LINKED_PICTURE_SVG} url={vectorUrl} reason={failures?.vector} />
		{(imageUrl !== undefined || vectorUrl !== undefined) && (
			<p className="vc-help">{LINKED_PICTURE_HELP}</p>
		)}
	</div>
)
