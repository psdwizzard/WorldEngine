import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders primary tabs", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Character Turnaround Builder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Storyboard/ })).toBeInTheDocument();
  });
});
