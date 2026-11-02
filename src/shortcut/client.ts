import type { ZodType } from "zod";
import {
  MeSchema,
  MembersSchema,
  SearchStoriesSchema,
  StoryDetailSchema,
  WorkflowsSchema,
} from "./schemas.ts";
import type {
  Member,
  MemberId,
  ShortcutClient,
  StoryId,
  WorkflowState,
  WorkflowStateId,
} from "./types.ts";

export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export type ClientOptions = {
  token: string;
  baseUrl?: string;
  fetch?: Fetch;
};

const DEFAULT_BASE_URL = "https://api.app.shortcut.com";
const SEARCH_PAGE_SIZE = "25";

const indexBy = <K, V>(items: readonly V[], key: (item: V) => K): ReadonlyMap<K, V> =>
  new Map(items.map((item) => [key(item), item]));

export const createShortcutClient = ({
  token,
  baseUrl = DEFAULT_BASE_URL,
  fetch: fetchImpl = fetch,
}: ClientOptions): ShortcutClient => {
  const get = async <T>(path: string, schema: ZodType<T>, query?: URLSearchParams): Promise<T> => {
    const search = query === undefined ? "" : `?${query.toString()}`;
    const response = await fetchImpl(`${baseUrl}${path}${search}`, {
      headers: { "Shortcut-Token": token, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Shortcut API ${response.status} ${response.statusText} for GET ${path}`);
    }
    return schema.parse(await response.json());
  };

  return {
    async loadWorkspace() {
      const [me, members, states] = await Promise.all([
        get("/api/v3/member", MeSchema),
        get("/api/v3/members", MembersSchema),
        get("/api/v3/workflows", WorkflowsSchema),
      ]);
      const memberMap: ReadonlyMap<MemberId, Member> = indexBy(members, (member) => member.id);
      const stateMap: ReadonlyMap<WorkflowStateId, WorkflowState> = indexBy(
        states,
        (state) => state.id,
      );
      return { me, members: memberMap, workflowStates: stateMap };
    },

    searchStories(query: string) {
      return get(
        "/api/v3/search/stories",
        SearchStoriesSchema,
        new URLSearchParams({ query, page_size: SEARCH_PAGE_SIZE, detail: "full" }),
      );
    },

    getStory(id: StoryId) {
      return get(`/api/v3/stories/${id}`, StoryDetailSchema);
    },
  };
};
