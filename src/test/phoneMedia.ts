import { vi } from "vitest";
import { PHONE_QUERY } from "../hooks/useMediaQuery";

/** Makes the phone layout's media query match, as on a phone screen. Restore with vi.restoreAllMocks(). */
export const pretendPhone = () =>
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as MediaQueryList);
