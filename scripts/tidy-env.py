"""Rewrites .env in .env.example's order, with its sections and comments, keeping every value.

Run it yourself: `uv run python scripts/tidy-env.py`. It saves the old file as .env.bak first and
prints key names only, never a value. Keys .env.example doesn't have go in a section at the end;
your own comments aren't kept (they're in .env.bak).
"""

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV, EXAMPLE, BACKUP = ROOT / ".env", ROOT / ".env.example", ROOT / ".env.bak"
KEY = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


def read_values(path: Path) -> dict[str, str]:
    """Each key's raw value from the last line that sets it, as the apps read it."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = KEY.match(line)
        if match and not line.lstrip().startswith("#"):
            values[match.group(1)] = match.group(2).strip()
    return values


def main() -> int:
    if not ENV.exists():
        print("No .env: copy .env.example to .env and fill it in.")
        return 1
    values = read_values(ENV)
    out, placed, empty = [], set(), []
    for line in EXAMPLE.read_text(encoding="utf-8").splitlines():
        match = KEY.match(line)
        if match and not line.lstrip().startswith("#"):
            name = match.group(1)
            value = values.get(name, match.group(2).strip())
            out.append(f"{name}={value}")
            placed.add(name)
            if not value:
                empty.append(name)
        else:
            out.append(line)
    extra = [name for name in values if name not in placed]
    if extra:
        out += ["", "# --- Not in .env.example ---"] + [f"{name}={values[name]}" for name in extra]
    shutil.copy2(ENV, BACKUP)
    ENV.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print(f"Tidied .env ({len(values)} keys); the old one is .env.bak.")
    if extra:
        print("Kept at the end, not in .env.example:", ", ".join(extra))
    if empty:
        print("Empty:", ", ".join(empty))
    return 0


if __name__ == "__main__":
    sys.exit(main())
