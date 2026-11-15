import type { ScrollBoxRenderable } from "@opentui/core";
import { changesOf } from "../app/glance.ts";
import type { Change, Model, SearchResults, View } from "../app/model.ts";
import { groupingOf, isReviewView, type Grouping } from "../app/filters.ts";
import { rowsOf } from "../app/rows.ts";
import { showsCachedList } from "../app/startup.ts";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import { storyCount } from "./format.ts";
import { storyPullRequests } from "./pull-requests.ts";
import { StoryDetailPane } from "./StoryDetailPane.tsx";
import { StoryList } from "./StoryList.tsx";
import { Splitter } from "./Splitter.tsx";
import { colors } from "./theme.ts";

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
            cached={showsCachedList(model)}
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

export type BodyProps = {
  model: Model;
  now: Date;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  unseen: ReadonlyMap<StoryId, readonly Change[]>;
  listWidth: number;
  onSelect: (id: StoryId) => void;
  onResize: (column: number) => void;
};

const noMatch = (view: View): { headline: string; hint: string } => {
  switch (view.kind) {
    case "query":
    case "inReview":
      return { headline: "No stories match", hint: "Press / to change the query or r to refresh" };
    case "mergedNotMoved":
      return {
        headline: "Nothing merged and left open",
        hint: "No started story has only merged or closed pull requests",
      };
  }
};

const Rows = (props: BodyProps & { results: SearchResults }) => {
  const { results, model } = props;
  const rows = rowsOf(model, results);
  switch (rows.status) {
    case "checking":
      return (
        <Centered
          headline={`Checking ${storyCount(rows.searched)}' pull requests…`}
          hint="Asking GitHub which are merged"
          color={colors.accent}
        />
      );
    case "unchecked":
      return (
        <Centered
          headline="Could not check pull requests"
          hint="This filter needs GitHub through gh  ·  press r to retry"
          color={colors.error}
        />
      );
    case "shown":
      return rows.stories.length === 0 ? (
        <Centered {...noMatch(results.question.view)} color={colors.dim} />
      ) : (
        <Browser
          {...props}
          stories={rows.stories}
          grouping={groupingOf(results.question.view)}
          reviewing={isReviewView(results.question.view)}
        />
      );
  }
};

const Results = (props: BodyProps) => {
  const { results } = props.model;
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
      return <Rows {...props} results={results.value} />;
  }
};

export const Body = (props: BodyProps) => {
  const { workspace } = props.model;
  if (showsCachedList(props.model)) return <Results {...props} />;
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
