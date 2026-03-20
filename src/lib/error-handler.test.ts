import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockShowToast } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
}));

vi.mock("../stores/toastStore", () => ({
  showToast: mockShowToast,
}));

import { handleError } from "./error-handler";

describe("handleError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("calls console.error with context label and the error", () => {
    const err = new Error("something broke");
    handleError("TestContext", err);
    expect(console.error).toHaveBeenCalledWith("[TestContext]", err);
  });

  it("calls showToast with the error message and 'error' type", () => {
    const err = new Error("something broke");
    handleError("TestContext", err);
    expect(mockShowToast).toHaveBeenCalledWith("something broke", "error");
  });

  it("extracts message from Error objects", () => {
    handleError("Ctx", new Error("err msg"));
    expect(mockShowToast).toHaveBeenCalledWith("err msg", "error");
  });

  it("converts string errors to string message", () => {
    handleError("Ctx", "plain string error");
    expect(console.error).toHaveBeenCalledWith("[Ctx]", "plain string error");
    expect(mockShowToast).toHaveBeenCalledWith("plain string error", "error");
  });

  it("handles unknown error types by converting to string", () => {
    handleError("Ctx", 42);
    expect(mockShowToast).toHaveBeenCalledWith("42", "error");

    handleError("Ctx", null);
    expect(mockShowToast).toHaveBeenCalledWith("null", "error");

    handleError("Ctx", undefined);
    expect(mockShowToast).toHaveBeenCalledWith("undefined", "error");
  });
});
