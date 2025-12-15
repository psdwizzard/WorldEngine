import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders primary tabs", () => {
    render(<App />);
    expect(screen.getByText("World Generator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Characters/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Storyboard/i })).toBeInTheDocument();
  });
});
