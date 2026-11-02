import { colors } from "./theme.ts";

export const TOKEN_SETTINGS_URL = "https://app.shortcut.com/settings/account/api-tokens";

export const ReadOnlyNotice = () => (
  <box
    position="absolute"
    top={0}
    left={0}
    width="100%"
    height="100%"
    justifyContent="center"
    alignItems="center"
  >
    <box
      border
      borderStyle="rounded"
      borderColor={colors.warning}
      backgroundColor={colors.panel}
      title=" Read-only token "
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
    >
      <text>This token can read Shortcut but not change it, so nothing was sent.</text>
      <text>Moving stories needs a read-write sct_ token.</text>
      <text fg={colors.dim}>{`Create one at ${TOKEN_SETTINGS_URL}`}</text>
      <text fg={colors.dim}>and put it in .env.local as SHORTCUT_API_TOKEN.</text>
    </box>
  </box>
);
