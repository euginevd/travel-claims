import type { ReactNode, Ref } from "react";
import { LogOut, Search, type LucideIcon } from "lucide-react";
import { Logo } from "@undercover/web-core/Logo";
import { ProjectLink, WattleButton } from "./Wattle";

/** The line under the logo's word mark in this app. */
export const LOGO_SUBTITLE = "Claims workspace";

export interface NavLink {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Whether this link is the page being shown. */
  current?: boolean;
}

interface HeaderProps {
  name: string;
  detail: string;
  home: string;
  links: NavLink[];
  onSignOut: () => void;
  onSearch?: () => void;
  onCopilot?: () => void;
  copilotOpen?: boolean;
  copilotToggle?: Ref<HTMLButtonElement>;
  status?: ReactNode;
}

/** Up to two initials for the avatar, e.g. "Dana Whitfield" -> "DW". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// The top bar: logo, navigation, search, the payouts status, Wattle AI, and who is signed in.
// It wraps rather than clipping, so nothing falls off the edge at any width.
export function Header({
  name,
  detail,
  home,
  links,
  onSignOut,
  onSearch,
  onCopilot,
  copilotOpen = false,
  copilotToggle,
  status,
}: HeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a className="brand" href={home} aria-label="UnderCover Claims workspace, home">
          <Logo subtitle={LOGO_SUBTITLE} />
        </a>
        <nav aria-label="Main" className="topnav">
          <ul>
            {links.map(({ href, label, Icon, current }) => (
              <li key={href}>
                <a href={href} aria-current={current ? "page" : undefined}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </a>
              </li>
            ))}
            <li>
              <ProjectLink />
            </li>
          </ul>
        </nav>
        {onSearch && (
          <button
            type="button"
            className="search-field"
            onClick={onSearch}
            aria-label="Search claims and customers (/ or Ctrl K)"
          >
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="search-placeholder">Search claims, customers…</span>
            <kbd aria-hidden="true">/</kbd>
          </button>
        )}
        <div className="topbar-right">
          {status}
          {onCopilot && <WattleButton onClick={onCopilot} open={copilotOpen} ref={copilotToggle} />}
          <div className="who">
            <span className="avatar" aria-hidden="true">
              {initials(name)}
            </span>
            <span className="who-name">
              {name}
              <span className="who-detail">{detail}</span>
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
