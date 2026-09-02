export const routes = {
  home: "/",
  about: "/about",
  settings: "/settings",
  llm: "/llm",
} as const;

export type RouteName = keyof typeof routes;

export function isRoutePath(value: string): value is (typeof routes)[RouteName] {
  return (Object.values(routes) as string[]).includes(value);
}
