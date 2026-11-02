import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef } from "react";
import type { Model, Msg } from "../app/model.ts";
import type { StorySummary } from "../shortcut/types.ts";
import { storyCount } from "./format.ts";
import { StoryDetailPane } from "./StoryDetailPane.tsx";
import { HelpOverlay } from "./HelpOverlay.tsx";
import { bindingFor, hintFor } from "./keys.ts";
import { pullRequestToOpen, storyPullRequests } from "./pull-requests.ts";
import { StoryList } from "./StoryList.tsx";
import { colors } from "./theme.ts";

type Props = {
  model: Model;
  dispatch: (msg: Msg) => void;
  quit: () => void;
  openUrl: (url: string) => void;
};

const LIST_WIDTH_RATIO = 0.55;
const MIN_LIST_WIDTH = 52;

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

export const App = ({ model, dispatch, quit, openUrl }: Props) => {
  const { width } = useTerminalDimensions();
  const detailScroll = useRef<ScrollBoxRenderable>(null);
  const listWidth = Math.min(width, Math.max(MIN_LIST_WIDTH, Math.floor(width * LIST_WIDTH_RATIO)));
  const editing = model.focus.mode === "editingQuery";

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
      <box height={1} paddingLeft={1} backgroundColor={colors.selection}>
        <text fg={colors.dim}>
          {editing ? "enter search  ·  esc cancel" : hintFor(model.focus.mode)}
        </text>
      </box>
      {model.focus.mode === "help" && <HelpOverlay />}
    </box>
  );
};
