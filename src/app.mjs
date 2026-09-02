import { Renderer } from './lib/render.mjs';
import { changeYears, fadeYearsFor } from './lib/temporal.mjs';

const $ = (id) => document.getElementById(id);

// Speed is the only control. 4 yr/s is the reading speed that felt right, but
// the full span of Cliopatria at 4 yr/s is a 23-minute sit, so the slider needs
// to reach navigation speeds too. Logarithmic, because the interesting range is
// 1-20 and a linear slider would bury all of it in the first 10% of travel.
const SPEED_MIN = 1;
const SPEED_MAX = 200;
const DEFAULT_SPEED = 4;

const toSpeed = (t) =>
  SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, t);
const fromSpeed = (s) =>
  Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);

const state = { year: 0, playing: false, yearsPerSecond: DEFAULT_SPEED };

let renderer = null;
let slice = null;
let maxFadeYears = 12;
let hovered = null;

const formatYear = (year) => {
  const y = Math.round(year);
  return y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`;
};

function paintTickTrack() {
  const canvas = $('ticks');
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const { from, to } = slice.meta.era;
  ctx.fillStyle = 'rgba(120, 104, 84, 0.42)';
  for (const year of changeYears(slice.versions, from, to)) {
    ctx.fillRect(((year - from) / (to - from)) * rect.width, 0, 1, rect.height);
  }
}

function updateLegend(active) {
  const names = new Map();
  for (const entry of active) {
    const name = slice.polities[entry.version.p].name;
    const prev = names.get(name);
    if (!prev || entry.alpha > prev.alpha) {
      names.set(name, { alpha: entry.alpha, flash: entry.flash, delta: entry.version.delta });
    }
  }
  const rows = [...names.entries()].sort((a, b) => b[1].alpha - a[1].alpha);
  $('legend').innerHTML = rows
    .map(([name, v]) => {
      const mark = v.flash > 0.05 ? '<i class="mark grow"></i>'
        : v.delta !== null && v.delta < 0 ? '<i class="mark shrink"></i>'
        : '<i class="mark"></i>';
      return `<li style="opacity:${(0.4 + v.alpha * 0.6).toFixed(2)}">${mark}${name}</li>`;
    })
    .join('');
  $('onscreen').textContent = rows.length;
}

function frame(now) {
  if (!renderer) return;
  if (state.playing) {
    const dt = Math.min((now - (frame.last ?? now)) / 1000, 0.1);
    state.year += dt * state.yearsPerSecond;
    if (state.year > slice.meta.era.to) state.year = slice.meta.era.from;
    $('scrub').value = String(state.year);
  }
  frame.last = now;

  const fade = fadeYearsFor(state.yearsPerSecond, maxFadeYears);
  const stats = renderer.draw(state.year, fade);

  $('year').textContent = formatYear(state.year);
  $('fade').textContent = `${fade.toFixed(1)} yr fade`;
  updateLegend(stats.active);

  requestAnimationFrame(frame);
}

function bindControls() {
  const scrub = $('scrub');
  scrub.min = String(slice.meta.era.from);
  scrub.max = String(slice.meta.era.to);
  scrub.step = '0.5';
  scrub.value = String(state.year);
  scrub.addEventListener('input', () => {
    state.year = Number(scrub.value);
    if (state.playing) $('play').click();
  });

  $('play').addEventListener('click', () => {
    state.playing = !state.playing;
    frame.last = performance.now();
    $('play').textContent = state.playing ? 'Pause' : 'Play';
  });

  const speed = $('speed');
  speed.value = String(fromSpeed(DEFAULT_SPEED));
  const syncSpeed = () => {
    state.yearsPerSecond = toSpeed(Number(speed.value));
    $('speedValue').textContent = `${state.yearsPerSecond.toFixed(state.yearsPerSecond < 10 ? 1 : 0)} yr/s`;
  };
  speed.addEventListener('input', syncSpeed);
  syncSpeed();

  const canvas = $('map');
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    hovered = hit;
    canvas.style.cursor = hit ? 'pointer' : 'default';
    const tip = $('tip');
    if (hit) {
      const polity = slice.polities[hit.version.p];
      tip.textContent = `${polity.name} · ${formatYear(hit.version.from)} to ${formatYear(hit.version.to)}`;
      tip.style.opacity = '1';
    } else {
      tip.style.opacity = '0';
    }
  });

  canvas.addEventListener('click', () => {
    if (!hovered) return;
    const polity = slice.polities[hovered.version.p];
    // Cliopatria carries a Wikipedia phrase and a Wikidata id on every row, so
    // click-through to context costs nothing and is most of the curiosity goal.
    const target = polity.wikipedia
      ? `https://en.wikipedia.org/wiki/${polity.wikipedia}`
      : polity.wikidata
        ? `https://www.wikidata.org/wiki/${polity.wikidata}`
        : null;
    if (target) window.open(target, '_blank', 'noopener');
  });

  window.addEventListener('resize', () => { renderer.resize(); paintTickTrack(); });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  });
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function main() {
  const params = new URLSearchParams(location.search);
  try {
    slice = await loadJson(params.get('slice') ?? 'data/slice.json');
  } catch (err) {
    $('legend').innerHTML = `<li>Could not load the slice. Run scripts/extract.mjs, then serve over http.</li>`;
    return;
  }

  // Land is optional so the app still runs before Natural Earth is downloaded.
  let land = null;
  try { land = await loadJson('data/land.json'); } catch { land = null; }
  if (!land) $('coastnote').textContent = 'No basemap loaded — run scripts/basemap.mjs';

  state.year = slice.meta.era.from;
  if (slice.meta.medianDuration) {
    maxFadeYears = Math.max(4, Math.round(slice.meta.medianDuration / 6));
  }

  $('slice').textContent =
    `${slice.meta.region.label} · ${slice.meta.counts.polities} polities · ${slice.meta.counts.versions} versions`;

  renderer = new Renderer($('map'), slice, land);
  bindControls();
  paintTickTrack();
  requestAnimationFrame(frame);
}

main();
