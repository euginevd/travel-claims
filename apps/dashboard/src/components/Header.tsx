import type { ReactNode } from "react";
import { LogOut, Search, type LucideIcon } from "lucide-react";
import { Logo } from "./Logo";
import { ProjectLink, WattleButton } from "./Wattle";

export interface NavLink {
  href: string;
  label: string;
  Icon: LucideIcon;
}

interface HeaderProps {
  name: string;
  detail: string;
  home: string;
  links: NavLink[];
  onSignOut: () => void;
  onSearch?: () => void;
  onCopilot?: () => void;
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

// The header band: logo, navigation, who is signed in and sign-out. It wraps rather than
// clipping, so nothing falls off the edge at any width.
export function Header({
  name,
  detail,
  home,
  links,
  onSignOut,
  onSearch,
  onCopilot,
  status,
}: HeaderProps) {
  return (
    <header className="header">
      <a className="brand" href={home} aria-label="UnderCover Claims, home">
        <Logo tone="on-ink" />
      </a>
      <ProjectLink />
      <nav aria-label="Main">
        <ul>
          {links.map(({ href, label, Icon }) => (
            <li key={href}>
              <a href={href} title={label}>
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                <span className="nav-label">{label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {onSearch && (
        <button
          type="button"
          className="search-field"
          onClick={onSearch}
          aria-label="Search claims and customers (Ctrl K)"
        >
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <span className="search-placeholder">Search claims, customers…</span>
          <kbd aria-hidden="true">Ctrl K</kbd>
        </button>
      )}
      {onCopilot && <WattleButton onClick={onCopilot} />}
      <div className="who">
        {status}
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="who-name">
          {name}
          <span className="who-detail">{detail}</span>
        </span>
        <button
          type="button"
          className="icon-button on-ink"
          onClick={onSignOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
