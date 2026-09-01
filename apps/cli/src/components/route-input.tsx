import { useState } from "react";
import { useNavigate } from "react-router";
import { isRoutePath, routes } from "../routes";

const PLACEHOLDER = `Type a route (e.g. ${routes.about}) and press Enter`;

export function RouteInput() {
  const navigate = useNavigate();
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
      <text fg="#7aa2f7">lightcode | route</text>
      <input
        value={value}
        onChange={setValue}
        onSubmit={(next) => submit(next as string)}
        placeholder={PLACEHOLDER}
        width="100%"
        focused
      />
      {error ? <text fg="#f7768e">{error}</text> : null}
    </box>
  );
}
