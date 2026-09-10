import { describe, expect, it } from "vitest";
import type { Palette } from "../src/render/palette";
import type { PolityIndexEntry } from "../src/render/polity-index";
import { colourForDraw, type RenderMode } from "../src/render/render-mode";

/**
 * Deterministic and canvas-free: prefixes the id it is asked about, so a test
 * can tell from the returned string alone which id colourForDraw actually
 * resolved to, without depending on palette.ts's real graph-colouring logic.
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

/** No polity in this file's fixed cases is itself a member of a further aggregate. */
const NO_PARENTS = new Map<string, string>();

describe("colourForDraw", () => {
  // The one behaviour "on" mode exists for. A wrong value here -- colourFor
  // called with the member's own polityId instead of its memberOf -- would
  // return "colour:name:French Africa" instead, which is exactly the bug
  // merging is meant to fix (French Africa keeping its own colour instead of
  // sharing the empire's).
  it("gives a member its aggregate's colour in on mode", () => {
    const colour = colourForDraw(MEMBER, "on", fakePalette, KNOWN_POLITY_IDS, NO_PARENTS);
    expect(colour).toBe("colour:name:(French Third Republic)");
  });

  // "off" mode never merges: a member keeps its own independent colour, the
  // pre-change baseline. A wrong value here would be
  // "colour:name:(French Third Republic)" -- "on" mode's merge leaking into
  // the mode that is supposed to disable it entirely.
  it("gives a member its own colour in off mode", () => {
    const colour = colourForDraw(MEMBER, "off", fakePalette, KNOWN_POLITY_IDS, NO_PARENTS);
    expect(colour).toBe("colour:name:French Africa");
  });

  // An unaffiliated polity (memberOf: null) must never resolve through
  // memberOf, in any mode -- there is nothing to resolve through. A wrong
  // value here would be a crash (null used as a map key) or a colour for the
  // literal string "null".
  const allModes: RenderMode[] = ["off", "on"];
  for (const mode of allModes) {
    it(`gives an unaffiliated polity its own colour in ${mode} mode`, () => {
      const colour = colourForDraw(UNAFFILIATED, mode, fakePalette, KNOWN_POLITY_IDS, NO_PARENTS);
      expect(colour).toBe("colour:name:Etruscans");
    });
  }

  // The dangling-reference safety net, checked in every mode: this cannot
  // happen against today's data (decision 0017: zero dangling memberOf
  // references, enforced by the pipeline build), but colourForDraw must not
  // assume that. A wrong value here would be "colour:name:(Nonexistent
  // Empire)" -- handing the palette an id that names nothing on the map --
  // or a thrown error, which the "must not crash" requirement rules out just
  // as firmly.
  for (const mode of allModes) {
    it(`falls back to a member's own colour when memberOf is unknown, in ${mode} mode`, () => {
      const colour = colourForDraw(
        DANGLING_MEMBER,
        mode,
        fakePalette,
        KNOWN_POLITY_IDS,
        NO_PARENTS,
      );
      expect(colour).toBe("colour:name:Orphan Colony");
    });
  }

  // Finding 2: memberOf nests (an aggregate can itself be a member of a
  // further aggregate -- Kingdom of Bohemia -> Holy Roman Empire, Kingdom of
  // Poland -> Polish-Lithuania Kingdom, against the real dist/). A three-level
  // chain -- member -> mid-aggregate -> root -- must have all three draw the
  // *root's* colour under "on" mode, not stop at the immediate memberOf. A
  // wrong value here (resolving only one level) would give the mid-aggregate
  // itself "colour:name:(Root Empire)" while its member gets
  // "colour:name:(Mid Aggregate)" -- two different colours for one group,
  // exactly the "one empire reads as two" defect this closes.
  it("resolves a three-level membership chain to the root's colour for every level", () => {
    const root: PolityIndexEntry = { polityId: "name:(Root Empire)", memberOf: null };
    const mid: PolityIndexEntry = {
      polityId: "name:(Mid Aggregate)",
      memberOf: "name:(Root Empire)",
    };
    const member: PolityIndexEntry = {
      polityId: "name:Leaf Member",
      memberOf: "name:(Mid Aggregate)",
    };
    const knownIds = new Set([root.polityId, mid.polityId, member.polityId]);
    const parents = new Map([["name:(Mid Aggregate)", "name:(Root Empire)"]]);

    const rootColour = colourForDraw(root, "on", fakePalette, knownIds, parents);
    const midColour = colourForDraw(mid, "on", fakePalette, knownIds, parents);
    const memberColour = colourForDraw(member, "on", fakePalette, knownIds, parents);

    expect(rootColour).toBe("colour:name:(Root Empire)");
    expect(midColour).toBe("colour:name:(Root Empire)");
    expect(memberColour).toBe("colour:name:(Root Empire)");
  });
});
