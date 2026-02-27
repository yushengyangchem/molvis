import { cpkColors } from "./cpkColors.js";
import { toMolWithInferredBondOrders } from "./modules/molBuilder.js";
import {
  addSelectionOverlay,
  buildMeasurementStatus,
  getPickedAtomIndex,
} from "./modules/measurement.js";

const state = {
  frames: [],
  source: "",
  finalConverged: null,
  viewer: null,
  currentIndex: 0,
  hasAutoZoomed: false,
  pendingFrameIndex: null,
  scheduledFrameRender: false,
  labelRenderTimer: null,
  selectedAtomFrame: null,
  selectedAtomIndices: [],
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
const finalConvergenceBadge = document.getElementById("finalConvergenceBadge");
const energyTrendChart = document.getElementById("energyTrendChart");
const viewerEl = document.getElementById("viewer");
const toggleAtomIndexBtn = document.getElementById("toggleAtomIndexBtn");
const exportXyzBtn = document.getElementById("exportXyzBtn");
const xyzTextPanel = document.getElementById("xyzTextPanel");
const xyzTextOutput = document.getElementById("xyzTextOutput");
const copyXyzBtn = document.getElementById("copyXyzBtn");
const clearMeasureBtn = document.getElementById("clearMeasureBtn");
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
    scheduleRenderFrame(idx);
  });

  toggleAtomIndexBtn.addEventListener("click", () => {
    state.showAtomIndices = !state.showAtomIndices;
    updateAtomIndexToggle();
    if (state.frames.length > 0) {
      renderFrame(state.currentIndex);
    }
  });
  exportXyzBtn?.addEventListener("click", () => {
    toggleCurrentFrameXyzText();
  });
  copyXyzBtn?.addEventListener("click", async () => {
    await copyXyzText();
  });

  clearMeasureBtn?.addEventListener("click", () => {
    clearSelectionAndRefresh("Measurement selection cleared.");
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

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!state.selectedAtomIndices.length) return;
    clearSelectionAndRefresh("Measurement selection cleared.");
  });
}

function loadFrames(frames, source, finalConverged = null) {
  state.frames = frames || [];
  state.source = source || "orca";
  state.finalConverged = finalConverged;
  state.currentIndex = 0;
  state.hasAutoZoomed = false;
  state.pendingFrameIndex = null;
  state.scheduledFrameRender = false;
  if (state.labelRenderTimer) {
    clearTimeout(state.labelRenderTimer);
    state.labelRenderTimer = null;
  }
  clearAtomSelection();
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
  scheduleRenderFrame(0);
}

function renderFrame(index, { showLabels = state.showAtomIndices } = {}) {
  if (!state.frames.length) return;
  if (!state.viewer) return;

  const frameChanged = state.currentIndex !== index;
  state.currentIndex = index;
  if (frameChanged) {
    clearAtomSelection();
  }

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
  state.viewer.setClickable({}, true, (atom) => {
    onAtomPicked(atom);
  });

  if (showLabels) {
    addAtomIndexLabels(frame.atoms);
  }

  if (state.selectedAtomFrame === state.currentIndex) {
    addSelectionOverlay(state.viewer, frame, state.selectedAtomIndices);
  }

  if (!state.hasAutoZoomed) {
    state.viewer.zoomTo();
    state.hasAutoZoomed = true;
  }

  state.viewer.render();
  updateMeta();
  syncVisibleXyzText();
}

function scheduleRenderFrame(index) {
  state.pendingFrameIndex = index;
  if (state.scheduledFrameRender) return;
  state.scheduledFrameRender = true;
  window.requestAnimationFrame(() => {
    state.scheduledFrameRender = false;
    const next = state.pendingFrameIndex;
    state.pendingFrameIndex = null;
    if (!Number.isInteger(next)) return;
    renderFrame(next, { showLabels: false });
    scheduleLabelRender(next);
  });
}

function scheduleLabelRender(index) {
  if (!state.showAtomIndices) return;
  if (state.labelRenderTimer) {
    clearTimeout(state.labelRenderTimer);
  }
  state.labelRenderTimer = setTimeout(() => {
    state.labelRenderTimer = null;
    if (state.currentIndex !== index) return;
    if (!state.showAtomIndices) return;
    renderFrame(index, { showLabels: true });
  }, 120);
}

function onAtomPicked(atom) {
  const atomIndex = getPickedAtomIndex(atom);
  if (!Number.isInteger(atomIndex) || atomIndex < 0) {
    return;
  }

  if (state.selectedAtomFrame !== state.currentIndex) {
    state.selectedAtomFrame = state.currentIndex;
    state.selectedAtomIndices = [];
  }

  const lastPicked =
    state.selectedAtomIndices[state.selectedAtomIndices.length - 1];
  if (lastPicked === atomIndex) {
    clearSelectionAndRefresh("Selection cleared.");
    return;
  }

  if (state.selectedAtomIndices.length >= 4) {
    state.selectedAtomIndices = [atomIndex];
  } else {
    state.selectedAtomIndices.push(atomIndex);
  }

  const frame = state.frames[state.currentIndex];
  setStatus(buildMeasurementStatus(frame, state.selectedAtomIndices));
  renderFrame(state.currentIndex);
}

function clearAtomSelection() {
  state.selectedAtomFrame = null;
  state.selectedAtomIndices = [];
}

function clearSelectionAndRefresh(statusText) {
  clearAtomSelection();
  if (statusText) {
    setStatus(statusText);
  }
  if (state.frames.length > 0) {
    renderFrame(state.currentIndex);
  }
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
  if (exportXyzBtn) {
    exportXyzBtn.disabled = total === 0;
  }
  updateXyzPanelToggleLabel();

  if (total > 0) {
    const energy = state.frames[state.currentIndex].energy_hartree;
    energyValue.textContent =
      energy == null ? "N/A" : energy.toFixed(ENERGY_DECIMALS);
  } else {
    energyValue.textContent = "N/A";
  }
  updateFinalConvergenceBadge();

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

function setStatus(text) {
  statusEl.textContent = text;
}

function toggleCurrentFrameXyzText() {
  if (!xyzTextPanel || !xyzTextOutput) return;
  if (!xyzTextPanel.classList.contains("hidden")) {
    xyzTextPanel.classList.add("hidden");
    updateXyzPanelToggleLabel();
    setStatus("XYZ text panel hidden.");
    return;
  }
  showCurrentFrameXyzText();
}

function showCurrentFrameXyzText() {
  if (!state.frames.length) {
    setStatus("No frame available to export.");
    return;
  }
  const frame = state.frames[state.currentIndex];
  const xyzText = formatFrameAsXyz(
    frame,
    state.currentIndex,
    state.frames.length,
  );
  xyzTextOutput.value = xyzText;
  xyzTextPanel.classList.remove("hidden");
  updateXyzPanelToggleLabel();
  xyzTextOutput.focus();
  xyzTextOutput.select();
  setStatus(`XYZ text ready for frame ${state.currentIndex + 1}.`);
}

function updateXyzPanelToggleLabel() {
  if (!exportXyzBtn || !xyzTextPanel) return;
  const shown = !xyzTextPanel.classList.contains("hidden");
  exportXyzBtn.textContent = shown ? "Hide XYZ Text" : "Show XYZ Text";
}

function syncVisibleXyzText() {
  if (!xyzTextPanel || !xyzTextOutput) return;
  if (xyzTextPanel.classList.contains("hidden")) return;
  if (!state.frames.length) {
    xyzTextOutput.value = "";
    return;
  }
  const frame = state.frames[state.currentIndex];
  xyzTextOutput.value = formatFrameAsXyz(
    frame,
    state.currentIndex,
    state.frames.length,
  );
}

function formatFrameAsXyz(frame, frameIndex, totalFrames) {
  const atomCount = frame?.atoms?.length ?? 0;
  const energy =
    frame?.energy_hartree == null
      ? "N/A"
      : frame.energy_hartree.toFixed(ENERGY_DECIMALS);
  const header = `${atomCount}\nFrame ${frameIndex + 1}/${totalFrames}; Energy(Hartree)=${energy}\n`;
  const atomLines = (frame?.atoms || [])
    .map(
      (atom) =>
        `${atom.element} ${atom.x.toFixed(10)} ${atom.y.toFixed(10)} ${atom.z.toFixed(10)}`,
    )
    .join("\n");
  return atomLines ? `${header}${atomLines}\n` : header;
}

async function copyXyzText() {
  if (!xyzTextOutput) return;
  const text = xyzTextOutput.value;
  if (!text) {
    setStatus("No XYZ text to copy.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("XYZ text copied to clipboard.");
  } catch {
    xyzTextOutput.focus();
    xyzTextOutput.select();
    setStatus("Auto-copy blocked; text selected, press Ctrl+C.");
  }
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
    loadFrames(data.frames, data.source, data.final_converged ?? null);
  } catch (err) {
    setStatus(`Failed to load data: ${err.message}`);
  }
}

function updateFinalConvergenceBadge() {
  if (!finalConvergenceBadge) return;

  finalConvergenceBadge.classList.remove(
    "converged",
    "not-converged",
    "unknown",
  );
  if (state.finalConverged === true) {
    finalConvergenceBadge.classList.add("converged");
    finalConvergenceBadge.textContent = "Converged";
    return;
  }
  if (state.finalConverged === false) {
    finalConvergenceBadge.classList.add("not-converged");
    finalConvergenceBadge.textContent = "Not converged";
    return;
  }
  finalConvergenceBadge.classList.add("not-converged");
  finalConvergenceBadge.textContent = "Not converged";
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
