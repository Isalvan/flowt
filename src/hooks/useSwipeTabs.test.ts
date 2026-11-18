import { afterEach, describe, expect, it } from "vitest";
import { ownsHorizontalGesture } from "./useSwipeTabs";

function setup(html: string) {
  const root = document.createElement("main");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("ownsHorizontalGesture", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lets plain content swipe between tabs", () => {
    const root = setup("<section><p id='t'>Hola</p></section>");
    expect(ownsHorizontalGesture(root.querySelector("#t"), root)).toBe(false);
  });

  it("leaves fields, dialogs and opted-out areas alone", () => {
    const root = setup("<input id='a'/><div role='dialog'><p id='b'>x</p></div><div data-no-swipe><p id='c'>x</p></div>");
    for (const id of ["a", "b", "c"]) expect(ownsHorizontalGesture(root.querySelector(`#${id}`), root)).toBe(true);
  });

  it("leaves horizontal scrollers such as the wallets carousel alone", () => {
    const root = setup("<div id='s' style='overflow-x:auto'><p id='t'>x</p></div>");
    const scroller = root.querySelector<HTMLElement>("#s")!;
    Object.defineProperty(scroller, "scrollWidth", { value: 800 });
    Object.defineProperty(scroller, "clientWidth", { value: 400 });
    expect(ownsHorizontalGesture(root.querySelector("#t"), root)).toBe(true);
  });
});
