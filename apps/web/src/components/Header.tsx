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
        UnderCover claims
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
          Sign out
        </button>
      </div>
    </header>
  );
}
