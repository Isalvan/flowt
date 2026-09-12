import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoreActionsMenu } from "./MoreActionsMenu";

const renderMenu = () => {
  const onNewHucha = vi.fn();
  const Wrapper = () => {
    const [open, setOpen] = useState(false);
    return (
      <MoreActionsMenu
        open={open}
        onToggle={() => setOpen((value) => !value)}
        onClose={() => setOpen(false)}
        onNewHucha={onNewHucha}
        onTransfer={vi.fn()}
        onHistory={vi.fn()}
      />
    );
  };
  render(
    <>
      <Wrapper />
      <button type="button">Exterior</button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: /más acciones/i });
  fireEvent.click(trigger);
  return { trigger, onNewHucha };
};

describe("MoreActionsMenu", () => {
  it("focuses the first action when opened", () => {
    renderMenu();
    expect(
      screen.getByRole("menuitem", { name: /nueva hucha/i }),
    ).toHaveFocus();
  });

  it("moves focus with ArrowDown and ArrowUp", () => {
    renderMenu();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(
      screen.getByRole("menuitem", { name: /traspasar fondos/i }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(
      screen.getByRole("menuitem", { name: /nueva hucha/i }),
    ).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { trigger } = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside click", () => {
    renderMenu();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Exterior" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("runs an action and closes the menu", () => {
    const { onNewHucha } = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /nueva hucha/i }));
    expect(onNewHucha).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
