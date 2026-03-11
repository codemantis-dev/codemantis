import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TemplatePicker from "./TemplatePicker";
import type { TemplateEntry } from "../../types/project-templates";

const MOCK_TEMPLATES: TemplateEntry[] = [
  {
    id: "vite-react",
    name: "React + Vite",
    description: "Vite and React starter",
    category: "frontend",
    tags: ["react", "vite", "typescript"],
    repo_url: "https://github.com/example/vite-react",
    branch: "main",
    stars: 700,
    license: "MIT",
    install_command: "pnpm install",
    dev_command: "pnpm dev",
    icon: "zap",
    verified: true,
    last_verified: "2026-03-10",
    scaffold_type: "git-clone",
  },
  {
    id: "nextjs-boilerplate",
    name: "Next.js Full-Stack",
    description: "Next.js with TypeScript and Tailwind",
    category: "full-stack",
    tags: ["next.js", "react", "typescript"],
    repo_url: "https://github.com/example/nextjs",
    branch: "main",
    stars: 12700,
    license: "MIT",
    install_command: "npm install",
    dev_command: "npm run dev",
    icon: "triangle",
    verified: true,
    last_verified: "2026-03-10",
    scaffold_type: "git-clone",
  },
  {
    id: "expo-starter",
    name: "Expo Mobile",
    description: "React Native with Expo",
    category: "mobile",
    tags: ["expo", "react-native"],
    repo_url: "",
    branch: "",
    license: "MIT",
    install_command: "npm install",
    dev_command: "npx expo start",
    icon: "smartphone",
    verified: true,
    last_verified: "2026-03-10",
    scaffold_type: "cli",
    cli_command: "npx create-expo-app",
  },
];

vi.mock("../../lib/tauri-commands", () => ({
  listTemplates: vi.fn(() => Promise.resolve(MOCK_TEMPLATES)),
  scaffoldFromTemplate: vi.fn(),
  scaffoldFromCli: vi.fn(),
  listenScaffoldProgress: vi.fn(() => Promise.resolve(() => {})),
}));

describe("TemplatePicker", () => {
  const onProjectCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all templates after loading", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("React + Vite")).toBeInTheDocument();
    });
    expect(screen.getByText("Next.js Full-Stack")).toBeInTheDocument();
    expect(screen.getByText("Expo Mobile")).toBeInTheDocument();
  });

  it("renders category filter pills", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("All")).toBeInTheDocument();
    });
    expect(screen.getByText("Frontend")).toBeInTheDocument();
    expect(screen.getByText("Full-Stack")).toBeInTheDocument();
    expect(screen.getByText("Mobile")).toBeInTheDocument();
  });

  it("filters by category", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("React + Vite")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Frontend"));
    expect(screen.getByText("React + Vite")).toBeInTheDocument();
    expect(screen.queryByText("Next.js Full-Stack")).not.toBeInTheDocument();
    expect(screen.queryByText("Expo Mobile")).not.toBeInTheDocument();
  });

  it("filters by search query", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("React + Vite")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search templates...");
    fireEvent.change(searchInput, { target: { value: "expo" } });

    expect(screen.getByText("Expo Mobile")).toBeInTheDocument();
    expect(screen.queryByText("React + Vite")).not.toBeInTheDocument();
    expect(screen.queryByText("Next.js Full-Stack")).not.toBeInTheDocument();
  });

  it("shows empty state when search yields no results", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("React + Vite")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search templates...");
    fireEvent.change(searchInput, { target: { value: "nonexistent-template" } });

    expect(screen.getByText("No templates match your search")).toBeInTheDocument();
  });

  it("navigates to detail view when template is clicked", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("Next.js Full-Stack")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Next.js Full-Stack"));
    expect(screen.getByText("Back to templates")).toBeInTheDocument();
    expect(screen.getByText("Use This Template")).toBeInTheDocument();
  });

  it("navigates back from detail view", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("Next.js Full-Stack")).toBeInTheDocument();
    });

    // Go to detail
    fireEvent.click(screen.getByText("Next.js Full-Stack"));
    expect(screen.getByText("Back to templates")).toBeInTheDocument();

    // Go back
    fireEvent.click(screen.getByText("Back to templates"));
    await waitFor(() => {
      expect(screen.getByText("React + Vite")).toBeInTheDocument();
    });
  });

  it("renders search input with auto-focus", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    const searchInput = await waitFor(() => screen.getByPlaceholderText("Search templates..."));
    expect(searchInput).toBeInTheDocument();
  });

  it("resets to All when clicking All after filtering", async () => {
    render(<TemplatePicker onProjectCreated={onProjectCreated} />);
    await waitFor(() => {
      expect(screen.getByText("React + Vite")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Frontend"));
    expect(screen.queryByText("Next.js Full-Stack")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("React + Vite")).toBeInTheDocument();
    expect(screen.getByText("Next.js Full-Stack")).toBeInTheDocument();
    expect(screen.getByText("Expo Mobile")).toBeInTheDocument();
  });
});
