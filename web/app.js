import { cpkColors } from "./cpkColors.js";

const state = {
  frames: [],
  viewer: null,
  currentIndex: 0,
  inferredMolCache: new Map(),
  molLib: null,
  plotLib: null,
  trendEventsBound: false,
  trendRenderToken: 0,
  showAtomIndices: false,
};

const statusEl = document.getElementById("status");
const slider = document.getElementById("frameSlider");
const frameInfo = document.getElementById("frameInfo");
const energyValue = document.getElementById("energyValue");
const energyTrendChart = document.getElementById("energyTrendChart");
const viewerEl = document.getElementById("viewer");
const toggleAtomIndexBtn = document.getElementById("toggleAtomIndexBtn");
const ENERGY_DECIMALS = 12;
const BOND_TOLERANCE_SCALE = 1.25;
const MIN_BOND_DISTANCE = 0.35;

const COVALENT_RADII = {
  H: 0.31,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Br: 1.2,
  I: 1.39,
  Si: 1.11,
};

const PREFERRED_VALENCE = {
  H: 1,
  B: 3,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  P: 3,
  S: 2,
  Cl: 1,
  Br: 1,
  I: 1,
  Si: 4,
};
const AROMATIC_ELEMENTS = new Set(["B", "C", "N", "O", "P", "S"]);

bindEvents();
bootstrap();

async function bootstrap() {
  await initViewer();
  await loadData();
}

async function initViewer() {
  if (state.viewer) return true;
  const molLib = await load3DMol();
  if (!molLib) {
    return false;
  }

  state.viewer = molLib.createViewer(viewerEl, {
    backgroundColor: "white",
  });
  resizeViewer();
  return true;
}

function bindEvents() {
  slider.addEventListener("input", (e) => {
    const idx = Number(e.target.value);
    renderFrame(idx);
  });
  toggleAtomIndexBtn.addEventListener("click", () => {
    state.showAtomIndices = !state.showAtomIndices;
    updateAtomIndexToggle();
    if (state.frames.length > 0) {
      renderFrame(state.currentIndex);
    }
  });

  window.addEventListener("resize", () => {
    resizeViewer();
    resizeEnergyTrend();
  });
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      resizeViewer();
      resizeEnergyTrend();
    });
    observer.observe(viewerEl);
    if (energyTrendChart) {
      observer.observe(energyTrendChart);
    }
  }
}

function loadFrames(frames, source) {
  state.frames = frames || [];
  state.currentIndex = 0;
  state.inferredMolCache.clear();
  slider.max = Math.max(0, state.frames.length - 1);
  slider.value = 0;

  if (state.frames.length === 0) {
    setStatus(`No frames were parsed from ${source}.`);
    clearViewer();
    updateMeta();
    return;
  }

  setStatus(`Loaded ${state.frames.length} frame(s) from ${source}.`);
  renderFrame(0);
}

function renderFrame(index) {
  if (!state.frames.length) return;
  if (!state.viewer) return;
  state.currentIndex = index;
  const frame = state.frames[index];

  let mol = state.inferredMolCache.get(index);
  if (!mol) {
    mol = toMolWithInferredBondOrders(frame.atoms);
    state.inferredMolCache.set(index, mol);
  }
  state.viewer.clear();
  state.viewer.addModel(mol, "mol");
  const colorscheme = { prop: "elem", map: cpkColors };
  state.viewer.setStyle(
    {},
    {
      stick: { radius: 0.15, colorscheme },
      sphere: { scale: 0.3, colorscheme },
    },
  );
  if (state.showAtomIndices) {
    addAtomIndexLabels(frame.atoms);
  }
  state.viewer.zoomTo();
  state.viewer.render();

  updateMeta();
}

function clearViewer() {
  if (!state.viewer) return;
  state.viewer.clear();
  state.viewer.render();
}

function resizeViewer() {
  if (!state.viewer) return;
  state.viewer.resize();
  state.viewer.render();
}

function resizeEnergyTrend() {
  if (!state.plotLib || !energyTrendChart) return;
  state.plotLib.Plots.resize(energyTrendChart);
}

function updateMeta() {
  const total = state.frames.length;
  const current = total > 0 ? state.currentIndex + 1 : 0;
  frameInfo.textContent = `${current} / ${total}`;

  if (total > 0) {
    const energy = state.frames[state.currentIndex].energy_hartree;
    energyValue.textContent =
      energy == null ? "N/A" : energy.toFixed(ENERGY_DECIMALS);
  } else {
    energyValue.textContent = "N/A";
  }
  drawEnergyTrend();
}

function updateAtomIndexToggle() {
  if (state.showAtomIndices) {
    toggleAtomIndexBtn.textContent = "Hide Atom Indices";
    toggleAtomIndexBtn.classList.add("active");
    toggleAtomIndexBtn.setAttribute("aria-pressed", "true");
  } else {
    toggleAtomIndexBtn.textContent = "Show Atom Indices";
    toggleAtomIndexBtn.classList.remove("active");
    toggleAtomIndexBtn.setAttribute("aria-pressed", "false");
  }
}

function addAtomIndexLabels(atoms) {
  atoms.forEach((atom, index) => {
    state.viewer.addLabel(String(index), {
      position: { x: atom.x, y: atom.y, z: atom.z },
      fontColor: "#ffffff",
      backgroundColor: "#111827",
      backgroundOpacity: 0.55,
      borderThickness: 0,
      fontSize: 12,
      bold: true,
      inFront: true,
    });
  });
}

function toMolWithInferredBondOrders(atoms) {
  const bonds = inferBondsWithOrders(atoms);
  const lines = [
    "molvis",
    "3Dmol inferred bonds",
    "",
    formatMolCounts(atoms.length, bonds.length),
  ];

  for (const atom of atoms) {
    lines.push(
      `${padMolFloat(atom.x, 10, 4)}${padMolFloat(atom.y, 10, 4)}${padMolFloat(atom.z, 10, 4)} ${padMolAtom(atom.element)}  0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  }

  for (const bond of bonds) {
    lines.push(
      `${String(bond.a + 1).padStart(3, " ")}${String(bond.b + 1).padStart(3, " ")}${String(bond.order).padStart(3, " ")}  0  0  0  0`,
    );
  }

  lines.push("M  END");
  return lines.join("\n");
}

function inferBondsWithOrders(atoms) {
  const candidateBonds = [];
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const a = atoms[i];
      const b = atoms[j];
      const dist = distance(a, b);
      const maxDist =
        (getCovalentRadius(a.element) + getCovalentRadius(b.element)) *
        BOND_TOLERANCE_SCALE;
      if (dist >= MIN_BOND_DISTANCE && dist <= maxDist) {
        candidateBonds.push({ a: i, b: j, dist, order: 1 });
      }
    }
  }

  const valenceUsed = new Array(atoms.length).fill(0);
  for (const bond of candidateBonds) {
    valenceUsed[bond.a] += 1;
    valenceUsed[bond.b] += 1;
  }

  const remainingValence = atoms.map((atom, idx) => {
    const preferred = getPreferredValence(atom.element);
    return Math.max(0, preferred - valenceUsed[idx]);
  });

  const incrementOrderPass = () => {
    let changed = false;
    const sorted = [...candidateBonds].sort((x, y) => x.dist - y.dist);
    for (const bond of sorted) {
      const maxOrder = getMaxBondOrder(
        atoms[bond.a].element,
        atoms[bond.b].element,
      );
      if (bond.order >= maxOrder) continue;
      if (remainingValence[bond.a] <= 0 || remainingValence[bond.b] <= 0)
        continue;
      bond.order += 1;
      remainingValence[bond.a] -= 1;
      remainingValence[bond.b] -= 1;
      changed = true;
    }
    return changed;
  };

  incrementOrderPass();
  incrementOrderPass();
  assignAromaticRings(atoms, candidateBonds);

  return candidateBonds;
}

function assignAromaticRings(atoms, bonds) {
  if (bonds.length < 6) return;
  const adjacency = new Map();
  const bondByEdge = new Map();

  for (const bond of bonds) {
    if (!adjacency.has(bond.a)) adjacency.set(bond.a, []);
    if (!adjacency.has(bond.b)) adjacency.set(bond.b, []);
    adjacency.get(bond.a).push(bond.b);
    adjacency.get(bond.b).push(bond.a);
    bondByEdge.set(edgeKey(bond.a, bond.b), bond);
  }

  const rings = findSixMemberCycles(atoms.length, adjacency);
  for (const ring of rings) {
    if (!isAromaticRing(ring, atoms, adjacency, bondByEdge)) continue;
    applyKekulePattern(ring, bondByEdge);
  }
}

function applyKekulePattern(ring, bondByEdge) {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const bond = bondByEdge.get(edgeKey(a, b));
    if (!bond) continue;
    bond.order = i % 2 === 0 ? 2 : 1;
  }
}

function isAromaticRing(ring, atoms, adjacency, bondByEdge) {
  const lengths = [];

  for (let i = 0; i < ring.length; i += 1) {
    const atomIdx = ring[i];
    const element = normalizeElement(atoms[atomIdx]?.element);
    if (!AROMATIC_ELEMENTS.has(element)) return false;
    if ((adjacency.get(atomIdx)?.length ?? 0) < 2) return false;

    const next = ring[(i + 1) % ring.length];
    const bond = bondByEdge.get(edgeKey(atomIdx, next));
    if (!bond) return false;
    lengths.push(bond.dist);
  }

  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  const avgLen =
    lengths.reduce((sum, value) => sum + value, 0) / lengths.length;

  if (avgLen < 1.3 || avgLen > 1.47) return false;
  if (maxLen - minLen > 0.16) return false;
  return true;
}

function findSixMemberCycles(atomCount, adjacency) {
  const seen = new Set();
  const cycles = [];

  const dfs = (start, current, path, used) => {
    if (path.length === 6) {
      if (adjacency.get(current)?.includes(start)) {
        const key = canonicalCycleKey(path);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...path]);
        }
      }
      return;
    }

    const neighbors = adjacency.get(current) ?? [];
    for (const next of neighbors) {
      if (next === start) continue;
      if (used.has(next)) continue;
      if (next < start) continue;
      used.add(next);
      path.push(next);
      dfs(start, next, path, used);
      path.pop();
      used.delete(next);
    }
  };

  for (let start = 0; start < atomCount; start += 1) {
    const used = new Set([start]);
    dfs(start, start, [start], used);
  }

  return cycles;
}

function canonicalCycleKey(cycle) {
  const n = cycle.length;
  const variants = [];

  for (let shift = 0; shift < n; shift += 1) {
    const forward = [];
    const backward = [];
    for (let i = 0; i < n; i += 1) {
      forward.push(cycle[(shift + i) % n]);
      backward.push(cycle[(shift - i + n) % n]);
    }
    variants.push(forward.join("-"));
    variants.push(backward.join("-"));
  }

  variants.sort();
  return variants[0];
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function getMaxBondOrder(elemA, elemB) {
  if (isSingleOnlyElement(elemA) || isSingleOnlyElement(elemB)) {
    return 1;
  }
  return 3;
}

function isSingleOnlyElement(element) {
  const normalized = normalizeElement(element);
  return ["H", "F", "Cl", "Br", "I"].includes(normalized);
}

function getPreferredValence(element) {
  return PREFERRED_VALENCE[normalizeElement(element)] ?? 4;
}

function getCovalentRadius(element) {
  return COVALENT_RADII[normalizeElement(element)] ?? 0.77;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

function formatMolCounts(atomCount, bondCount) {
  return `${String(atomCount).padStart(3, " ")}${String(bondCount).padStart(3, " ")}  0  0  0  0  0  0  0  0  1 V2000`;
}

function padMolFloat(value, width, decimals) {
  return Number(value).toFixed(decimals).padStart(width, " ");
}

function padMolAtom(element) {
  return normalizeElement(element).slice(0, 3).padEnd(3, " ");
}

function normalizeElement(element) {
  if (!element) return "C";
  const text = String(element).trim();
  if (!text) return "C";
  if (text.length === 1) return text.toUpperCase();
  return text[0].toUpperCase() + text.slice(1).toLowerCase();
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function drawEnergyTrend() {
  if (!energyTrendChart) return;
  const token = ++state.trendRenderToken;
  const plotLib = await loadPlotly();
  if (!plotLib) {
    renderTrendFallback("Failed to load chart library");
    return;
  }
  if (token !== state.trendRenderToken) return;

  const points = state.frames
    .map((frame, idx) => ({ index: idx, energy: frame.energy_hartree }))
    .filter((point) => Number.isFinite(point.energy));

  if (points.length < 2) {
    renderTrendFallback("Not enough energy points to draw trend");
    return;
  }

  const x = points.map((point) => point.index);
  const y = points.map((point) => point.energy);
  const markerColor = points.map((point) =>
    point.index === state.currentIndex ? "#0f8a45" : "#1e63d7",
  );
  const markerSize = points.map((point) =>
    point.index === state.currentIndex ? 11 : 7,
  );

  const data = [
    {
      type: "scatter",
      mode: "lines+markers",
      x,
      y,
      line: { color: "#1e63d7", width: 2.4, shape: "spline", smoothing: 0.45 },
      marker: { color: markerColor, size: markerSize },
      hovertemplate: "Frame %{x}<br>Energy %{y:.12f}<extra></extra>",
    },
  ];

  const layout = {
    margin: { l: 68, r: 16, t: 12, b: 48 },
    showlegend: false,
    paper_bgcolor: "rgba(0, 0, 0, 0)",
    plot_bgcolor: "rgba(255, 255, 255, 0.55)",
    dragmode: "zoom",
    xaxis: {
      title: "Frame Index",
      showgrid: true,
      gridcolor: "#e8eefb",
      zeroline: false,
      tickmode: "auto",
    },
    yaxis: {
      title: "Energy (Hartree)",
      showgrid: true,
      gridcolor: "#e8eefb",
      zeroline: false,
    },
  };

  const config = {
    responsive: true,
    scrollZoom: true,
    displaylogo: false,
    doubleClick: "reset+autosize",
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
  };

  await plotLib.react(energyTrendChart, data, layout, config);
  if (token !== state.trendRenderToken) return;

  if (!state.trendEventsBound) {
    energyTrendChart.on("plotly_click", (event) => {
      const frameIndex = Number(event?.points?.[0]?.x);
      if (!Number.isInteger(frameIndex)) return;
      if (frameIndex < 0 || frameIndex >= state.frames.length) return;
      slider.value = String(frameIndex);
      renderFrame(frameIndex);
    });
    state.trendEventsBound = true;
  }
}

function renderTrendFallback(message) {
  if (!energyTrendChart) return;
  if (state.plotLib) {
    state.plotLib.purge(energyTrendChart);
  }
  energyTrendChart.innerHTML = `<div class="energy-chart-hint">${message}</div>`;
}

async function loadData() {
  try {
    if (!(await initViewer())) return;
    updateAtomIndexToggle();
    setStatus("Loading parsed ORCA data...");
    const response = await fetch("/api/data");
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    const data = await response.json();
    loadFrames(data.frames, data.source);
  } catch (err) {
    setStatus(`Failed to load data: ${err.message}`);
  }
}

async function load3DMol() {
  if (state.molLib) {
    return state.molLib;
  }
  if (window.$3Dmol) {
    state.molLib = window.$3Dmol;
    return state.molLib;
  }

  const candidates = [
    "/3Dmol-min.js",
    "https://3dmol.org/build/3Dmol-min.js",
    "https://cdn.jsdelivr.net/npm/3dmol/build/3Dmol-min.js",
    "https://unpkg.com/3dmol/build/3Dmol-min.js",
  ];

  for (const src of candidates) {
    try {
      await appendScript(src);
      if (window.$3Dmol) {
        state.molLib = window.$3Dmol;
        return state.molLib;
      }
    } catch {
      // Try next source.
    }
  }

  setStatus(
    "Failed to load 3Dmol.js. Check your network, or vendor 3Dmol-min.js locally under /web.",
  );
  return null;
}

async function loadPlotly() {
  if (state.plotLib) {
    return state.plotLib;
  }
  if (window.Plotly) {
    state.plotLib = window.Plotly;
    return state.plotLib;
  }

  const candidates = [
    "/plotly.min.js",
    "https://cdn.plot.ly/plotly-2.35.2.min.js",
    "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js",
    "https://unpkg.com/plotly.js-dist-min@2.35.2/plotly.min.js",
  ];

  for (const src of candidates) {
    try {
      await appendScript(src);
      if (window.Plotly) {
        state.plotLib = window.Plotly;
        return state.plotLib;
      }
    } catch {
      // Try next source.
    }
  }

  return null;
}

function appendScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(script);
  });
}

async function parseApiError(response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const rawText = await response.text();
  if (!rawText) {
    return fallback;
  }

  try {
    const payload = JSON.parse(rawText);
    if (!payload || !payload.error) {
      return rawText;
    }
    const { code, message, details } = payload.error;
    return details
      ? `[${code}] ${message} (${details})`
      : `[${code}] ${message}`;
  } catch {
    return rawText;
  }
}
