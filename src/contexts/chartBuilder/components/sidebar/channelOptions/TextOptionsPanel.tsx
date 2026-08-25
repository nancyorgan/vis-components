/** Placeholder panel for the legacy `text` channel.
 *
 *  The channel is filtered out by `HIDDEN_FROM_MAIN_SHELF` in
 *  EncodingShelves, which is the only path that renders a channel's options
 *  panel — so this is never shown. It exists solely because the
 *  `CHANNEL_PANELS` registry requires a total mapping over `EncodingChannel`
 *  (same reason as `OutlineColorOptionsPanel`).
 *
 *  The full text-channel panel (font/color/palette controls) was removed as
 *  unreachable dead code; data labels are configured through
 *  `DataLabelsEncodings` instead. If the channel is ever un-hidden, rebuild
 *  the panel rather than restoring the old one. */
export const TextOptionsPanel = () => null
