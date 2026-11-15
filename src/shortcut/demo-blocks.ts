const BLOCKS: readonly { blocker: number; blocked: number }[] = [
  { blocker: 1018, blocked: 1019 },
  { blocker: 1014, blocked: 1004 },
];

export const blockingOf = (id: number) => ({
  blocked: BLOCKS.some((link) => link.blocked === id),
  blocker: BLOCKS.some((link) => link.blocker === id),
});
