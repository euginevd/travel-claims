import { useEffect, useState } from "react";

/** Whether a media query matches now, following changes; false where there's no matchMedia. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const change = () => {
      setMatches(list.matches);
    };
    change();
    list.addEventListener("change", change);
    return () => {
      list.removeEventListener("change", change);
    };
  }, [query]);
  return matches;
}
