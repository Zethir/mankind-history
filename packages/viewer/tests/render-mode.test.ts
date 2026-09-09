import { describe, expect, it } from "vitest";
import type { Palette } from "../src/render/palette";
import type { PolityIndexEntry } from "../src/render/polity-index";
import { colourForDraw, type RenderMode } from "../src/render/render-mode";

/**
 * Deterministic and canvas-free: prefixes the id it is asked about, so a test
 * can tell from the returned string alone which id/method colourForDraw
 * actually used, without depending on palette.ts's real family logic.
 * `colourForMember` is prefixed differently from `colourFor` so a test can
 * also tell *which method* was called -- the bug declination exists to
 * prevent is exactly "used colourFor when it should have declined."
 */
const fakePalette: Palette = {
  colourFor(polityId: string): string {
    return `colour:${polityId}`;
  },
  colourForMember(aggregatePolityId: string, memberPolityId: string): string {
    return `declined:${aggregatePolityId}:${memberPolityId}`;
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

  // "none" and "outline" both decline a member to a shade of its aggregate's
  // family -- only "parent" gives it the aggregate's exact flat colour. A
  // wrong value here would be "colour:name:French Africa" (declination
  // skipped, member kept an independent colour of its own) or
  // "colour:name:(French Third Republic)" (parent-mode's flat borrow leaking
  // into a mode that is supposed to shade, not flatten).
  const modesThatDecline: RenderMode[] = ["none", "outline"];
  for (const mode of modesThatDecline) {
    it(`declines a member to a shade of its aggregate's family in ${mode} mode`, () => {
      const colour = colourForDraw(MEMBER, mode, fakePalette, KNOWN_POLITY_IDS);
      expect(colour).toBe("declined:name:(French Third Republic):name:French Africa");
    });
  }

  // An unaffiliated polity (memberOf: null) must never resolve through
  // memberOf, in any mode -- there is nothing to resolve through, and
  // nothing to decline against. A wrong value here would be a crash (null
  // used as a map key), a colour for the literal string "null", or a
  // spurious call to colourForMember with no real aggregate.
  const allModes: RenderMode[] = ["none", "outline", "parent"];
  for (const mode of allModes) {
    it(`gives an unaffiliated polity its own colour in ${mode} mode`, () => {
      const colour = colourForDraw(UNAFFILIATED, mode, fakePalette, KNOWN_POLITY_IDS);
      expect(colour).toBe("colour:name:Etruscans");
    });
  }

  // The dangling-reference safety net, checked in every mode: this cannot
  // happen against today's data (decision 0017: zero dangling memberOf
  // references, enforced by the pipeline build), but colourForDraw must not
  // assume that. A wrong value here would be "colour:name:(Nonexistent
  // Empire)" or "declined:name:(Nonexistent Empire):name:Orphan Colony" --
  // handing the palette an id that names nothing on the map -- or a thrown
  // error, which the "must not crash" requirement rules out just as firmly.
  for (const mode of allModes) {
    it(`falls back to a member's own colour when memberOf is unknown, in ${mode} mode`, () => {
      const colour = colourForDraw(DANGLING_MEMBER, mode, fakePalette, KNOWN_POLITY_IDS);
      expect(colour).toBe("colour:name:Orphan Colony");
    });
  }
});
