import { fetchArtifacts, fetchLand, fetchVersions } from "./data/artifacts";
import { bestAvailable, LevelRegistry } from "./data/levels";
import { Engine } from "./engine/engine";
import { MapRenderer } from "./render/canvas";
import type { DetailLevel } from "./render/level";
import { landLevelFor } from "./render/level";
import { viewportBbox } from "./render/transform";
import { Chrome } from "./ui/chrome";

async function start(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) throw new Error("#app is missing from index.html");

  // versions.0.json is 3 MB gzipped but 35.3 MB uncompressed, so the parse is
  // the dominant cost, not the download. Say so rather than showing a blank
  // canvas.
  app.innerHTML = '<p class="loading">Loading the atlas...</p>';

  let engine: Engine;
  let renderer: MapRenderer;
  let chrome: Chrome;
  let registry: LevelRegistry;
  try {
    const artifacts = await fetchArtifacts();

    app.innerHTML = '<canvas id="plate"></canvas><div id="chrome"></div>';
    const canvas = app.querySelector<HTMLCanvasElement>("#plate");
    const chromeRoot = app.querySelector<HTMLElement>("#chrome");
    if (!canvas || !chromeRoot) throw new Error("app shell failed to build");

    engine = new Engine(artifacts.versions, artifacts.changes);
    // A throw here (e.g. canvas.ts failing to get a 2D context) must still
    // land in this catch: outside it, the loading message is already
    // replaced, so an escaped throw leaves a blank page instead of the error
    // state below.
    renderer = new MapRenderer(canvas, artifacts.versions, artifacts.land);
    // coarse is seeded resident by the registry itself (main.ts already
    // loaded it, above); the injected fetcher only ever needs to satisfy mid
    // and full.
    registry = new LevelRegistry((level) => fetchVersions(level));
    chrome = new Chrome(chromeRoot, engine, renderer, canvas, registry);
  } catch (error) {
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = `Could not start the map: ${String(error)}`;
    app.replaceChildren(message);
    return;
  }

  window.addEventListener("resize", () => renderer.resize());

  // The mid land basemap (954 KB in the live dist) is fetched once, after
  // first paint, same as the progressive versions prefetch chain -- cheap
  // next to the 47 MB versions artifacts, so there is no equivalent staged
  // request here. A failed fetch is logged and otherwise ignored: the coarse
  // basemap the renderer already has keeps drawing, per the requirement that
  // a land-fetch failure must not break the frame loop.
  let midLand: Awaited<ReturnType<typeof fetchLand>> | null = null;
  let midLandRequested = false;
  let landLevel: "coarse" | "mid" = "coarse";
  let versionsLevel: DetailLevel = "coarse";
  let firstPaintDone = false;

  // A throw from advance/draw/update must not silently freeze the loop at
  // whatever frame was last drawn: re-arming happens in `finally` so a single
  // bad frame is survived. But re-arming unconditionally would spin at 60fps
  // logging the same exception forever if the failure is not transient, so a
  // short run of consecutive failures stops the loop and leaves a visible
  // message instead. Five is arbitrary: enough to not abort on one glitchy
  // frame, few enough not to spam the console for a second before giving up.
  const MAX_CONSECUTIVE_FAILURES = 5;
  let last = performance.now();
  let consecutiveFailures = 0;
  let stopped = false;
  const loop = (now: number): void => {
    try {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      engine.setViewportBbox(viewportBbox(renderer.viewport));
      const frame = engine.advance(dt);

      // Detail only ever improves (LevelRegistry never regresses), so this
      // only ever moves versionsLevel/landLevel forward too. artifactOf
      // returns null for "coarse" (the registry never fetches it -- it was
      // seeded resident from what main.ts already loaded above), which is
      // exactly why versionsLevel starts at "coarse" and this never tries to
      // hand the renderer a null artifact.
      const wantedLevel = bestAvailable(registry);
      if (wantedLevel !== versionsLevel) {
        const artifact = registry.artifactOf(wantedLevel);
        if (artifact) {
          renderer.setVersions(artifact);
          versionsLevel = wantedLevel;
        }
      }
      const wantedLand = landLevelFor(wantedLevel);
      if (wantedLand !== landLevel && midLand) {
        renderer.setLand(midLand);
        landLevel = wantedLand;
      }

      renderer.draw(frame);
      chrome.update(frame);
      consecutiveFailures = 0;

      if (!firstPaintDone) {
        firstPaintDone = true;
        registry.onFirstPaint();
      }
      if (!midLandRequested) {
        midLandRequested = true;
        fetchLand("mid")
          .then((land) => {
            midLand = land;
          })
          .catch((error: unknown) => {
            console.error("history map: mid land fetch failed", error);
          });
      }
    } catch (error) {
      consecutiveFailures += 1;
      console.error("history map: frame failed", error);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopped = true;
        const message = document.createElement("p");
        message.className = "error";
        message.textContent = `The map stopped after repeated rendering errors: ${String(error)}`;
        app.replaceChildren(message);
      }
    } finally {
      if (!stopped) requestAnimationFrame(loop);
    }
  };
  requestAnimationFrame(loop);
}

void start();
