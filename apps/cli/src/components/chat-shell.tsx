import type { ReactNode } from "react";

interface ChatShellProps {
  header?: ReactNode;
  children: ReactNode;
  composer: ReactNode;
  footer?: ReactNode;
}

export function ChatShell({ header, children, composer, footer }: ChatShellProps) {
  return (
    <box flexDirection="column" height="100%" width="100%" padding={1}>
      {header ? <box flexDirection="column" flexShrink={0}>{header}</box> : null}
      <scrollbox
        id="chat-history"
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollX={false}
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ flexDirection: "column", gap: 1 }}
      >
        {children}
      </scrollbox>
      <box flexDirection="column" flexShrink={0}>{composer}</box>
      {footer ? <box flexDirection="column" flexShrink={0}>{footer}</box> : null}
    </box>
  );
}
