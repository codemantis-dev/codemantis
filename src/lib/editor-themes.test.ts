import { describe, it, expect } from "vitest";
import { getMonacoTheme, getXtermTheme, isLightTheme } from "./editor-themes";
import { THEMES } from "../types/settings";
import type { ThemeId } from "../types/settings";

const DARK_THEMES: ThemeId[] = ["midnight", "ocean", "ember"];
const LIGHT_THEMES: ThemeId[] = ["dawn", "sand", "arctic"];

describe("getMonacoTheme", () => {
  it("returns vs-dark base for each dark theme", () => {
    for (const id of DARK_THEMES) {
      expect(getMonacoTheme(id).base).toBe("vs-dark");
    }
  });

  it("returns vs base for each light theme", () => {
    for (const id of LIGHT_THEMES) {
      expect(getMonacoTheme(id).base).toBe("vs");
    }
  });

  it("falls back to midnight for invalid themeId", () => {
    const invalid = "nonexistent" as ThemeId;
    const result = getMonacoTheme(invalid);
    expect(result).toEqual(getMonacoTheme("midnight"));
  });

  it("each theme has unique editorBackground", () => {
    const allThemes = [...DARK_THEMES, ...LIGHT_THEMES];
    const backgrounds = allThemes.map((id) => getMonacoTheme(id).editorBackground);
    const unique = new Set(backgrounds);
    expect(unique.size).toBe(allThemes.length);
  });
});

describe("getXtermTheme", () => {
  it("returns correct background for each known theme", () => {
    expect(getXtermTheme("midnight").background).toBe("#09090b");
    expect(getXtermTheme("ocean").background).toBe("#0a0e1a");
    expect(getXtermTheme("ember").background).toBe("#12100e");
    expect(getXtermTheme("dawn").background).toBe("#fafaf9");
    expect(getXtermTheme("sand").background).toBe("#fdf8f0");
    expect(getXtermTheme("arctic").background).toBe("#f4f7fb");
  });

  it("falls back to midnight for invalid themeId", () => {
    const invalid = "nonexistent" as ThemeId;
    const result = getXtermTheme(invalid);
    expect(result).toEqual(getXtermTheme("midnight"));
  });

  it("each theme has unique background", () => {
    const allThemes = [...DARK_THEMES, ...LIGHT_THEMES];
    const backgrounds = allThemes.map((id) => getXtermTheme(id).background);
    const unique = new Set(backgrounds);
    expect(unique.size).toBe(allThemes.length);
  });
});

describe("isLightTheme", () => {
  it("returns true for dawn, sand, arctic", () => {
    for (const id of LIGHT_THEMES) {
      expect(isLightTheme(id)).toBe(true);
    }
  });

  it("returns false for midnight, ocean, ember", () => {
    for (const id of DARK_THEMES) {
      expect(isLightTheme(id)).toBe(false);
    }
  });

  it("returns false for invalid themeId", () => {
    const invalid = "nonexistent" as ThemeId;
    expect(isLightTheme(invalid)).toBe(false);
  });

  it("THEMES array covers all expected theme IDs", () => {
    const expected = [...DARK_THEMES, ...LIGHT_THEMES];
    const actual = THEMES.map((t) => t.id);
    expect(actual.sort()).toEqual(expected.sort());
  });
});
