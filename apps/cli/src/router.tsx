import { createMemoryRouter } from "react-router";
import { routes } from "./routes";
import { HomeRoute } from "./routes/home";
import { AboutRoute } from "./routes/about";
import { SettingsRoute } from "./routes/settings";
import { LlmRoute } from "./routes/llm";
import { LlmTestRoute } from "./routes/llm-test";
import { LlmHybridRoute } from "./routes/llm-hybrid";
import { ChatRoute } from "./routes/chat";
import { NotFoundRoute } from "./routes/not-found";

export function createAppRouter() {
  return createMemoryRouter([
    { path: routes.home, element: <HomeRoute /> },
    { path: routes.about, element: <AboutRoute /> },
    { path: routes.settings, element: <SettingsRoute /> },
    { path: routes.llm, element: <LlmRoute /> },
    { path: routes.llmTest, element: <LlmTestRoute /> },
    { path: routes.llmHybrid, element: <LlmHybridRoute /> },
    { path: routes.chat, element: <ChatRoute /> },
    { path: "*", element: <NotFoundRoute /> },
  ]);
}
