import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { isRoutePath } from "../routes";

function buildPlaceholder(currentPath: string): string {
  const others = (Object.values({
    home: "/",
    about: "/about",
    settings: "/settings",
  } as const) as string[]).filter((p) => p !== currentPath);
  const sample = others[0] ?? "/";
  return `You are at ${currentPath}. Try ${sample}`;
}

export function RouteInput() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const target = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (!isRoutePath(target)) {
      setError(`Unknown route: ${target}`);
      return;
    }
    setError(null);
    setValue("");
    navigate(target);
  };

  return (
    <box
      border
      borderColor={error ? "#f7768e" : "#7aa2f7"}
      flexDirection="column"
      padding={1}
      width="80%"
    >
      <text fg="#7aa2f7">lightcode | route {pathname}</text>
      <input
        value={value}
        onChange={setValue}
        onSubmit={(next) => submit(next as string)}
        placeholder={buildPlaceholder(pathname)}
        width="100%"
      />
      {error ? <text fg="#f7768e">{error}</text> : null}
    </box>
  );
}
