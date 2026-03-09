export function sanitizeFrameCount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 21;
  const rounded = Math.max(5, Math.min(401, Math.round(n)));
  return rounded % 2 === 0 ? rounded + 1 : rounded;
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

function updatePlaybackControls(state, deps) {
  const active = Boolean(state.vibration.activeMode);
  const playing = Boolean(state.vibration.timer);
  if (deps.vibrationPlayBtn) {
    deps.vibrationPlayBtn.disabled = !active || playing;
  }
  if (deps.vibrationPauseBtn) {
    deps.vibrationPauseBtn.disabled = !active || !playing;
  }
}

export function openVibrationAnalysis(state, mode, deps) {
  if (!state.viewer) return;
  const parsed = parseXyzTrajectory(mode?.xyz_trajectory || "");
  if (!parsed.length) {
    deps.setStatus(
      `Imaginary mode ${mode?.mode_index ?? "?"} has no valid XYZ frames.`,
    );
    return;
  }

  const targetCount = sanitizeFrameCount(
    deps.vibrationFrameCountInput?.value ?? state.vibration.frameCount,
  );
  state.vibration.frameCount = targetCount;
  if (deps.vibrationFrameCountInput) {
    deps.vibrationFrameCountInput.value = String(targetCount);
  }
  const frames = resampleTrajectory(parsed, targetCount);

  closeVibrationAnalysis(state, deps, { silent: true });
  deps.clearAtomSelection();
  state.vibration.activeMode = mode;
  state.vibration.parsedFrames = frames;
  state.vibration.currentFrame = 0;
  state.vibration.timer = null;

  if (deps.vibrationPanel) deps.vibrationPanel.classList.remove("hidden");
  if (deps.vibrationTitle) {
    deps.vibrationTitle.textContent = `Vibration Analysis (${Number(mode.frequency_cm1).toFixed(2)} cm^-1)`;
  }
  if (deps.vibrationSlider) {
    deps.vibrationSlider.max = String(Math.max(0, frames.length - 1));
    deps.vibrationSlider.value = "0";
  }
  renderVibrationFrame(state, 0, deps);
  if (deps.updateTextPanelLabel) {
    deps.updateTextPanelLabel();
  }
  if (deps.updateExportAvailability) {
    deps.updateExportAvailability();
  }
  updatePlaybackControls(state, deps);
  deps.renderFrequencyPanel();
}

export function renderVibrationFrame(state, index, deps) {
  if (!state.viewer) return;
  if (!state.vibration.activeMode) return;
  const frames = state.vibration.parsedFrames;
  if (!frames.length) return;
  if (index < 0 || index >= frames.length) return;

  state.vibration.currentFrame = index;
  const frame = frames[index];
  const mol = deps.toMolWithInferredBondOrders(frame.atoms);

  state.viewer.clear();
  state.viewer.addModel(mol, "mol");
  const colorscheme = { prop: "elem", map: deps.cpkColors };
  state.viewer.setStyle(
    {},
    {
      stick: { radius: 0.15, colorscheme },
      sphere: { scale: 0.3, colorscheme },
    },
  );
  state.viewer.setClickable({}, true, (atom) => {
    deps.onAtomPicked(atom);
  });

  if (deps.showAtomIndices?.()) {
    frame.atoms.forEach((atom, atomIndex) => {
      state.viewer.addLabel(String(atomIndex), {
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

  const selection = deps.getMeasurementSelection?.();
  if (
    selection?.scope === "vibration" &&
    selection.frame === index &&
    selection.ids?.length
  ) {
    deps.addSelectionOverlay(state.viewer, frame, selection.ids);
  }

  state.viewer.render();
  if (deps.vibrationFrameInfo) {
    deps.vibrationFrameInfo.textContent = `${index + 1} / ${frames.length}`;
  }
  if (deps.syncVisibleText) {
    deps.syncVisibleText();
  }
}

export function startVibrationPlayback(state, deps) {
  if (!state.vibration.activeMode) return;
  if (!state.vibration.parsedFrames.length) return;
  if (state.vibration.timer) return;
  state.vibration.timer = window.setInterval(() => {
    if (!state.vibration.activeMode) return;
    const next =
      (state.vibration.currentFrame + 1) % state.vibration.parsedFrames.length;
    renderVibrationFrame(state, next, deps);
    if (deps.vibrationSlider) {
      deps.vibrationSlider.value = String(next);
    }
  }, state.vibration.intervalMs);
  updatePlaybackControls(state, deps);
}

export function pauseVibrationPlayback(state, deps) {
  if (state.vibration.timer) {
    window.clearInterval(state.vibration.timer);
    state.vibration.timer = null;
  }
  updatePlaybackControls(state, deps);
}

export function closeVibrationAnalysis(state, deps, { silent = false } = {}) {
  const wasPlaying = Boolean(state.vibration.timer);
  if (state.vibration.timer) {
    window.clearInterval(state.vibration.timer);
    state.vibration.timer = null;
  }
  const hadActive = Boolean(state.vibration.activeMode);
  state.vibration.activeMode = null;
  state.vibration.parsedFrames = [];
  state.vibration.currentFrame = 0;

  if (deps.vibrationPanel) deps.vibrationPanel.classList.add("hidden");
  if (deps.vibrationSlider) {
    deps.vibrationSlider.value = "0";
    deps.vibrationSlider.max = "0";
  }
  if (deps.vibrationFrameInfo) {
    deps.vibrationFrameInfo.textContent = "0 / 0";
  }
  if (hadActive && state.frames.length > 0) {
    deps.renderFrame(state.currentIndex);
  }
  if (deps.updateTextPanelLabel) {
    deps.updateTextPanelLabel();
  }
  if (deps.updateExportAvailability) {
    deps.updateExportAvailability();
  }
  updatePlaybackControls(state, deps);
  if (hadActive) {
    deps.renderFrequencyPanel();
  }
  if (!silent) {
    if (wasPlaying) {
      deps.setStatus("Vibration playback stopped.");
    }
  }
}
