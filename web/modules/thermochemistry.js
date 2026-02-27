export function formatHartree(value, thermoDecimals) {
  if (!Number.isFinite(value)) return "N/A";
  const trimmed = Number(value)
    .toFixed(thermoDecimals)
    .replace(/\.?0+$/, "");
  return `${trimmed} Eh`;
}

export function renderThermochemistryPanel(report, elements, thermoDecimals) {
  const {
    thermoPanel,
    thermoElectronicEnergy,
    thermoGibbsFreeEnergy,
    thermoGibbsCorrection,
  } = elements;
  if (!thermoPanel) return;

  if (!report?.has_frequency) {
    thermoPanel.classList.add("hidden");
    return;
  }

  const thermo = report.thermochemistry || {};
  const hasThermoValue =
    Number.isFinite(thermo.electronic_energy_hartree) ||
    Number.isFinite(thermo.sum_electronic_and_thermal_free_energies_hartree) ||
    Number.isFinite(thermo.thermal_correction_to_gibbs_free_energy_hartree);
  if (!hasThermoValue) {
    thermoPanel.classList.add("hidden");
    return;
  }

  if (thermoElectronicEnergy) {
    thermoElectronicEnergy.textContent = formatHartree(
      thermo.electronic_energy_hartree,
      thermoDecimals,
    );
  }
  if (thermoGibbsFreeEnergy) {
    thermoGibbsFreeEnergy.textContent = formatHartree(
      thermo.sum_electronic_and_thermal_free_energies_hartree,
      thermoDecimals,
    );
  }
  if (thermoGibbsCorrection) {
    thermoGibbsCorrection.textContent = formatHartree(
      thermo.thermal_correction_to_gibbs_free_energy_hartree,
      thermoDecimals,
    );
  }
  thermoPanel.classList.remove("hidden");
}
