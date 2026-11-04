import type { ScrollBoxRenderable } from "@opentui/core";
import type { Ref } from "react";
import type { Change, PullRequestView, Remote } from "../app/model.ts";
import type { StoryMergeStatus } from "../github/pull-request-state.ts";
import { reloadFailure } from "../app/remote.ts";
import type { StoryDetail, StorySummary } from "../shortcut/types.ts";
import { dateLabel, epicName, estimateLabel, ownerNames, typeStyle } from "./format.ts";
import { badgeStyle, type StoryPullRequestList } from "./pull-requests.ts";
import { colors } from "./theme.ts";

type Props = {
  summary: StorySummary;
  detail: Remote<StoryDetail> | undefined;
  pullRequests: StoryPullRequestList | null;
  changes: readonly Change[];
  scrollRef: Ref<ScrollBoxRenderable>;
};

const mergeStatusLabel = (status: StoryMergeStatus): string =>
  status === "none" ? "none" : badgeStyle[status].description;

const changeLabel = (change: Change): string => {
  switch (change.kind) {
    case "new":
      return "new in this list";
    case "state":
      return `state ${change.from.name} → ${change.to.name}`;
    case "pullRequests":
      return `pull requests ${mergeStatusLabel(change.from)} → ${mergeStatusLabel(change.to)}`;
    case "edited":
      return "edited";
  }
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <text wrapMode="word">
    <span fg={colors.dim}>{label.padEnd(10)}</span>
    {value}
  </text>
);

const PullRequestItem = ({ pullRequest }: { pullRequest: PullRequestView }) => {
  const { glyph, description, color } = badgeStyle[pullRequest.state];
  const { url, github } = pullRequest;
  return (
    <box marginTop={1} flexDirection="column">
      <text wrapMode="word">
        <b>{github === null ? <a href={url}>{url}</a> : `#${github.number}`}</b>
        <span fg={color}>{`  ${glyph} ${description}`}</span>
      </text>
      <text wrapMode="word">{pullRequest.title}</text>
      {github === null ? null : (
        <text wrapMode="word">
          <a href={url}>{url}</a>
        </text>
      )}
    </box>
  );
};

const PullRequestStatus = ({ pullRequests }: { pullRequests: StoryPullRequestList }) => {
  switch (pullRequests.status) {
    case "checking":
      return <text fg={colors.dim}>checking GitHub…</text>;
    case "failed":
      return (
        <box flexDirection="column">
          <text wrapMode="word" fg={colors.warning}>
            {pullRequests.message}
          </text>
          <text fg={colors.dim}>press r to retry</text>
        </box>
      );
    case "loaded":
      return (
        <box flexDirection="column">
          {pullRequests.value.map((pullRequest) => (
            <PullRequestItem key={pullRequest.id} pullRequest={pullRequest} />
          ))}
        </box>
      );
  }
};

const PullRequestSection = ({
  count,
  pullRequests,
}: {
  count: number;
  pullRequests: StoryPullRequestList;
}) => (
  <box marginTop={1} marginBottom={1} flexDirection="column">
    <text fg={colors.accent}>
      <b>{`Pull requests (${pullRequests.status === "loaded" ? pullRequests.value.length : count})`}</b>
    </text>
    <PullRequestStatus pullRequests={pullRequests} />
  </box>
);

const Body = ({ detail }: { detail: StoryDetail }) => (
  <box flexDirection="column">
    <Field label="Labels" value={detail.labels.length === 0 ? "None" : detail.labels.join(", ")} />
    <box marginTop={1} flexDirection="column">
      <text fg={colors.accent}>
        <b>Description</b>
      </text>
      <text wrapMode="word">
        {detail.description.trim() === "" ? "No description." : detail.description}
      </text>
    </box>
    <box marginTop={1} flexDirection="column">
      <text fg={colors.accent}>
        <b>{`Comments (${detail.comments.length})`}</b>
      </text>
      {detail.comments.map((comment) => (
        <box key={comment.id} marginTop={1} flexDirection="column">
          <text>
            <b>{comment.author?.name ?? "Unknown"}</b>
            <span fg={colors.dim}>{`  ${dateLabel(comment.createdAt)}`}</span>
          </text>
          <text wrapMode="word">{comment.text}</text>
        </box>
      ))}
    </box>
  </box>
);

const Note = ({ text, color }: { text: string; color: string }) => (
  <box marginTop={1}>
    <text wrapMode="word" fg={color}>
      {text}
    </text>
  </box>
);

const Detail = ({ detail }: { detail: Remote<StoryDetail> | undefined }) => {
  switch (detail?.status) {
    case undefined:
    case "firstLoad":
      return <Note text="Loading details…" color={colors.dim} />;
    case "failed":
      return <Note text={`Could not load details: ${detail.message}`} color={colors.error} />;
    case "loaded": {
      const failure = reloadFailure(detail);
      return (
        <box flexDirection="column">
          {failure === null ? null : (
            <Note
              text={`Could not refresh details: ${failure}  ·  r to retry`}
              color={colors.warning}
            />
          )}
          <Body detail={detail.value} />
        </box>
      );
    }
  }
};

export const StoryDetailPane = ({ summary, detail, pullRequests, changes, scrollRef }: Props) => {
  const { glyph, color } = typeStyle[summary.storyType];
  return (
    <scrollbox ref={scrollRef} flexGrow={1} scrollY paddingLeft={1} paddingRight={1}>
      <text wrapMode="word" fg={colors.textBright}>
        <b>{summary.name}</b>
      </text>
      {changes.length === 0 ? null : (
        <Note
          text={`Changed since you last looked: ${changes.map(changeLabel).join(" · ")}`}
          color={colors.accent}
        />
      )}
      <box marginTop={1} flexDirection="column">
        <text>
          <span fg={colors.dim}>{"Type".padEnd(10)}</span>
          <span fg={color}>{`${glyph} ${summary.storyType}`}</span>
        </text>
        <Field label="State" value={summary.state.name} />
        <Field label="Estimate" value={estimateLabel(summary.estimate)} />
        <Field label="Owners" value={ownerNames(summary.owners)} />
        <Field label="Epic" value={epicName(summary.epic)} />
        <text wrapMode="word">
          <span fg={colors.dim}>{"URL".padEnd(10)}</span>
          <a href={summary.appUrl}>{summary.appUrl}</a>
        </text>
      </box>
      {pullRequests === null ? null : (
        <PullRequestSection count={summary.pullRequestCount} pullRequests={pullRequests} />
      )}
      <Detail detail={detail} />
    </scrollbox>
  );
};
