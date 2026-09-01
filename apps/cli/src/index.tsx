import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";

function WelcomeScreen() {
  const renderer = useRenderer();

  useKeyboard((key) => {
    if (key.name === "q") renderer.destroy();
  });

  return (
    <box
      alignItems="center"
      flexDirection="column"
      height="100%"
      justifyContent="center"
      padding={2}
    >
      <text fg="#00d4ff">Bun + Hono + OpenTUI</text>
      <text>Welcome to your monorepo.</text>
      <text fg="#888888">Press q or Ctrl+C to exit.</text>
    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<WelcomeScreen />);
