type Focus = { mode: "browsing" } | { mode: "editing"; draft: string };
type Msg = { type: "typed"; draft: string } | { type: "submitted" };

export const update = (focus: Focus, msg: Msg): Focus => {
  switch (msg.type) {
    case "typed": {
      if (focus.mode !== "editing") return focus;
      return { mode: "editing", draft: msg.draft };
    }
    case "submitted": {
      if (focus.mode !== "editing") return focus;
      return { mode: "browsing" };
    }
  }
};
