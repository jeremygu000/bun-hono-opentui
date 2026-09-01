import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { RouterProvider } from "react-router/dom";
import { createAppRouter } from "./router";

const renderer = await createCliRenderer({ exitOnCtrlC: true });
const router = createAppRouter();
createRoot(renderer).render(<RouterProvider router={router} />);
