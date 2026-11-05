import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState } from "react";
import { changesOf, unseenChanges } from "../app/glance.ts";
import type { Change, Model, Msg } from "../app/model.ts";
import {
  AGE_FLOOR_LABEL,
  groupingOf,
  isReviewView,
  viewLabel,
  type Grouping,
} from "../app/filters.ts";
import { pickerStates } from "../app/moves.ts";
import { reloadFailure } from "../app/remote.ts";
import { shownStories } from "../app/rows.ts";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import { ageLabel, storyCount } from "./format.ts";
import { StoryDetailPane } from "./StoryDetailPane.tsx";
import { HelpOverlay } from "./HelpOverlay.tsx";
import { bindingFor, hintFor } from "./keys.ts";
import { MovePicker } from "./MovePicker.tsx";
import { pullRequestToOpen, pullRequestTrouble, storyPullRequests } from "./pull-requests.ts";
import { ReadOnlyNotice } from "./ReadOnlyNotice.tsx";
import { awaitsYourReview } from "./reviews.ts";
import { listWidthFor, Splitter } from "./Splitter.tsx";
import { StoryList } from "./StoryList.tsx";
import { colors } from "./theme.ts";

type Props = {
  model: Model;
  now: Date;
  dispatch: (msg: Msg) => void;
  quit: () => void;
  openUrl: (url: string) => void;
  copyText: (text: string) => boolean;
};

type CopyNotice =
  | { kind: "copied"; storyId: StoryId; url: string }
  | { kind: "copyFailed"; storyId: StoryId };

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
  now,
  stories,
  grouping,
  reviewing,
  scrollRef,
  unseen,
  listWidth,
  onSelect,
  onResize,
}: {
  model: Model;
  now: Date;
  stories: readonly StorySummary[];
  grouping: Grouping;
  reviewing: boolean;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  unseen: ReadonlyMap<StoryId, readonly Change[]>;
  listWidth: number;
  onSelect: (id: StoryId) => void;
  onResize: (column: number) => void;
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
          unseen={unseen}
          grouping={grouping}
          reviewing={reviewing}
          now={now}
          width={listWidth}
          onSelect={onSelect}
        />
      </box>
      <Splitter onDrag={onResize} />
      <box flexGrow={1} flexDirection="column" backgroundColor={colors.panel}>
        {selected === null ? (
          <Centered headline="No story selected" hint="Pick one from the list" color={colors.dim} />
        ) : (
          <StoryDetailPane
            summary={selected}
            detail={model.details.get(selected.id)}
            pullRequests={storyPullRequests(selected, model.pullRequests)}
            changes={changesOf(model, selected.id)}
            now={now}
            scrollRef={scrollRef}
          />
        )}
      </box>
    </box>
  );
};

type BodyProps = {
  model: Model;
  now: Date;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  unseen: ReadonlyMap<StoryId, readonly Change[]>;
  listWidth: number;
  onSelect: (id: StoryId) => void;
  onResize: (column: number) => void;
};

const Results = (props: BodyProps) => {
  const { results } = props.model;
  const stories = shownStories(props.model);
  switch (results.status) {
    case "firstLoad":
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
      return stories.length === 0 ? (
        <Centered
          headline="No stories match"
          hint="Press / to change the query or r to refresh"
          color={colors.dim}
        />
      ) : (
        <Browser
          {...props}
          stories={stories}
          grouping={groupingOf(results.value.question.view)}
          reviewing={isReviewView(results.value.question.view)}
        />
      );
  }
};

const Body = (props: BodyProps) => {
  const { workspace } = props.model;
  switch (workspace.status) {
    case "firstLoad":
      return <Centered headline="Loading…" hint="Connecting to Shortcut" color={colors.accent} />;
    case "failed":
      return (
        <Centered
          headline="Could not load your workspace"
          hint={`${workspace.message}  ·  press r to retry`}
          color={colors.error}
        />
      );
    case "loaded":
      return <Results {...props} />;
  }
};

type Status = { text: string; color: string };

const loadingStatus: Status = { text: "loading…", color: colors.accent };

const errorStatus: Status = { text: "error", color: colors.error };

const resultsStatus = (model: Model): Status => {
  const { results } = model;
  switch (results.status) {
    case "firstLoad":
      return loadingStatus;
    case "failed":
      return errorStatus;
    case "loaded": {
      const text = storyCount(shownStories(model).length);
      switch (results.reload.status) {
        case "inFlight":
          return loadingStatus;
        case "failed":
          return { text, color: colors.warning };
        case "idle":
          return { text, color: colors.ok };
      }
    }
  }
};

const status = (model: Model): Status => {
  switch (model.workspace.status) {
    case "firstLoad":
      return loadingStatus;
    case "failed":
      return errorStatus;
    case "loaded":
      return resultsStatus(model);
  }
};

const queryLabel = ({ workspace, question }: Model): string => {
  switch (workspace.status) {
    case "firstLoad":
    case "failed":
      return "";
    case "loaded":
      return viewLabel(question.view, workspace.value);
  }
};

const copyNoticeBar = (notice: CopyNotice): { text: string; color: string } => {
  switch (notice.kind) {
    case "copied":
      return { text: `✓ Copied ${notice.url}`, color: colors.ok };
    case "copyFailed":
      return {
        text: "✗ Could not copy: this terminal has no clipboard access",
        color: colors.warning,
      };
  }
};

const bottomBar = (
  model: Model,
  selectedStory: StorySummary | undefined,
  copyNotice: CopyNotice | null,
): { text: string; color: string } => {
  if (copyNotice !== null && copyNotice.storyId === selectedStory?.id) {
    return copyNoticeBar(copyNotice);
  }
  const move = selectedStory === undefined ? undefined : model.moves.get(selectedStory.id);
  if (model.focus.mode === "browsing" && move?.status === "failed") {
    return { text: `✗ Move failed  ·  m to retry  ·  ${move.message}`, color: colors.error };
  }
  const refreshFailed = model.focus.mode === "browsing" ? reloadFailure(model.results) : null;
  if (refreshFailed !== null) {
    return { text: `✗ Refresh failed  ·  r to retry  ·  ${refreshFailed}`, color: colors.warning };
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

const yourReviewCount = (model: Model): number =>
  isReviewView(model.question.view)
    ? shownStories(model).filter((story) => awaitsYourReview(story, model.pullRequests)).length
    : 0;

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
      const story = shownStories(model).find((candidate) => candidate.id === focus.storyId);
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

export const App = ({ model, now, dispatch, quit, openUrl, copyText }: Props) => {
  const { width, height } = useTerminalDimensions();
  const detailScroll = useRef<ScrollBoxRenderable>(null);
  const [copyNotice, setCopyNotice] = useState<CopyNotice | null>(null);
  const [draggedListWidth, setDraggedListWidth] = useState<number | null>(null);
  const listWidth = listWidthFor(width, draggedListWidth);

  const selectedStory = shownStories(model).find((story) => story.id === model.selectedStoryId);

  useKeyboard((key) => {
    setCopyNotice(null);
    const action = bindingFor(model.focus.mode, key)?.action;
    if (action === undefined) return;
    switch (action.type) {
      case "quit":
        return quit();
      case "dispatch":
        return dispatch(action.msg);
      case "toggleAgeFloor":
        return dispatch({ type: "ageFloorToggled", at: now });
      case "scrollDetail":
        return detailScroll.current?.scrollBy(action.viewports, "viewport");
      case "openStory":
        if (selectedStory) openUrl(selectedStory.appUrl);
        return;
      case "copyStoryLink": {
        if (!selectedStory) return;
        const { id: storyId, appUrl: url } = selectedStory;
        setCopyNotice(
          copyText(url) ? { kind: "copied", storyId, url } : { kind: "copyFailed", storyId },
        );
        return;
      }
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
  const unseen = unseenChanges(model);
  const forYou = yourReviewCount(model);
  const bottom = bottomBar(model, selectedStory, copyNotice);
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
        <text flexShrink={0} fg={colors.accent}>
          <b>Shortcut</b>
        </text>
        <text flexShrink={0} fg={colors.dim}>
          {"  /  "}
        </text>
        <box flexGrow={1} flexShrink={1} flexDirection="row">
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
            <text flexShrink={1} wrapMode="none" fg={colors.text}>
              {queryLabel(model)}
            </text>
          )}
          {model.question.movedOnOrBefore === null ? null : (
            <text flexShrink={0} fg={colors.accent}>{`  · ${AGE_FLOOR_LABEL}`}</text>
          )}
        </box>
        <text flexShrink={0} marginLeft={2} fg={color}>
          {text}
        </text>
        {unseen.size === 0 ? null : (
          <text flexShrink={0} fg={colors.accent}>{`  ·  ${String(unseen.size)} updated`}</text>
        )}
        {forYou === 0 ? null : (
          <text flexShrink={0} fg={colors.accent}>{`  ·  ${String(forYou)} for you`}</text>
        )}
      </box>
      <Body
        model={model}
        now={now}
        scrollRef={detailScroll}
        unseen={unseen}
        listWidth={listWidth}
        onSelect={(storyId) => dispatch({ type: "storyClicked", storyId })}
        onResize={(column) => setDraggedListWidth(listWidthFor(width, column))}
      />
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
