import { useEffect, useState } from "react";

const matches = (query: string) =>
  typeof window !== "undefined" && (window.matchMedia?.(query)?.matches ?? false);

/** Whether a CSS media query matches now, kept in step as the window changes. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const update = () => setValue(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, [query]);
  return value;
}

/** Phones and small tablets, where Inicio and Ajustes use their lighter layout. */
export const PHONE_QUERY = "(max-width: 1023px)";
