import { hintFor } from "./keys.ts";
import { colors } from "./theme.ts";

const unsavedLine = (saving: number): string =>
  saving === 1
    ? "A move is still saving and may not reach Shortcut."
    : `${String(saving)} moves are still saving and may not reach Shortcut.`;

export const QuitConfirm = ({ saving }: { saving: number }) => (
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
      borderColor={saving === 0 ? colors.accent : colors.warning}
      backgroundColor={colors.panel}
      title=" Quit "
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
    >
      <text>Are you sure you want to quit?</text>
      {saving === 0 ? null : <text fg={colors.warning}>{unsavedLine(saving)}</text>}
      <text fg={colors.dim}>{hintFor("confirmingQuit")}</text>
    </box>
  </box>
);
