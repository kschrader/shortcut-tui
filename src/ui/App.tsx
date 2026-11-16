import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState } from "react";
import { unseenChanges } from "../app/glance.ts";
import type { Model, Msg, Reload } from "../app/model.ts";
import { AGE_FLOOR_LABEL, filters, isReviewView, viewLabel } from "../app/filters.ts";
import { pickerStates } from "../app/moves.ts";
import { awaited, reloadFailure } from "../app/remote.ts";
import { rowsOf, shownStories } from "../app/rows.ts";
import { cachedAt, showsCachedList } from "../app/startup.ts";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import { Body } from "./Body.tsx";
import { ageLabel, storyCount } from "./format.ts";
import { HelpOverlay } from "./HelpOverlay.tsx";
import { bindingFor, hintFor } from "./keys.ts";
import { MovePicker } from "./MovePicker.tsx";
import { pullRequestToOpen, pullRequestTrouble } from "./pull-requests.ts";
import { QuitConfirm } from "./QuitConfirm.tsx";
import { ReadOnlyNotice } from "./ReadOnlyNotice.tsx";
import { awaitsYourReview } from "./reviews.ts";
import { listWidthFor } from "./Splitter.tsx";
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
  | { kind: "copied"; storyId: StoryId; text: string }
  | { kind: "copyFailed"; storyId: StoryId }
  | { kind: "noBranchName"; storyId: StoryId };

const STATUS_BAR_PADDING = 2;
const STATUS_BAR_GAP = 2;

type Status = { text: string; color: string };

const loadingStatus: Status = { text: "loading…", color: colors.accent };

const errorStatus: Status = { text: "error", color: colors.error };

const countStatus = (count: number, reload: Reload): Status => {
  const text = storyCount(count);
  switch (reload.status) {
    case "inFlight":
      return loadingStatus;
    case "failed":
      return { text, color: colors.warning };
    case "idle":
      return { text, color: colors.ok };
  }
};

const resultsStatus = (model: Model): Status => {
  const { results } = model;
  switch (results.status) {
    case "firstLoad":
      return loadingStatus;
    case "failed":
      return errorStatus;
    case "loaded": {
      const rows = rowsOf(model, results.value);
      switch (rows.status) {
        case "checking":
          return loadingStatus;
        case "unchecked":
          return errorStatus;
        case "shown":
          return countStatus(rows.stories.length, results.reload);
      }
    }
  }
};

const cachedStatus = (model: Model, savedAt: Date, now: Date): Status => {
  const loading = model.workspace.status === "firstLoad" || awaited(model.results) !== null;
  const age = `cached ${ageLabel(savedAt, now)}`;
  return { text: loading ? `${age}  ·  ${loadingStatus.text}` : age, color: colors.warning };
};

const status = (model: Model, now: Date): Status => {
  const savedAt = cachedAt(model);
  if (savedAt !== null) return cachedStatus(model, savedAt, now);
  switch (model.workspace.status) {
    case "firstLoad":
      return loadingStatus;
    case "failed":
      return errorStatus;
    case "loaded":
      return resultsStatus(model);
  }
};

const queryLabel = (model: Model): string => {
  const { workspace, question } = model;
  switch (workspace.status) {
    case "firstLoad":
    case "failed":
      return cachedAt(model) === null ? "" : filters[0].label;
    case "loaded":
      return viewLabel(question.view, workspace.value);
  }
};

const copyNoticeBar = (notice: CopyNotice): { text: string; color: string } => {
  switch (notice.kind) {
    case "copied":
      return { text: `✓ Copied ${notice.text}`, color: colors.ok };
    case "copyFailed":
      return {
        text: "✗ Could not copy: this terminal has no clipboard access",
        color: colors.warning,
      };
    case "noBranchName":
      return {
        text: "✗ No branch name: this workspace has no branch name format in Shortcut",
        color: colors.warning,
      };
  }
};

export const READ_ONLY_STARTUP_NOTICE =
  "Read-only token: you can browse, but moving stories needs a read-write token";

const bottomBar = (
  model: Model,
  selectedStory: StorySummary | undefined,
  copyNotice: CopyNotice | null,
  readOnlyNotice: boolean,
): { text: string; color: string } => {
  if (copyNotice !== null && copyNotice.storyId === selectedStory?.id) {
    return copyNoticeBar(copyNotice);
  }
  if (readOnlyNotice) return { text: `! ${READ_ONLY_STARTUP_NOTICE}`, color: colors.warning };
  const move = selectedStory === undefined ? undefined : model.moves.get(selectedStory.id);
  if (model.focus.mode === "browsing" && move?.status === "failed") {
    return { text: `✗ Move failed  ·  m to retry  ·  ${move.message}`, color: colors.error };
  }
  const { workspace } = model;
  if (model.focus.mode === "browsing" && workspace.status === "failed") {
    const text = `✗ Could not load your workspace  ·  r to retry  ·  ${workspace.message}`;
    return { text, color: colors.warning };
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
        : hintFor(model.focus.mode, showsCachedList(model)),
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
    case "confirmingQuit": {
      const saving = [...model.moves.values()].filter((move) => move.status === "saving");
      return <QuitConfirm saving={saving.length} />;
    }
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
  const [readOnlyNoticeDismissed, setReadOnlyNoticeDismissed] = useState(false);
  const readOnlyNotice =
    !readOnlyNoticeDismissed &&
    model.focus.mode === "browsing" &&
    model.workspace.status === "loaded" &&
    !model.workspace.value.canWrite;
  const [draggedListWidth, setDraggedListWidth] = useState<number | null>(null);
  const listWidth = listWidthFor(width, draggedListWidth);

  const selectedStory = shownStories(model).find((story) => story.id === model.selectedStoryId);

  const copy = (storyId: StoryId, text: string): CopyNotice =>
    copyText(text) ? { kind: "copied", storyId, text } : { kind: "copyFailed", storyId };

  useKeyboard((key) => {
    setCopyNotice(null);
    if (readOnlyNotice) setReadOnlyNoticeDismissed(true);
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
      case "copyStoryLink":
        if (selectedStory) setCopyNotice(copy(selectedStory.id, selectedStory.appUrl));
        return;
      case "copyBranchName": {
        if (!selectedStory) return;
        const { id: storyId, branchName } = selectedStory;
        setCopyNotice(
          branchName === null ? { kind: "noBranchName", storyId } : copy(storyId, branchName),
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

  const { text, color } = status(model, now);
  const unseen = unseenChanges(model);
  const forYou = yourReviewCount(model);
  const bottom = bottomBar(model, selectedStory, copyNotice, readOnlyNotice);
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
