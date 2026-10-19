import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// jsdom doesn't implement scrolling.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
