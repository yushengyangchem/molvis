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

const statusEl = document.getElementById("status");
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
  state.source = source || "orca";
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

function renderFrequencyPanel() {
  const report = state.frequency || {};
  if (freqStatus) {
    freqStatus.textContent = report.status || "No frequency calculation";
  }
  if (!imagModeList) return;

  imagModeList.innerHTML = "";
  const modes = Array.isArray(report.imaginary_modes)
    ? report.imaginary_modes
    : [];
  if (!report.has_frequency) {
    return;
  }
  if (!modes.length) {
    const text = document.createElement("span");
    text.className = "imag-mode-meta";
    text.textContent = "No imaginary frequencies";
    imagModeList.appendChild(text);
    return;
  }

  for (const mode of modes) {
    const card = document.createElement("div");
    card.className = "imag-mode-card";

    const meta = document.createElement("span");
    meta.className = "imag-mode-meta";
    meta.textContent = `${Number(mode.frequency_cm1).toFixed(2)} cm^-1`;
    card.appendChild(meta);

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "toggle-btn";
    const active = isSameMode(state.vibration.activeMode, mode);
    playBtn.textContent = active ? "Stop" : "Animate";
    playBtn.addEventListener("click", () => {
      if (isSameMode(state.vibration.activeMode, mode)) {
        stopVibrationPlayback();
      } else {
        startVibrationPlayback(mode);
      }
    });
    card.appendChild(playBtn);

    imagModeList.appendChild(card);
  }
}

function isSameMode(a, b) {
  if (!a || !b) return false;
  return (
    a.mode_index === b.mode_index &&
    Number(a.frequency_cm1).toFixed(6) === Number(b.frequency_cm1).toFixed(6)
  );
}

function renderThermochemistryPanel() {
  const report = state.frequency || {};
  if (!thermoPanel) return;

  if (!report.has_frequency) {
    thermoPanel.classList.add("hidden");
    return;
  }

  const thermo = report.thermochemistry || {};
  if (thermoElectronicEnergy) {
    thermoElectronicEnergy.textContent = formatHartree(
      thermo.electronic_energy_hartree,
    );
  }
  if (thermoGibbsFreeEnergy) {
    thermoGibbsFreeEnergy.textContent = formatHartree(
      thermo.sum_electronic_and_thermal_free_energies_hartree,
    );
  }
  if (thermoGibbsCorrection) {
    thermoGibbsCorrection.textContent = formatHartree(
      thermo.thermal_correction_to_gibbs_free_energy_hartree,
    );
  }
  thermoPanel.classList.remove("hidden");
}

function formatHartree(value) {
  if (!Number.isFinite(value)) return "N/A";
  const trimmed = Number(value)
    .toFixed(THERMO_DECIMALS)
    .replace(/\.?0+$/, "");
  return `${trimmed} Eh`;
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
  toggleCurrentFrameText("xyz");
}

function toggleCurrentFrameGjfText() {
  toggleCurrentFrameText("gjf");
}

function toggleCurrentFrameText(mode) {
  if (!xyzTextPanel || !xyzTextOutput) return;
  const shown = !xyzTextPanel.classList.contains("hidden");
  if (shown && state.textExportMode === mode) {
    xyzTextPanel.classList.add("hidden");
    updateXyzPanelToggleLabel();
    setStatus("Text panel hidden.");
    return;
  }
  state.textExportMode = mode;
  showCurrentFrameText();
}

function showCurrentFrameText() {
  if (!state.frames.length) {
    setStatus("No frame available to export.");
    return;
  }
  const frame = state.frames[state.currentIndex];
  xyzTextOutput.value =
    state.textExportMode === "gjf"
      ? formatFrameAsGjf(
          frame,
          state.currentIndex,
          state.frames.length,
          state.charge,
          state.multiplicity,
        )
      : formatFrameAsXyz(frame, state.currentIndex, state.frames.length);
  xyzTextPanel.classList.remove("hidden");
  updateXyzPanelToggleLabel();
  xyzTextOutput.focus();
  xyzTextOutput.select();
  const kind = state.textExportMode === "gjf" ? "GJF" : "XYZ";
  setStatus(`${kind} text ready for frame ${state.currentIndex + 1}.`);
}

function updateXyzPanelToggleLabel() {
  if (!exportXyzBtn || !exportGjfBtn || !xyzTextPanel) return;
  const shown = !xyzTextPanel.classList.contains("hidden");
  const xyzActive = shown && state.textExportMode === "xyz";
  const gjfActive = shown && state.textExportMode === "gjf";
  exportXyzBtn.textContent = xyzActive ? "Hide XYZ Text" : "Show XYZ Text";
  exportGjfBtn.textContent = gjfActive ? "Hide GJF Text" : "Show GJF Text";
  if (textPanelTitle) {
    textPanelTitle.textContent =
      state.textExportMode === "gjf"
        ? "Current Frame GJF"
        : "Current Frame XYZ";
  }
}

function syncVisibleXyzText() {
  if (!xyzTextPanel || !xyzTextOutput) return;
  if (xyzTextPanel.classList.contains("hidden")) return;
  if (!state.frames.length) {
    xyzTextOutput.value = "";
    return;
  }
  const frame = state.frames[state.currentIndex];
  xyzTextOutput.value =
    state.textExportMode === "gjf"
      ? formatFrameAsGjf(
          frame,
          state.currentIndex,
          state.frames.length,
          state.charge,
          state.multiplicity,
        )
      : formatFrameAsXyz(frame, state.currentIndex, state.frames.length);
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

function formatFrameAsGjf(
  frame,
  frameIndex,
  totalFrames,
  charge,
  multiplicity,
) {
  const ch = Number.isInteger(charge) ? charge : 0;
  const mult = Number.isInteger(multiplicity) ? multiplicity : 1;
  const title = `Generated from frame ${frameIndex + 1}/${totalFrames}`;
  const route = "#P Generated by molvis";
  const atomLines = (frame?.atoms || [])
    .map(
      (atom) =>
        `${atom.element} ${atom.x.toFixed(10)} ${atom.y.toFixed(10)} ${atom.z.toFixed(10)}`,
    )
    .join("\n");
  return `${route}\n\n${title}\n\n${ch} ${mult}\n${atomLines}\n`;
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

function parseXyzTrajectory(text) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/);
  const frames = [];
  let i = 0;
  while (i < lines.length) {
    const count = Number(lines[i]?.trim());
    if (!Number.isInteger(count) || count <= 0) {
      i += 1;
      continue;
    }
    if (i + 1 + count >= lines.length) break;
    const atoms = [];
    for (let j = 0; j < count; j += 1) {
      const row = lines[i + 2 + j]?.trim();
      if (!row) continue;
      const cols = row.split(/\s+/);
      if (cols.length < 4) continue;
      const x = Number(cols[1]);
      const y = Number(cols[2]);
      const z = Number(cols[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      atoms.push({ element: cols[0], x, y, z });
    }
    if (atoms.length === count) {
      frames.push({ atoms });
    }
    i += count + 2;
  }
  return frames;
}

function sanitizeFrameCount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 21;
  const rounded = Math.max(5, Math.min(401, Math.round(n)));
  return rounded % 2 === 0 ? rounded + 1 : rounded;
}

function resampleTrajectory(frames, targetCount) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  if (!Number.isInteger(targetCount) || targetCount <= 1) return frames;
  if (frames.length === targetCount) return frames;

  const sourceCount = frames.length;
  const maxT = sourceCount - 1;
  const out = [];

  for (let i = 0; i < targetCount; i += 1) {
    const t = (i * maxT) / (targetCount - 1);
    const left = Math.floor(t);
    const right = Math.min(sourceCount - 1, left + 1);
    const alpha = t - left;
    const a = frames[left].atoms;
    const b = frames[right].atoms;
    if (!a || !b || a.length !== b.length) continue;
    const atoms = a.map((atom, idx) => ({
      element: atom.element,
      x: atom.x + (b[idx].x - atom.x) * alpha,
      y: atom.y + (b[idx].y - atom.y) * alpha,
      z: atom.z + (b[idx].z - atom.z) * alpha,
    }));
    out.push({ atoms });
  }

  return out.length ? out : frames;
}

function startVibrationPlayback(mode) {
  if (!state.viewer) return;
  const parsed = parseXyzTrajectory(mode?.xyz_trajectory || "");
  if (!parsed.length) {
    setStatus(
      `Imaginary mode ${mode?.mode_index ?? "?"} has no valid XYZ frames.`,
    );
    return;
  }
  const targetCount = sanitizeFrameCount(
    vibrationFrameCountInput?.value ?? state.vibration.frameCount,
  );
  state.vibration.frameCount = targetCount;
  if (vibrationFrameCountInput) {
    vibrationFrameCountInput.value = String(targetCount);
  }
  const frames = resampleTrajectory(parsed, targetCount);

  stopVibrationPlayback({ silent: true });
  clearAtomSelection();
  state.vibration.activeMode = mode;
  state.vibration.parsedFrames = frames;
  state.vibration.currentFrame = 0;
  if (clearMeasureBtn) {
    clearMeasureBtn.classList.add("hidden");
  }

  if (vibrationPanel) vibrationPanel.classList.remove("hidden");
  if (vibrationTitle) {
    vibrationTitle.textContent = `Imaginary Frequency (${Number(mode.frequency_cm1).toFixed(2)} cm^-1)`;
  }
  if (vibrationSlider) {
    vibrationSlider.max = String(Math.max(0, frames.length - 1));
    vibrationSlider.value = "0";
  }
  renderVibrationFrame(0);

  state.vibration.timer = window.setInterval(() => {
    if (!state.vibration.activeMode) return;
    const next =
      (state.vibration.currentFrame + 1) % state.vibration.parsedFrames.length;
    renderVibrationFrame(next);
    if (vibrationSlider) {
      vibrationSlider.value = String(next);
    }
  }, state.vibration.intervalMs);
  renderFrequencyPanel();
}

function renderVibrationFrame(index) {
  if (!state.viewer) return;
  if (!state.vibration.activeMode) return;
  const frames = state.vibration.parsedFrames;
  if (!frames.length) return;
  if (index < 0 || index >= frames.length) return;
  state.vibration.currentFrame = index;
  const frame = frames[index];
  const mol = toMolWithInferredBondOrders(frame.atoms);

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
  state.viewer.render();
  if (vibrationFrameInfo) {
    vibrationFrameInfo.textContent = `${index + 1} / ${frames.length}`;
  }
}

function stopVibrationPlayback({ silent = false } = {}) {
  if (state.vibration.timer) {
    window.clearInterval(state.vibration.timer);
    state.vibration.timer = null;
  }
  const hadActive = Boolean(state.vibration.activeMode);
  state.vibration.activeMode = null;
  state.vibration.parsedFrames = [];
  state.vibration.currentFrame = 0;
  if (vibrationPanel) vibrationPanel.classList.add("hidden");
  if (vibrationSlider) {
    vibrationSlider.value = "0";
    vibrationSlider.max = "0";
  }
  if (vibrationFrameInfo) {
    vibrationFrameInfo.textContent = "0 / 0";
  }
  if (hadActive && state.frames.length > 0) {
    renderFrame(state.currentIndex);
  }
  if (clearMeasureBtn) {
    clearMeasureBtn.classList.remove("hidden");
  }
  if (hadActive) {
    renderFrequencyPanel();
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
    loadFrames(
      data.frames,
      data.source,
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
