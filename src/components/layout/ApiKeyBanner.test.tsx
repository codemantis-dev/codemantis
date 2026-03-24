import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ApiKeyBanner from "./ApiKeyBanner";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("../../lib/tauri-commands", () => ({}));
vi.mock("../../lib/error-handler", () => ({ handleError: vi.fn() }));

describe("ApiKeyBanner", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      loaded: true,
      settings: {
        ...useSettingsStore.getState().settings,
        apiKeys: {},
        apiKeyBannerDismissed: false,
      },
    });
  });

  it("renders the banner when no API keys are set", () => {
    render(<ApiKeyBanner />);
    expect(screen.getByText("Add API keys for full features")).toBeInTheDocument();
  });

  it("does not render when settings are not loaded", () => {
    useSettingsStore.setState({ loaded: false });
    const { container } = render(<ApiKeyBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when an API key is already set", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        apiKeys: { openai: "sk-test-key" },
      },
    });
    const { container } = render(<ApiKeyBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when banner was permanently dismissed", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        apiKeyBannerDismissed: true,
      },
    });
    const { container } = render(<ApiKeyBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("dismisses for the session when X button is clicked", () => {
    render(<ApiKeyBanner />);
    const dismissButton = screen.getByTitle("Dismiss");
    fireEvent.click(dismissButton);
    expect(screen.queryByText("Add API keys for full features")).not.toBeInTheDocument();
  });

  it("opens settings to ai-providers tab when clicking the link", () => {
    const openSettingsToTab = vi.fn();
    useUiStore.setState({ openSettingsToTab });
    render(<ApiKeyBanner />);
    fireEvent.click(screen.getByText("Add API keys for full features"));
    expect(openSettingsToTab).toHaveBeenCalledWith("ai-providers");
  });

  it("permanently dismisses when 'Don't show again' is checked before dismiss", () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ updateSettings });
    render(<ApiKeyBanner />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTitle("Dismiss"));
    expect(updateSettings).toHaveBeenCalledWith({ apiKeyBannerDismissed: true });
  });
});
