import { cpkColors } from "./cpkColors.js";
import { toMolWithInferredBondOrders } from "./modules/molBuilder.js";
import {
  copyCurrentText,
  syncVisibleText,
  toggleCurrentFrameText,
  updateTextPanelToggleLabel,
} from "./modules/exportPanel.js";
import { renderFrequencyPanel as renderFrequencyPanelView } from "./modules/frequencyPanel.js";
import {
  addSelectionOverlay,
  buildMeasurementStatus,
  getPickedAtomIndex,
} from "./modules/measurement.js";
import { renderThermochemistryPanel as renderThermochemistryPanelView } from "./modules/thermochemistry.js";
import {
  renderFrame as renderFrameView,
  clearViewer as clearViewerView,
  resizeViewer as resizeViewerView,
  scheduleLabelRender as scheduleLabelRenderView,
  updateAtomIndexToggle as updateAtomIndexToggleView,
} from "./modules/viewerFrame.js";
import {
  renderVibrationFrame as renderVibrationFrameView,
  sanitizeFrameCount,
  startVibrationPlayback as startVibrationPlaybackView,
  stopVibrationPlayback as stopVibrationPlaybackView,
} from "./modules/vibration.js";
import { drawEnergyTrendChart } from "./modules/trendChart.js";

const state = {
  frames: [],
  source: "",
  orcaVersion: null,
  finalConverged: null,
  frequency: null,
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
  charge: null,
  multiplicity: null,
  textExportMode: "xyz",
  vibration: {
    modes: [],
    activeMode: null,
    parsedFrames: [],
    currentFrame: 0,
    timer: null,
    intervalMs: 120,
    frameCount: 21,
  },
};

const statusTextEl = document.getElementById("statusText");
const statusParserVersionEl = document.getElementById("statusParserVersion");
const slider = document.getElementById("frameSlider");
const frameInfo = document.getElementById("frameInfo");
const energyValue = document.getElementById("energyValue");
const finalConvergenceBadge = document.getElementById("finalConvergenceBadge");
const energyTrendChart = document.getElementById("energyTrendChart");
const viewerEl = document.getElementById("viewer");
const toggleAtomIndexBtn = document.getElementById("toggleAtomIndexBtn");
const exportXyzBtn = document.getElementById("exportXyzBtn");
const exportGjfBtn = document.getElementById("exportGjfBtn");
const xyzTextPanel = document.getElementById("xyzTextPanel");
const xyzTextOutput = document.getElementById("xyzTextOutput");
const textPanelTitle = document.getElementById("textPanelTitle");
const copyXyzBtn = document.getElementById("copyXyzBtn");
const clearMeasureBtn = document.getElementById("clearMeasureBtn");
const freqStatus = document.getElementById("freqStatus");
const imagModeList = document.getElementById("imagModeList");
const vibrationPanel = document.getElementById("vibrationPanel");
const vibrationTitle = document.getElementById("vibrationTitle");
const vibrationSlider = document.getElementById("vibrationSlider");
const vibrationFrameInfo = document.getElementById("vibrationFrameInfo");
const vibrationFrameCountInput = document.getElementById("vibrationFrameCount");
const thermoPanel = document.getElementById("thermoPanel");
const thermoElectronicEnergy = document.getElementById(
  "thermoElectronicEnergy",
);
const thermoGibbsFreeEnergy = document.getElementById("thermoGibbsFreeEnergy");
const thermoGibbsCorrection = document.getElementById("thermoGibbsCorrection");
const ENERGY_DECIMALS = 12;
const THERMO_DECIMALS = 11;

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
  exportGjfBtn?.addEventListener("click", () => {
    toggleCurrentFrameGjfText();
  });
  copyXyzBtn?.addEventListener("click", async () => {
    await copyXyzText();
  });

  clearMeasureBtn?.addEventListener("click", () => {
    clearSelectionAndRefresh("Measurement selection cleared.");
  });

  vibrationSlider?.addEventListener("input", (e) => {
    const idx = Number(e.target.value);
    if (!Number.isInteger(idx)) return;
    renderVibrationFrame(idx);
  });

  vibrationFrameCountInput?.addEventListener("input", () => {
    const next = sanitizeFrameCount(vibrationFrameCountInput.value);
    state.vibration.frameCount = next;
    vibrationFrameCountInput.value = String(next);
    if (state.vibration.activeMode) {
      startVibrationPlayback(state.vibration.activeMode);
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

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!state.selectedAtomIndices.length) return;
    clearSelectionAndRefresh("Measurement selection cleared.");
  });
}

function loadFrames(
  frames,
  source,
  orcaVersionValue = null,
  finalConverged = null,
  charge = null,
  multiplicity = null,
  frequency = {
    has_frequency: false,
    status: "No frequency calculation",
    imaginary_modes: [],
    thermochemistry: null,
  },
) {
  state.frames = frames || [];
  state.source = source || "molecule";
  state.orcaVersion = orcaVersionValue;
  updateStatusOrcaVersion();
  state.finalConverged = finalConverged;
  state.charge = charge;
  state.multiplicity = multiplicity;
  state.frequency = frequency;
  state.textExportMode = "xyz";
  state.currentIndex = 0;
  state.hasAutoZoomed = false;
  state.pendingFrameIndex = null;
  state.scheduledFrameRender = false;
  if (state.labelRenderTimer) {
    clearTimeout(state.labelRenderTimer);
    state.labelRenderTimer = null;
  }
  clearAtomSelection();
  stopVibrationPlayback({ silent: true });
  state.vibration.modes = state.frequency?.imaginary_modes || [];
  state.inferredMolCache.clear();
  slider.max = Math.max(0, state.frames.length - 1);
  const initialIndex = Math.max(0, state.frames.length - 1);
  slider.value = initialIndex;

  if (state.frames.length === 0) {
    setStatus(`No frames were parsed from ${source}.`);
    clearViewer();
    updateMeta();
    renderFrequencyPanel();
    renderThermochemistryPanel();
    return;
  }

  setStatus(`Loaded ${state.frames.length} frame(s) from ${source}.`);
  renderFrequencyPanel();
  renderThermochemistryPanel();
  scheduleRenderFrame(initialIndex);
}

function renderFrame(index, { showLabels = state.showAtomIndices } = {}) {
  renderFrameView(
    state,
    index,
    {
      toMolWithInferredBondOrders,
      cpkColors,
      onAtomPicked,
      addSelectionOverlay,
      updateMeta,
      syncVisibleText: () =>
        syncVisibleText(state, getExportElements(), ENERGY_DECIMALS),
      clearAtomSelection,
    },
    { showLabels },
  );
}

function scheduleRenderFrame(index) {
  if (state.vibration.activeMode) {
    stopVibrationPlayback({ silent: true });
  }
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
  scheduleLabelRenderView(state, index, renderFrame);
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
  clearViewerView(state.viewer);
}

function resizeViewer() {
  resizeViewerView(state.viewer);
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
  if (exportGjfBtn) {
    exportGjfBtn.disabled = total === 0;
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

function getFrequencyStatusView(report) {
  const hasFrequency = Boolean(report?.has_frequency);
  const modeCount = Array.isArray(report?.imaginary_modes)
    ? report.imaginary_modes.length
    : 0;

  if (!hasFrequency) {
    return {
      text: "No frequency calculation (single-point energy only)",
      className: "freq-status-neutral",
    };
  }
  if (modeCount >= 2) {
    return {
      text: `Found ${modeCount} imaginary mode(s) (warning)`,
      className: "freq-status-warn",
    };
  }
  if (modeCount === 1) {
    return {
      text: "Found 1 imaginary mode (transition state)",
      className: "freq-status-ok",
    };
  }
  return {
    text: "No imaginary modes (intermediate)",
    className: "freq-status-ok",
  };
}

function renderFrequencyPanel() {
  const report = state.frequency || {};
  if (freqStatus) {
    const view = getFrequencyStatusView(report);
    freqStatus.textContent = view.text;
    freqStatus.classList.remove(
      "freq-status-neutral",
      "freq-status-ok",
      "freq-status-warn",
    );
    freqStatus.classList.add(view.className);
  }
  renderFrequencyPanelView(report, state.vibration.activeMode, imagModeList, {
    start: (mode) => startVibrationPlayback(mode),
    stop: () => stopVibrationPlayback(),
  });
}

function renderThermochemistryPanel() {
  renderThermochemistryPanelView(
    state.frequency || {},
    getThermoElements(),
    THERMO_DECIMALS,
  );
}

function updateAtomIndexToggle() {
  updateAtomIndexToggleView(toggleAtomIndexBtn, state.showAtomIndices);
}

function setStatus(text) {
  // Keep the status area stable: only show load/result level messages.
  const allowed =
    text.startsWith("Loaded ") ||
    text.startsWith("No frames were parsed") ||
    text.startsWith("Failed to load data");
  if (!allowed) return;
  if (statusTextEl) {
    statusTextEl.textContent = text;
  }
}

function updateStatusOrcaVersion() {
  if (!statusParserVersionEl) return;
  if (state.orcaVersion) {
    statusParserVersionEl.textContent = `Recognized as ORCA file, version ${state.orcaVersion}`;
    statusParserVersionEl.classList.remove("hidden");
    return;
  }
  statusParserVersionEl.textContent = "";
  statusParserVersionEl.classList.add("hidden");
}

function getExportElements() {
  return {
    exportXyzBtn,
    exportGjfBtn,
    xyzTextPanel,
    xyzTextOutput,
    textPanelTitle,
  };
}

function getThermoElements() {
  return {
    thermoPanel,
    thermoElectronicEnergy,
    thermoGibbsFreeEnergy,
    thermoGibbsCorrection,
  };
}

function getVibrationDeps() {
  return {
    vibrationPanel,
    vibrationTitle,
    vibrationSlider,
    vibrationFrameInfo,
    vibrationFrameCountInput,
    clearMeasureBtn,
    toMolWithInferredBondOrders,
    cpkColors,
    clearAtomSelection,
    renderFrame,
    renderFrequencyPanel,
    setStatus,
  };
}

function toggleCurrentFrameXyzText() {
  toggleCurrentFrameText(
    "xyz",
    state,
    getExportElements(),
    setStatus,
    ENERGY_DECIMALS,
  );
}

function toggleCurrentFrameGjfText() {
  toggleCurrentFrameText(
    "gjf",
    state,
    getExportElements(),
    setStatus,
    ENERGY_DECIMALS,
  );
}

function updateXyzPanelToggleLabel() {
  updateTextPanelToggleLabel(state, getExportElements());
}

function syncVisibleXyzText() {
  syncVisibleText(state, getExportElements(), ENERGY_DECIMALS);
}

async function copyXyzText() {
  await copyCurrentText(state, getExportElements(), setStatus);
}

function startVibrationPlayback(mode) {
  startVibrationPlaybackView(state, mode, getVibrationDeps());
}

function renderVibrationFrame(index) {
  renderVibrationFrameView(state, index, getVibrationDeps());
}

function stopVibrationPlayback({ silent = false } = {}) {
  stopVibrationPlaybackView(state, getVibrationDeps(), { silent });
}

async function drawEnergyTrend() {
  await drawEnergyTrendChart(
    state,
    energyTrendChart,
    loadPlotly,
    (frameIndex) => {
      if (frameIndex < 0 || frameIndex >= state.frames.length) return;
      slider.value = String(frameIndex);
      renderFrame(frameIndex);
    },
  );
}

async function loadData() {
  try {
    if (!(await initViewer())) return;
    updateAtomIndexToggle();
    setStatus("Loading parsed molecule data...");
    const response = await fetch("/api/data");
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    const data = await response.json();
    loadFrames(
      data.frames,
      data.source,
      data.orca_version ?? null,
      data.final_converged ?? null,
      data.charge ?? null,
      data.multiplicity ?? null,
      data.frequency ?? {
        has_frequency: false,
        status: "No frequency calculation",
        imaginary_modes: [],
        thermochemistry: null,
      },
    );
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
  finalConvergenceBadge.classList.add("unknown");
  finalConvergenceBadge.textContent = "Unknown";
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
