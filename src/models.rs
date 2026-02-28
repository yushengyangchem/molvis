use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Atom {
    pub element: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    pub step: usize,
    pub energy_hartree: Option<f64>,
    pub atoms: Vec<Atom>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub source: String,
    pub orca_version: Option<String>,
    pub frames: Vec<Frame>,
    pub final_converged: Option<bool>,
    pub charge: Option<i32>,
    pub multiplicity: Option<u32>,
    pub frequency: FrequencyReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrequencyReport {
    pub has_frequency: bool,
    pub status: String,
    pub imaginary_modes: Vec<ImaginaryMode>,
    pub thermochemistry: Option<Thermochemistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImaginaryMode {
    pub mode_index: usize,
    pub frequency_cm1: f64,
    pub xyz_trajectory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thermochemistry {
    pub electronic_energy_hartree: Option<f64>,
    pub sum_electronic_and_thermal_free_energies_hartree: Option<f64>,
    pub thermal_correction_to_gibbs_free_energy_hartree: Option<f64>,
}
