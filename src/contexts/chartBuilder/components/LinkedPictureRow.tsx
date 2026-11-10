import { useId } from "react"

import { CopyButton } from "../../../components/ui/CopyButton"
import { Input } from "../../../components/ui/Input"
import type { PictureFailures } from "../store/publishEmbed"

export const LINKED_PICTURE_RETRY = "Picture didn't publish. Republish to retry."
export const LINKED_PICTURE_SVG = "SVG"
export const LINKED_PICTURE_PNG = "PNG"

/** One picture format's row: its stable url with a copy chip, or the
 *  retry hint (plus the reason this session saw, when it did) if that
 *  upload failed. */
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
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={inputId} className="vc-heading text-sm font-medium">
				{format}
			</label>
			{url === undefined ? (
				<>
					<p className="vc-help">{LINKED_PICTURE_RETRY}</p>
					{reason !== undefined && <p className="vc-help break-words">{reason}</p>}
				</>
			) : (
				<div className="relative group/copy">
					{/* font-[400] is DM Mono's true Regular: the UI's 450 body
					    weight (and its remapped font-normal, 500) would pick
					    DM Mono Medium, which reads as bold. */}
					<Input
						id={inputId}
						value={url}
						readOnly
						className="w-full font-mono font-[400] pr-9"
						onFocus={(e) => e.currentTarget.select()}
					/>
					<CopyButton value={url} label={`Copy ${format} link`} ghost />
				</div>
			)}
		</div>
	)
}

/** Export dialog → Publish → Slides & documents: the stable urls of the
 *  chart pictures published alongside the HTML — the vector SVG
 *  (`image.svg`) first, then the PNG (`image.png`) — each with a copy chip
 *  (a purple chip inside the field that shows on hover), or a retry hint
 *  for a format whose upload failed, with the failure's reason when this
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
	<div className="flex flex-col gap-3">
		<PictureLink
			format={LINKED_PICTURE_SVG}
			url={vectorUrl}
			reason={failures?.vector}
		/>
		<PictureLink
			format={LINKED_PICTURE_PNG}
			url={imageUrl}
			reason={failures?.image}
		/>
	</div>
)
