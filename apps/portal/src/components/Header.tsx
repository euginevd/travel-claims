import { FileText, Mail, SquarePen } from "lucide-react";
import { Logo } from "./Logo";
import { ProjectLink } from "./Wattle";

interface HeaderProps {
  name: string;
  unread: boolean;
  onNewChat: () => void;
  onMessages: () => void;
  onClaims: () => void;
  onSettings: () => void;
}

/** Up to two initials for the avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

// A quiet top bar: the conversation is the page. Messages, Claims and Settings open the side
// panel; labels hide on a phone and the icons keep their names.
export function Header({ name, unread, onNewChat, onMessages, onClaims, onSettings }: HeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a className="brand" href="#/" aria-label="UnderCover, home" onClick={onNewChat}>
          <Logo />
        </a>
        <ProjectLink />
        <span className="grow" />
        <nav aria-label="Main" className="topnav">
          <button type="button" className="top-button" onClick={onNewChat}>
            <SquarePen size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="top-label">New chat</span>
          </button>
          <button type="button" className="top-button" onClick={onMessages}>
            <Mail size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="top-label">Messages</span>
            {unread && (
              <span className="top-dot">
                <span className="visually-hidden">, new</span>
              </span>
            )}
          </button>
          <button type="button" className="top-button" onClick={onClaims}>
            <FileText size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="top-label">Claims</span>
          </button>
          <button
            type="button"
            className="avatar"
            aria-label={`Settings for ${name}`}
            onClick={onSettings}
          >
            {initials(name)}
          </button>
        </nav>
      </div>
    </header>
  );
}
