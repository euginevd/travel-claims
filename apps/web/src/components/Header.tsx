import { LogOut } from "lucide-react";
import type { Handler } from "../api";
import { QUEUE_HREF } from "../useHashRoute";

interface HeaderProps {
  handler: Handler;
  onSignOut: () => void;
}

export function Header({ handler, onSignOut }: HeaderProps) {
  return (
    <header className="header">
      <a className="brand" href={QUEUE_HREF}>
        UnderCover <span className="eyebrow">Claims</span>
      </a>
      <nav aria-label="Main">
        <a href={QUEUE_HREF}>Queue</a>
      </nav>
      <div className="who">
        <span>
          {handler.name}
          <span className="muted"> · {handler.role}</span>
        </span>
        <button type="button" className="button secondary" onClick={onSignOut}>
          <LogOut size={16} strokeWidth={2} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </header>
  );
}
