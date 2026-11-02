import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef } from "react";
import type { Model, Msg } from "../app/model.ts";
import { pickerStates } from "../app/update.ts";
import type { StorySummary } from "../shortcut/types.ts";
import { ageLabel, storyCount } from "./format.ts";
import { StoryDetailPane } from "./StoryDetailPane.tsx";
import { HelpOverlay } from "./HelpOverlay.tsx";
import { bindingFor, hintFor } from "./keys.ts";
import { MovePicker } from "./MovePicker.tsx";
import { pullRequestToOpen, pullRequestTrouble, storyPullRequests } from "./pull-requests.ts";
import { ReadOnlyNotice } from "./ReadOnlyNotice.tsx";
import { StoryList } from "./StoryList.tsx";
import { colors } from "./theme.ts";

type Props = {
  model: Model;
  now: Date;
  dispatch: (msg: Msg) => void;
  quit: () => void;
  openUrl: (url: string) => void;
};

const LIST_WIDTH_RATIO = 0.55;
const MIN_LIST_WIDTH = 52;
const STATUS_BAR_PADDING = 2;
const STATUS_BAR_GAP = 2;

const Centered = ({ headline, hint, color }: { headline: string; hint: string; color: string }) => (
  <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
    <text fg={color}>
      <b>{headline}</b>
    </text>
    <text fg={colors.dim}>{hint}</text>
  </box>
);

const Browser = ({
  model,
  stories,
  scrollRef,
  listWidth,
}: {
  model: Model;
  stories: readonly StorySummary[];
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  listWidth: number;
}) => {
  const selected = stories.find((story) => story.id === model.selectedStoryId) ?? null;
  return (
    <box flexGrow={1} flexDirection="row">
      <box width={listWidth} flexDirection="column" backgroundColor={colors.background}>
        <StoryList
          stories={stories}
          selectedId={model.selectedStoryId}
          pullRequests={model.pullRequests}
          moves={model.moves}
          width={listWidth}
        />
      </box>
      <box
        flexGrow={1}
        flexDirection="column"
        backgroundColor={colors.panel}
        border={["left"]}
        borderColor={colors.dim}
      >
        {selected === null ? (
          <Centered headline="No story selected" hint="Pick one from the list" color={colors.dim} />
        ) : (
          <StoryDetailPane
            summary={selected}
            detail={model.details.get(selected.id)}
            pullRequests={storyPullRequests(selected, model.pullRequests)}
            scrollRef={scrollRef}
          />
        )}
      </box>
    </box>
  );
};

const Body = (props: {
  model: Model;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  listWidth: number;
}) => {
  const { model } = props;
  if (model.workspace.status === "failed") {
    return (
      <Centered
        headline="Could not load your workspace"
        hint={`${model.workspace.message}  ·  press r to retry`}
        color={colors.error}
      />
    );
  }
  const { results } = model;
  switch (results.status) {
    case "loading":
      return <Centered headline="Loading stories…" hint="Asking Shortcut" color={colors.accent} />;
    case "failed":
      return (
        <Centered
          headline="Search failed"
          hint={`${results.message}  ·  press r to retry or / to change the query`}
          color={colors.error}
        />
      );
    case "loaded":
      return results.value.stories.length === 0 ? (
        <Centered
          headline="No stories match"
          hint="Press / to change the query or r to refresh"
          color={colors.dim}
        />
      ) : (
        <Browser {...props} stories={results.value.stories} />
      );
  }
};

const status = ({ results }: Model): { text: string; color: string } => {
  switch (results.status) {
    case "loading":
      return { text: "loading…", color: colors.accent };
    case "failed":
      return { text: "error", color: colors.error };
    case "loaded":
      return { text: storyCount(results.value.stories.length), color: colors.ok };
  }
};

const bottomBar = (
  model: Model,
  selectedStory: StorySummary | undefined,
): { text: string; color: string } => {
  const move = selectedStory === undefined ? undefined : model.moves.get(selectedStory.id);
  if (model.focus.mode === "browsing" && move?.status === "failed") {
    return { text: `✗ Move failed  ·  m to retry  ·  ${move.message}`, color: colors.error };
  }
  const trouble = model.focus.mode === "browsing" ? pullRequestTrouble(model.pullRequests) : null;
  if (trouble !== null) return { text: `✗ ${trouble}  ·  r to retry`, color: colors.warning };
  return {
    text:
      model.focus.mode === "editingQuery"
        ? "enter search  ·  esc cancel"
        : hintFor(model.focus.mode),
    color: colors.dim,
  };
};

const freshness = (model: Model, now: Date, room: number): string | null => {
  if (model.results.status !== "loaded" || model.loadedAt === null) return null;
  const label = `↻ ${ageLabel(model.loadedAt, now)}`;
  return label.length + STATUS_BAR_GAP <= room ? label : null;
};

const Overlay = ({ model, height }: { model: Model; height: number }) => {
  const { focus } = model;
  switch (focus.mode) {
    case "browsing":
    case "editingQuery":
      return null;
    case "help":
      return <HelpOverlay />;
    case "readOnly":
      return <ReadOnlyNotice />;
    case "picking": {
      const story =
        model.results.status === "loaded"
          ? model.results.value.stories.find((candidate) => candidate.id === focus.storyId)
          : undefined;
      if (story === undefined || model.workspace.status !== "loaded") return null;
      return (
        <MovePicker
          story={story}
          states={pickerStates(model.workspace.value, story)}
          cursor={focus.cursor}
          height={height}
        />
      );
    }
  }
};

export const App = ({ model, now, dispatch, quit, openUrl }: Props) => {
  const { width, height } = useTerminalDimensions();
  const detailScroll = useRef<ScrollBoxRenderable>(null);
  const listWidth = Math.min(width, Math.max(MIN_LIST_WIDTH, Math.floor(width * LIST_WIDTH_RATIO)));

  const selectedStory =
    model.results.status === "loaded"
      ? model.results.value.stories.find((story) => story.id === model.selectedStoryId)
      : undefined;

  useKeyboard((key) => {
    const action = bindingFor(model.focus.mode, key)?.action;
    if (action === undefined) return;
    switch (action.type) {
      case "quit":
        return quit();
      case "dispatch":
        return dispatch(action.msg);
      case "scrollDetail":
        return detailScroll.current?.scrollBy(action.viewports, "viewport");
      case "openStory":
        if (selectedStory) openUrl(selectedStory.appUrl);
        return;
      case "openPullRequest": {
        const pullRequest = selectedStory
          ? pullRequestToOpen(selectedStory, model.pullRequests)
          : null;
        if (pullRequest) openUrl(pullRequest.url);
        return;
      }
    }
  });

  const { text, color } = status(model);
  const bottom = bottomBar(model, selectedStory);
  const age = freshness(model, now, width - STATUS_BAR_PADDING - bottom.text.length);
  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.background}>
      <box
        height={1}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={colors.selection}
      >
        <text fg={colors.accent}>
          <b>Shortcut</b>
        </text>
        <text fg={colors.dim}>{"  /  "}</text>
        {model.focus.mode === "editingQuery" ? (
          <input
            focused
            flexGrow={1}
            value={model.focus.draft}
            placeholder="search stories"
            onInput={(draft) => dispatch({ type: "queryDraftChanged", draft })}
            onSubmit={() => dispatch({ type: "querySubmitted" })}
          />
        ) : (
          <text flexGrow={1} fg={colors.text}>
            {model.query === "" ? "all stories" : model.query}
          </text>
        )}
        <text fg={color}>{text}</text>
      </box>
      <Body model={model} scrollRef={detailScroll} listWidth={listWidth} />
      <box
        height={1}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={colors.selection}
      >
        <text flexGrow={1} wrapMode="none" fg={bottom.color}>
          {bottom.text}
        </text>
        {age === null ? null : <text fg={colors.dim}>{age}</text>}
      </box>
      <Overlay model={model} height={height} />
    </box>
  );
};
