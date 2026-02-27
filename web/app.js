import { cpkColors } from "./cpkColors.js";

const state = {
  frames: [],
  viewer: null,
  currentIndex: 0,
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

  const xyz = toXYZ(frame.atoms);
  state.viewer.clear();
  state.viewer.addModel(xyz, "xyz");
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

function toXYZ(atoms) {
  const lines = [String(atoms.length), "frame"];
  for (const atom of atoms) {
    lines.push(`${atom.element} ${atom.x} ${atom.y} ${atom.z}`);
  }
  return lines.join("\n");
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
