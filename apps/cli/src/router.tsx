import { createMemoryRouter } from "react-router";
import { routes } from "./routes";
import { HomeRoute } from "./routes/home";
import { AboutRoute } from "./routes/about";
import { SettingsRoute } from "./routes/settings";
import { LlmRoute } from "./routes/llm";
import { NotFoundRoute } from "./routes/not-found";

export function createAppRouter() {
  return createMemoryRouter([
    { path: routes.home, element: <HomeRoute /> },
    { path: routes.about, element: <AboutRoute /> },
    { path: routes.settings, element: <SettingsRoute /> },
    { path: routes.llm, element: <LlmRoute /> },
    { path: "*", element: <NotFoundRoute /> },
  ]);
}
