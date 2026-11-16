export const viewerArgs = (login: string): string[] => [
  "api",
  "graphql",
  "-f",
  `query=query { user(login: "${login}") { name } }`,
];
