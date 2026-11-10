import { LogOut, type LucideIcon } from "lucide-react";
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
  /** The link for the page the customer is on. */
  current?: string;
  onSignOut: () => void;
  onAssistant?: () => void;
}

/** Up to two initials for the avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

// The top bar: logo, navigation, Wattle AI, who is signed in and sign-out. It wraps rather
// than clipping, so nothing falls off the edge at any width.
export function Header({
  name,
  detail,
  home,
  links,
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
            {links.map(({ href, label, Icon }) => (
              <li key={href}>
                <a href={href} aria-current={href === current ? "page" : undefined}>
                  <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </a>
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
            <button type="button" className="sign-out" onClick={onSignOut}>
              <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
              <span className="sign-out-label">Sign out</span>
            </button>
          </div>
          <ProjectLink />
        </div>
      </div>
    </header>
  );
}
