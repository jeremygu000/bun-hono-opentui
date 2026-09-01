import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { routes, isRoutePath } from "../routes";

function buildPlaceholder(currentPath: string): string {
  const others = (Object.values(routes) as string[]).filter(
    (p) => p !== currentPath,
  );
  const sample = others[0] ?? routes.home;
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
      paddingX={1}
      paddingY={0}
      title={`lightcode | route ${pathname}`}
      titleAlignment="left"
      titleColor={error ? "#f7768e" : "#7aa2f7"}
      width="80%"
    >
      <input
        focused={!error}
        onChange={setValue}
        onSubmit={(next) => submit(next as string)}
        placeholder={buildPlaceholder(pathname)}
        value={value}
        width="100%"
      />
    </box>
  );
}
