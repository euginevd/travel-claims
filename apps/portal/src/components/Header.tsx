import { FileText, House, Mail } from "lucide-react";
import { Logo } from "@undercover/web-core/Logo";
import { SIDE_PANEL_ID, type PanelTarget } from "../chat/SidePanel";
import { ProjectLink } from "./Wattle";

interface HeaderProps {
  name: string;
  unread: boolean;
  onHome: () => void;
  onMessages: () => void;
  onClaims: () => void;
  onSettings: () => void;
  /** The side panel's view while it's open: its button shows as expanded. */
  open: PanelTarget["view"] | null;
}

/** Up to two initials for the avatar. */

/** The line under the logo's word mark in this app. */
export const LOGO_SUBTITLE = "Travel insurance";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

// A quiet top bar: the conversation is the page. Messages, Claims and Settings open the side
// panel; labels hide on a phone and the icons keep their names.
export function Header({
  name,
  unread,
  onHome,
  onMessages,
  onClaims,
  onSettings,
  open,
}: HeaderProps) {
  const toggles = (view: PanelTarget["view"]) => ({
    "aria-expanded": open === view,
    "aria-controls": SIDE_PANEL_ID,
  });
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a
          className="brand"
          href="#/"
          aria-label="UnderCover, home"
          onClick={(event) => {
            event.preventDefault();
            onHome();
          }}
        >
          <Logo subtitle={LOGO_SUBTITLE} />
        </a>
        <ProjectLink />
        <span className="grow" />
        <nav aria-label="Main" className="topnav">
          <button type="button" className="top-button" onClick={onHome}>
            <House size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="top-label">Home</span>
          </button>
          <button
            type="button"
            className="top-button"
            onClick={onMessages}
            {...toggles("messages")}
          >
            <Mail size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="top-label">Messages</span>
            {unread && (
              <span className="top-dot">
                <span className="visually-hidden">, new</span>
              </span>
            )}
          </button>
          <button type="button" className="top-button" onClick={onClaims} {...toggles("claims")}>
            <FileText size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="top-label">Claims</span>
          </button>
          <button
            type="button"
            className="avatar"
            aria-label={`Settings for ${name}`}
            onClick={onSettings}
            {...toggles("settings")}
          >
            {initials(name)}
          </button>
        </nav>
      </div>
    </header>
  );
}
