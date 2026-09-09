import { describe, expect, it } from "vitest";
import type { Palette } from "../src/render/palette";
import type { PolityIndexEntry } from "../src/render/polity-index";
import { colourForDraw, type RenderMode } from "../src/render/render-mode";

/**
 * Deterministic and canvas-free: prefixes the id it is asked about, so a test
 * can tell from the returned string alone which id colourForDraw actually
 * passed through, without depending on palette.ts's real tier logic.
 */
const fakePalette: Palette = {
  colourFor(polityId: string): string {
    return `colour:${polityId}`;
  },
};

const MEMBER: PolityIndexEntry = {
  polityId: "name:French Africa",
  memberOf: "name:(French Third Republic)",
};

const UNAFFILIATED: PolityIndexEntry = {
  polityId: "name:Etruscans",
  memberOf: null,
};

const DANGLING_MEMBER: PolityIndexEntry = {
  polityId: "name:Orphan Colony",
  memberOf: "name:(Nonexistent Empire)",
};

const KNOWN_POLITY_IDS = new Set([
  "name:French Africa",
  "name:(French Third Republic)",
  "name:Etruscans",
  "name:Orphan Colony",
  // Deliberately excludes "name:(Nonexistent Empire)" -- DANGLING_MEMBER's
  // memberOf names a polity absent from the artifact, which is the case
  // decision 0017 measured at zero against real data but this function must
  // still not assume.
]);

describe("colourForDraw", () => {
  // The one behaviour "parent" mode exists for. A wrong value here --
  // colourFor called with the member's own polityId instead of its
  // memberOf -- would return "colour:name:French Africa" instead, which is
  // exactly the bug this feature is meant to fix (French Africa keeping its
  // own colour instead of borrowing the empire's).
  it("gives a member its aggregate's colour in parent mode", () => {
    const colour = colourForDraw(MEMBER, "parent", fakePalette, KNOWN_POLITY_IDS);
    expect(colour).toBe("colour:name:(French Third Republic)");
  });

  // "none" and "outline" both keep components in their own colour -- only
  // "parent" reassigns it. A wrong value here would be the aggregate's
  // colour leaking into a mode that is supposed to leave components alone.
  const modesThatKeepOwnColour: RenderMode[] = ["none", "outline"];
  for (const mode of modesThatKeepOwnColour) {
    it(`gives a member its own colour in ${mode} mode`, () => {
      const colour = colourForDraw(MEMBER, mode, fakePalette, KNOWN_POLITY_IDS);
      expect(colour).toBe("colour:name:French Africa");
    });
  }

  // An unaffiliated polity (memberOf: null) must never resolve through
  // memberOf, even in parent mode -- there is nothing to resolve through. A
  // wrong value here would be a crash (null used as a map key) or a colour
  // for the literal string "null".
  it("gives an unaffiliated polity its own colour even in parent mode", () => {
    const colour = colourForDraw(UNAFFILIATED, "parent", fakePalette, KNOWN_POLITY_IDS);
    expect(colour).toBe("colour:name:Etruscans");
  });

  // The dangling-reference safety net. This cannot happen against today's
  // data (decision 0017: zero dangling memberOf references, enforced by the
  // pipeline build), but colourForDraw must not assume that. A wrong value
  // here would be "colour:name:(Nonexistent Empire)" -- handing the palette
  // an id that names nothing on the map, and (worse) that would not crash
  // either, just silently colour French-style-Africa-but-orphaned with a
  // colour nothing else ever wears -- or a thrown error, which the "must not
  // crash" requirement rules out just as firmly.
  it("falls back to a member's own colour when memberOf names an unknown polity", () => {
    const colour = colourForDraw(DANGLING_MEMBER, "parent", fakePalette, KNOWN_POLITY_IDS);
    expect(colour).toBe("colour:name:Orphan Colony");
  });
});
