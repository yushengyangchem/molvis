export async function drawEnergyTrendChart(
  state,
  energyTrendChart,
  loadPlotly,
  onFrameSelected,
) {
  if (!energyTrendChart) return;
  const token = ++state.trendRenderToken;
  const plotLib = await loadPlotly();
  if (!plotLib) {
    renderTrendFallback(
      state,
      energyTrendChart,
      "Failed to load chart library",
    );
    return;
  }
  if (token !== state.trendRenderToken) return;

  const points = state.frames
    .map((frame, idx) => ({ index: idx, energy: frame.energy_hartree }))
    .filter((point) => Number.isFinite(point.energy));

  if (points.length < 2) {
    renderTrendFallback(
      state,
      energyTrendChart,
      "Not enough energy points to draw trend",
    );
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
      onFrameSelected(frameIndex);
    });
    state.trendEventsBound = true;
  }
}

function renderTrendFallback(state, energyTrendChart, message) {
  if (!energyTrendChart) return;
  if (state.plotLib) {
    state.plotLib.purge(energyTrendChart);
  }
  energyTrendChart.innerHTML = `<div class="energy-chart-hint">${message}</div>`;
}
