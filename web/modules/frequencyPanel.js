export function isSameMode(a, b) {
  if (!a || !b) return false;
  return (
    a.mode_index === b.mode_index &&
    Number(a.frequency_cm1).toFixed(6) === Number(b.frequency_cm1).toFixed(6)
  );
}

export function renderFrequencyPanel(
  report,
  activeMode,
  imagModeList,
  handlers,
) {
  if (!imagModeList) return;

  imagModeList.innerHTML = "";
  const modes = Array.isArray(report?.imaginary_modes)
    ? report.imaginary_modes
    : [];
  if (!report?.has_frequency) {
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
    const active = isSameMode(activeMode, mode);
    playBtn.textContent = active ? "Close Analysis" : "Vibration Analysis";
    playBtn.addEventListener("click", () => {
      if (isSameMode(activeMode, mode)) {
        handlers.close();
      } else {
        handlers.open(mode);
      }
    });
    card.appendChild(playBtn);

    imagModeList.appendChild(card);
  }
}
