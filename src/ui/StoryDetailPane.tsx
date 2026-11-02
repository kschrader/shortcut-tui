import type { ScrollBoxRenderable } from "@opentui/core";
import type { Ref } from "react";
import type { Remote } from "../app/model.ts";
import type { StoryDetail, StorySummary, Workspace } from "../shortcut/types.ts";
import {
  dateLabel,
  estimateLabel,
  memberName,
  ownerNames,
  stateName,
  typeStyle,
} from "./format.ts";
import { colors } from "./theme.ts";

type Props = {
  summary: StorySummary;
  detail: Remote<StoryDetail> | undefined;
  workspace: Workspace | null;
  scrollRef: Ref<ScrollBoxRenderable>;
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <text wrapMode="word">
    <span fg={colors.dim}>{label.padEnd(10)}</span>
    {value}
  </text>
);

const Body = ({ detail, workspace }: { detail: StoryDetail; workspace: Workspace | null }) => (
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
            <b>{memberName(workspace, comment.authorId)}</b>
            <span fg={colors.dim}>{`  ${dateLabel(comment.createdAt)}`}</span>
          </text>
          <text wrapMode="word">{comment.text}</text>
        </box>
      ))}
    </box>
  </box>
);

export const StoryDetailPane = ({ summary, detail, workspace, scrollRef }: Props) => {
  const { glyph, color } = typeStyle[summary.storyType];
  return (
    <scrollbox ref={scrollRef} flexGrow={1} scrollY paddingLeft={1} paddingRight={1}>
      <text wrapMode="word" fg={colors.textBright}>
        <b>{summary.name}</b>
      </text>
      <box marginTop={1} flexDirection="column">
        <text>
          <span fg={colors.dim}>{"Type".padEnd(10)}</span>
          <span fg={color}>{`${glyph} ${summary.storyType}`}</span>
        </text>
        <Field label="State" value={stateName(workspace, summary.workflowStateId)} />
        <Field label="Estimate" value={estimateLabel(summary.estimate)} />
        <Field label="Owners" value={ownerNames(workspace, summary)} />
        <Field label="URL" value={summary.appUrl} />
      </box>
      {detail?.status === "loaded" ? <Body detail={detail.value} workspace={workspace} /> : null}
      {detail === undefined || detail.status === "loading" ? (
        <box marginTop={1}>
          <text fg={colors.dim}>Loading details…</text>
        </box>
      ) : null}
      {detail?.status === "failed" ? (
        <box marginTop={1}>
          <text fg={colors.error}>{`Could not load details: ${detail.message}`}</text>
        </box>
      ) : null}
    </scrollbox>
  );
};
