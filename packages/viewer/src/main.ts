import { fetchArtifacts } from "./data/artifacts";
import { Engine } from "./engine/engine";
import { MapRenderer } from "./render/canvas";
import { Chrome } from "./ui/chrome";

async function start(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) throw new Error("#app is missing from index.html");

  // versions.0.json is 3 MB gzipped but 35.3 MB uncompressed, so the parse is
  // the dominant cost, not the download. Say so rather than showing a blank
  // canvas.
  app.innerHTML = '<p class="loading">Loading the atlas...</p>';

  let artifacts: Awaited<ReturnType<typeof fetchArtifacts>>;
  try {
    artifacts = await fetchArtifacts();
  } catch (error) {
    app.innerHTML = `<p class="error">Could not load the map data: ${String(error)}</p>`;
    return;
  }

  app.innerHTML = '<canvas id="plate"></canvas><div id="chrome"></div>';
  const canvas = app.querySelector<HTMLCanvasElement>("#plate");
  const chromeRoot = app.querySelector<HTMLElement>("#chrome");
  if (!canvas || !chromeRoot) throw new Error("app shell failed to build");

  const engine = new Engine(artifacts.versions);
  const renderer = new MapRenderer(canvas, artifacts.versions, artifacts.land);
  const chrome = new Chrome(chromeRoot, engine);

  window.addEventListener("resize", () => renderer.resize());

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
      const frame = engine.advance(dt);
      renderer.draw(frame);
      chrome.update(frame);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error("history map: frame failed", error);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopped = true;
        const message = `The map stopped after repeated rendering errors: ${String(error)}`;
        app.innerHTML = `<p class="error">${message}</p>`;
      }
    } finally {
      if (!stopped) requestAnimationFrame(loop);
    }
  };
  requestAnimationFrame(loop);
}

void start();
