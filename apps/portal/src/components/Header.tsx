import { LogOut, type LucideIcon } from "lucide-react";
import { Logo } from "./Logo";

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
}

// The header band: logo, navigation, who is signed in and sign-out. It wraps rather than
// clipping, so nothing falls off the edge at any width.
export function Header({ name, detail, home, links, onSignOut }: HeaderProps) {
  return (
    <header className="header">
      <a className="brand" href={home} aria-label="UnderCover Claims, home">
        <Logo tone="on-ink" />
      </a>
      <nav aria-label="Main">
        <ul>
          {links.map(({ href, label, Icon }) => (
            <li key={href}>
              <a href={href}>
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="who">
        <span className="who-name">
          {name}
          <span className="who-detail">{detail}</span>
        </span>
        <button type="button" className="button secondary" onClick={onSignOut}>
          <LogOut size={16} strokeWidth={2} aria-hidden="true" />
          <span className="sign-out-label">Sign out</span>
        </button>
      </div>
    </header>
  );
}
