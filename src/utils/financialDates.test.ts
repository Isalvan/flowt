import { describe, expect, it } from "vitest";
import { getObservedCalendarDays } from "./financialDates";

describe("getObservedCalendarDays", () => {
  it("is stable across DST and ignores hours", () => {
    expect(
      getObservedCalendarDays(
        [new Date(2026, 2, 28, 23, 59), new Date(2026, 2, 30, 0, 1)],
        new Date(2026, 3, 1),
      ),
    ).toBe(2);
  });

  it("crosses month boundaries using calendar days", () => {
    expect(
      getObservedCalendarDays(
        [new Date(2026, 0, 31, 22), new Date(2026, 1, 2, 2)],
        new Date(2026, 1, 2),
      ),
    ).toBe(2);
  });
});
