import { describe, expect, it } from "vitest";
import { isSubscriptionMovement, resolveServiceKey } from "./serviceNames";

describe("service name matching", () => {
  it.each([
    ["SPOTIFY AB", "Spotify Duo"],
    ["NETFLIX.COM", "Netflix Premium"],
    ["OPENAI", "ChatGPT Plus"],
    ["CHATGPT", "ChatGPT Plus"],
    ["GEMINI", "Google Gemini"],
    ["GOOGLE*GOOGLE PLAY", "Google Play"],
  ])("matches %s to %s", (concept, subscription) => {
    expect(isSubscriptionMovement(concept, [subscription])).toBe(true);
  });

  it("uses a conservative fallback", () => {
    expect(resolveServiceKey("Google Drive")).toBeUndefined();
    expect(isSubscriptionMovement("Prime Video", ["Amazon Prime"])).toBe(false);
  });
});
