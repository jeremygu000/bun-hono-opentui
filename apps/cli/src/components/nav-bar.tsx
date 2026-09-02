import { routes, type RouteName } from "../routes";

const ITEMS: { name: RouteName; label: string }[] = [
  { name: "home", label: "Home" },
  { name: "about", label: "About" },
  { name: "settings", label: "Settings" },
  { name: "llm", label: "LLM" },
  { name: "llmTest", label: "LLM Test" },
  { name: "llmHybrid", label: "LLM Hybrid" },
];

export function NavBar({ active }: { active: RouteName }) {
  return (
    <box flexDirection="row" gap={1}>
      {ITEMS.map((item) => {
        const isActive = item.name === active;
        return (
          <text
            key={item.name}
            fg={isActive ? "#7aa2f7" : "#888888"}
            attributes={isActive ? 1 : 0}
          >
            {isActive ? `[ ${item.label} ]` : item.label}
          </text>
        );
      })}
      <text fg="#444444">  (router demo - try {routes.about})</text>
    </box>
  );
}
