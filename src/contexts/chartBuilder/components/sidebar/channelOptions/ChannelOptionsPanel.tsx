import { CHANNEL_PANELS } from "./channelPanels"
import type { EncodingChannel } from "../../../lib/types"

type Props = {
	channel: EncodingChannel
}

export const ChannelOptionsPanel = ({ channel }: Props) => {
	const Panel = CHANNEL_PANELS[channel]
	return <Panel />
}
