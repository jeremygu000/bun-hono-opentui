import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";

export function LogoArt() {
  return (
    <box alignItems="center" flexDirection="column">
      <ascii-font
        text={JEREMYCODE_NAME.toUpperCase()}
        font="block"
        color="#7aa2f7"
      />
    </box>
  );
}
