import { bindingsUsableIn } from "./keys.ts";
import { BADGE_LABEL_WIDTH, badgeStyle } from "./pull-requests.ts";
import { colors } from "./theme.ts";

const browsingBindings = bindingsUsableIn("browsing");

const KEY_LABEL_WIDTH = Math.max(...browsingBindings.map((binding) => binding.label.length));

const mouseActions = [
  { label: "click", description: "Select the story" },
  { label: "drag │", description: "Resize the panes" },
];

export const HelpOverlay = () => (
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
      borderColor={colors.accent}
      backgroundColor={colors.panel}
      title=" Help "
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexDirection="row" gap={3}>
        <box flexDirection="column">
          <text fg={colors.dim}>Keys</text>
          {browsingBindings.map((binding) => (
            <text key={`${String(binding.modes)} ${binding.label}`}>
              <span fg={colors.accent}>{binding.label.padEnd(KEY_LABEL_WIDTH)}</span>
              {`  ${binding.description}`}
            </text>
          ))}
          <text marginTop={1} fg={colors.dim}>
            Mouse
          </text>
          {mouseActions.map((action) => (
            <text key={action.label}>
              <span fg={colors.accent}>{action.label.padEnd(KEY_LABEL_WIDTH)}</span>
              {`  ${action.description}`}
            </text>
          ))}
        </box>
        <box flexDirection="column">
          <text fg={colors.dim}>Pull request badges</text>
          {Object.values(badgeStyle).map((style) => (
            <text key={style.label}>
              <span fg={style.color}>{style.glyph}</span>
              {` ${style.label.padEnd(BADGE_LABEL_WIDTH)}  ${style.description}`}
            </text>
          ))}
        </box>
      </box>
    </box>
  </box>
);
