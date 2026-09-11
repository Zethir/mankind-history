import { describe, expect, it } from "vitest";
import { landLevelFor } from "../src/render/level";

describe("landLevelFor", () => {
  // Acceptance criterion 7. The pipeline emits land.0 and land.1 only.
  it("saturates at mid, because there is no land.2", () => {
    expect(landLevelFor("coarse")).toBe("coarse");
    expect(landLevelFor("mid")).toBe("mid");
    expect(landLevelFor("full")).toBe("mid");
  });
});
