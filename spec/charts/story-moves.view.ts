type Slot = { status: string; rid: number; target: number; pending: number; known: number };
type Request = { kind: string; rid: number; story: number; target: number };
type Vars = {
  m: {
    display: Record<string, number>;
    move: Record<string, Slot>;
    results: { reload: string; rid: number };
  };
  server: Record<string, number>;
  outcome: Record<string, string>;
  network: Request[];
};

const NAMES: Record<number, string> = { 1: "Ready", 2: "In Progress" };
const name = (state: number) => NAMES[state] ?? `state ${state}`;

const unansweredMoves = (v: Vars) =>
  v.network.filter((req) => req.kind === "move" && v.outcome[req.rid] === "undecided");

const story = (v: Vars) => {
  const slot = v.m.move[1];
  const shows = name(v.m.display[1]);
  const inFlight = unansweredMoves(v).length;
  switch (slot.status) {
    case "saving": {
      const queued = slot.pending === 0 ? "" : `, ${name(slot.pending)} queued`;
      const both = inFlight > 1 ? `, ${inFlight} moves in flight` : "";
      return `Shows ${shows}, saving ${name(slot.target)}${queued}${both}`;
    }
    case "moved":
      return inFlight > 0
        ? `Moved, shows ${shows}, an older move in flight`
        : `Moved, shows ${shows}`;
    case "failed":
      return `Move failed, shows ${shows}`;
    default:
      return `Shows ${shows}`;
  }
};

const settledLabel = (v: Vars) =>
  unansweredMoves(v).length === 0 && v.m.display[1] !== v.server[1]
    ? ` (Shortcut has ${name(v.server[1])})`
    : "";

export const title = "Moving a story while a refresh can race it";

export const state = (v: Vars) => `${story(v)}${settledLabel(v)}`;

export const group = (v: Vars) => {
  switch (v.m.move[1].status) {
    case "saving":
      return "saving";
    case "failed":
      return "failed";
    default:
      return "settled";
  }
};

export const colors = { saving: "blue", failed: "orange", settled: "teal" };

const answered = (from: Vars, to: Vars) =>
  Object.keys(to.outcome).find(
    (rid) => from.outcome[rid] === "undecided" && to.outcome[rid] !== "undecided",
  );

export const step = (action: string, from: Vars, to: Vars) => {
  if (action === "UserPicks") {
    const picked = name(to.m.display[1]);
    return from.m.move[1].status === "saving"
      ? `you pick ${picked} [while a move saves]`
      : `you pick ${picked}`;
  }
  if (action === "UserSearches") return "a refresh starts";
  const rid = answered(from, to);
  if (rid !== undefined) {
    const target = name(to.network.find((req) => String(req.rid) === rid)?.target ?? 0);
    const verdict =
      to.outcome[rid] === "ok"
        ? `Shortcut confirms the move to ${target}`
        : `Shortcut refuses the move to ${target}`;
    const queuedSent = from.m.move[1].pending !== 0 && to.m.move[1].status === "saving";
    return queuedSent ? `${verdict}, the queued pick is sent` : verdict;
  }
  if (from.m.results.reload === "inFlight" && to.m.results.reload === "idle")
    return "the refresh returns";
  if (from.m.results.reload === "inFlight" && to.m.results.reload === "failed")
    return "the refresh fails";
  return "an old answer arrives again";
};
