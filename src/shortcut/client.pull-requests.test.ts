import { expect, test } from "bun:test";
import { API, page, stub, at, json, whoamiRoute } from "./api-stub.ts";
import { pullRequestId, storyId } from "./schemas.ts";

const pullRequestJson = (id: number, url: string, overrides: Record<string, unknown> = {}) => ({
  entity_type: "pull-request",
  id,
  title: `Pull request ${id}`,
  closed: false,
  draft: false,
  external_url: url,
  ...overrides,
});

test("listPullRequests reads every page and finds the GitHub pull request behind each link", async () => {
  const path = "/api/v4/acme/stories/42/pull-requests";
  const { client, calls } = stub(
    whoamiRoute,
    at(
      path,
      json(
        page(
          [
            pullRequestJson(1, "https://github.com/exampleco/storefront/pull/3917", {
              title: "Add a toggle",
            }),
            pullRequestJson(2, "https://gitlab.com/acme/app/-/merge_requests/5", {
              closed: true,
            }),
          ],
          `${API}${path}?cursor=p2`,
          3,
        ),
      ),
    ),
    at(
      path,
      json(
        page(
          [pullRequestJson(3, "https://github.com/acme/web.app/pull/12/", { draft: true })],
          null,
          3,
        ),
      ),
      "p2",
    ),
  );

  const pullRequests = await client.listPullRequests(storyId.parse(42));

  expect(pullRequests).toEqual([
    {
      id: pullRequestId.parse(1),
      title: "Add a toggle",
      url: "https://github.com/exampleco/storefront/pull/3917",
      closed: false,
      draft: false,
      github: { owner: "exampleco", repo: "storefront", number: 3917 },
    },
    {
      id: pullRequestId.parse(2),
      title: "Pull request 2",
      url: "https://gitlab.com/acme/app/-/merge_requests/5",
      closed: true,
      draft: false,
      github: null,
    },
    {
      id: pullRequestId.parse(3),
      title: "Pull request 3",
      url: "https://github.com/acme/web.app/pull/12/",
      closed: false,
      draft: true,
      github: { owner: "acme", repo: "web.app", number: 12 },
    },
  ]);
  expect(calls[1]?.url.searchParams.get("limit")).toBe("100");
});

test("a link that only looks like GitHub is not treated as a GitHub pull request", async () => {
  const path = "/api/v4/acme/stories/42/pull-requests";
  const urls = [
    "https://github.com.evil.example/acme/app/pull/1",
    "https://github.com/acme/app/issues/1",
    "https://github.com/acme/app/pull/1#discussion",
    'https://github.com/acme/app"){x}/pull/1',
  ];
  const { client } = stub(
    whoamiRoute,
    at(
      path,
      json(
        page(
          urls.map((url, i) => pullRequestJson(i + 1, url)),
          null,
          urls.length,
        ),
      ),
    ),
  );
  const pullRequests = await client.listPullRequests(storyId.parse(42));
  expect(pullRequests.map((pr) => pr.github)).toEqual([null, null, null, null]);
});
