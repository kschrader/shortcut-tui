type Comment = { type: "Line" | "Block" | "Shebang"; value: string };

export const visible = (comments: readonly Comment[]) => {
  const kept: Comment[] = [];
  for (const comment of comments) {
    if (comment.type === "Shebang") continue;
    kept.push(comment);
  }
  return kept;
};
