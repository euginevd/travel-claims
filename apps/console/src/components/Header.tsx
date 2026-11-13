import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { ProjectLink, WattleButton } from "./Wattle";

export interface NavSection {
  label: string;
  links: { href: string; label: string }[];
}

interface HeaderProps {
  name: string;
  detail: string;
  home: string;
  sections: NavSection[];
  /** The link for the page the engineer is on. */
  current?: string;
  onSignOut: () => void;
  onAssistant?: () => void;
  /** The agent and payouts switches, before Wattle. */
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

// The top bar: logo, the control plane's sections, the agent and payouts switches, Wattle AI, the engineer signed in,
// sign-out and the way back to the project page. Under it, the chosen section's pages as tabs:
// only four at a time. On small screens the tabs scroll sideways, so nothing pushes the page wide.
export function Header({
  name,
  detail,
  home,
  sections,
  current,
  onSignOut,
  onAssistant,
  status,
}: HeaderProps) {
  // The section the page belongs to; the first one when it belongs to none.
  const active = sections.find((section) => section.links.some((link) => link.href === current)) ??
    sections[0] ?? { label: "", links: [] };
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a className="brand" href={home} aria-label="UnderCover Claims, home">
          <Logo />
        </a>
        <nav aria-label="Sections" className="section-switch">
          {sections.map((section) => (
            <a
              key={section.label}
              href={section.links[0]?.href}
              aria-current={section === active ? "true" : undefined}
            >
              {section.label}
            </a>
          ))}
        </nav>
        <div className="topbar-right">
          {status}
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
      {active.links.length > 1 && (
        <nav aria-label={`${active.label} pages`} className="topnav subnav">
          <ul>
            {active.links.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  aria-label={`${active.label}: ${label}`}
                  aria-current={href === current ? "page" : undefined}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
