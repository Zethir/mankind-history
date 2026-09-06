import { describe, expect, it } from "vitest";
import { normalizeName } from "../src/normalize-name";

describe("normalizeName", () => {
  it("lowercases and hyphenates words", () => {
    expect(normalizeName("Kingdom of Numidia")).toBe("kingdom-of-numidia");
  });

  it("strips diacritics so accented spellings key identically", () => {
    expect(normalizeName("Côte d'Ivoire")).toBe("cote-d-ivoire");
    expect(normalizeName("Kingdom of Ayutthayā")).toBe("kingdom-of-ayutthaya");
  });

  it("collapses runs of punctuation and whitespace into a single hyphen", () => {
    expect(normalizeName("  Roman   Empire  ")).toBe("roman-empire");
    expect(normalizeName("Wei (Cao)")).toBe("wei-cao");
    expect(normalizeName("Qin -- Western")).toBe("qin-western");
  });

  it("keeps digits, which appear in dynastic names", () => {
    expect(normalizeName("Dynasty 18")).toBe("dynasty-18");
  });

  it("is idempotent, so re-normalising a normalised name is a no-op", () => {
    const once = normalizeName("Côte d'Ivoire");
    expect(normalizeName(once)).toBe(once);
  });

  it("returns an empty string for input with no alphanumerics", () => {
    expect(normalizeName("---")).toBe("");
  });
});
