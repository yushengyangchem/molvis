export function updateAtomIndexToggle(toggleAtomIndexBtn, showAtomIndices) {
  if (showAtomIndices) {
    toggleAtomIndexBtn.textContent = "Hide Atom Indices";
    toggleAtomIndexBtn.classList.add("active");
    toggleAtomIndexBtn.setAttribute("aria-pressed", "true");
  } else {
    toggleAtomIndexBtn.textContent = "Show Atom Indices";
    toggleAtomIndexBtn.classList.remove("active");
    toggleAtomIndexBtn.setAttribute("aria-pressed", "false");
  }
}

function addAtomIndexLabels(viewer, atoms) {
  atoms.forEach((atom, index) => {
    viewer.addLabel(String(index), {
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

export function clearViewer(viewer) {
  if (!viewer) return;
  viewer.clear();
  viewer.render();
}

export function resizeViewer(viewer) {
  if (!viewer) return;
  viewer.resize();
  viewer.render();
}

export function renderFrame(state, index, deps, options = {}) {
  const showLabels = options.showLabels ?? state.showAtomIndices;
  if (!state.frames.length) return;
  if (!state.viewer) return;

  const frameChanged = state.currentIndex !== index;
  state.currentIndex = index;
  if (frameChanged) {
    deps.clearAtomSelection();
  }

  const frame = state.frames[index];
  let mol = state.inferredMolCache.get(index);
  if (!mol) {
    mol = deps.toMolWithInferredBondOrders(frame.atoms);
    state.inferredMolCache.set(index, mol);
  }

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

  if (showLabels) {
    addAtomIndexLabels(state.viewer, frame.atoms);
  }

  if (
    state.selectedAtomScope === "main" &&
    state.selectedAtomFrame === state.currentIndex
  ) {
    deps.addSelectionOverlay(state.viewer, frame, state.selectedAtomIndices);
  }

  if (!state.hasAutoZoomed) {
    state.viewer.zoomTo();
    state.hasAutoZoomed = true;
  }

  state.viewer.render();
  deps.updateMeta();
  deps.syncVisibleText();
}

export function scheduleLabelRender(state, index, renderFn) {
  if (!state.showAtomIndices) return;
  if (state.labelRenderTimer) {
    clearTimeout(state.labelRenderTimer);
  }
  state.labelRenderTimer = setTimeout(() => {
    state.labelRenderTimer = null;
    if (state.currentIndex !== index) return;
    if (!state.showAtomIndices) return;
    renderFn(index, { showLabels: true });
  }, 120);
}
