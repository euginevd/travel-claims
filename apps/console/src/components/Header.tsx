import { LogOut } from "lucide-react";
import { Logo } from "./Logo";
import { ProjectLink, WattleButton } from "./Wattle";

export interface NavGroup {
  label: string;
  links: { href: string; label: string }[];
}

interface HeaderProps {
  name: string;
  detail: string;
  home: string;
  groups: NavGroup[];
  /** The link for the page the engineer is on. */
  current?: string;
  onSignOut: () => void;
  onAssistant?: () => void;
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

// The top bar: logo, the navigation in its two groups, Wattle AI, the engineer signed in,
// sign-out and the way back to the project page. On small screens the navigation takes its own
// row and scrolls sideways, so nothing pushes the page wide.
export function Header({
  name,
  detail,
  home,
  groups,
  current,
  onSignOut,
  onAssistant,
}: HeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a className="brand" href={home} aria-label="UnderCover Claims, home">
          <Logo />
        </a>
        <nav aria-label="Main" className="topnav">
          <ul>
            {groups.map((group) => (
              <li key={group.label} className="nav-group">
                <span className="nav-group-label" aria-hidden="true">
                  {group.label}
                </span>
                <ul>
                  {group.links.map(({ href, label }) => (
                    <li key={href}>
                      <a
                        href={href}
                        aria-label={`${group.label}: ${label}`}
                        aria-current={href === current ? "page" : undefined}
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
        <div className="topbar-right">
          {onAssistant && <WattleButton onClick={onAssistant} />}
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
              <LogOut size={17} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <ProjectLink />
        </div>
      </div>
    </header>
  );
}
