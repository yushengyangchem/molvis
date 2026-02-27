use crate::models::{FrequencyReport, ImaginaryMode, Thermochemistry};
use std::collections::HashMap;

use super::geometry::{parse_fallback_last_atoms, CoordinateBlock};

const IMAGINARY_MODE_FRAME_COUNT: usize = 21;

#[derive(Debug, Clone)]
struct FrequencyMode {
    mode_index: usize,
    frequency_cm1: f64,
    is_imaginary: bool,
}

#[derive(Debug, Clone)]
pub(super) struct FrequencyBlock {
    pub(super) start_line: usize,
    modes: Vec<FrequencyMode>,
}

#[derive(Debug, Clone)]
pub(super) struct NormalModeBlock {
    pub(super) start_line: usize,
    vectors: HashMap<usize, Vec<f64>>,
}

pub(super) fn parse_frequency_blocks(lines: &[&str]) -> Vec<FrequencyBlock> {
    let mut blocks = Vec::new();
    let mut i = 0usize;
    while i < lines.len() {
        if !lines[i].contains("VIBRATIONAL FREQUENCIES") {
            i += 1;
            continue;
        }
        let start_line = i;
        let mut modes = Vec::new();
        i += 1;
        while i < lines.len() {
            let line = lines[i].trim();
            if line.contains("NORMAL MODES") || line.contains("VIBRATIONAL FREQUENCIES") {
                break;
            }
            if let Some((mode_index, frequency_cm1)) = parse_frequency_row(line) {
                modes.push(FrequencyMode {
                    mode_index,
                    frequency_cm1,
                    is_imaginary: line.contains("imaginary mode") || frequency_cm1 < 0.0,
                });
            }
            i += 1;
        }
        if !modes.is_empty() {
            blocks.push(FrequencyBlock { start_line, modes });
        }
    }
    blocks
}

pub(super) fn parse_normal_mode_blocks(lines: &[&str]) -> Vec<NormalModeBlock> {
    let mut blocks = Vec::new();
    let mut i = 0usize;
    while i < lines.len() {
        if !lines[i].trim().eq("NORMAL MODES") {
            i += 1;
            continue;
        }
        let start_line = i;
        let mut vectors: HashMap<usize, Vec<f64>> = HashMap::new();
        let mut active_columns: Vec<usize> = Vec::new();
        i += 1;
        while i < lines.len() {
            let line = lines[i].trim();
            if line.contains("VIBRATIONAL FREQUENCIES")
                || line.contains("IR SPECTRUM")
                || line.contains("RAMAN SPECTRUM")
                || line.contains("THERMOCHEMISTRY")
            {
                break;
            }
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.is_empty() {
                i += 1;
                continue;
            }

            if tokens.iter().all(|tok| tok.parse::<usize>().is_ok()) {
                active_columns = tokens
                    .iter()
                    .filter_map(|tok| tok.parse::<usize>().ok())
                    .collect();
                i += 1;
                continue;
            }

            if !active_columns.is_empty()
                && tokens.len() >= 2
                && tokens[0].parse::<usize>().is_ok()
                && tokens[1].parse::<f64>().is_ok()
            {
                let row = match tokens[0].parse::<usize>() {
                    Ok(v) => v,
                    Err(_) => {
                        i += 1;
                        continue;
                    }
                };
                let nvals = tokens.len().saturating_sub(1).min(active_columns.len());
                for idx in 0..nvals {
                    let mode = active_columns[idx];
                    if let Ok(val) = tokens[idx + 1].parse::<f64>() {
                        let entry = vectors.entry(mode).or_default();
                        if entry.len() <= row {
                            entry.resize(row + 1, 0.0);
                        }
                        entry[row] = val;
                    }
                }
            }
            i += 1;
        }
        if !vectors.is_empty() {
            blocks.push(NormalModeBlock {
                start_line,
                vectors,
            });
        }
    }
    blocks
}

pub(super) fn build_frequency_report(
    lines: &[&str],
    coord_blocks: &[CoordinateBlock],
    freq_blocks: &[FrequencyBlock],
    normal_blocks: &[NormalModeBlock],
) -> FrequencyReport {
    if freq_blocks.is_empty() {
        return FrequencyReport {
            has_frequency: false,
            status: "No frequency calculation".to_string(),
            imaginary_modes: Vec::new(),
            thermochemistry: None,
        };
    }

    let selected_freq = match freq_blocks.last() {
        Some(block) => block,
        None => {
            return FrequencyReport {
                has_frequency: false,
                status: "No frequency calculation".to_string(),
                imaginary_modes: Vec::new(),
                thermochemistry: None,
            };
        }
    };
    let thermochemistry = parse_thermochemistry(lines);

    let imaginary: Vec<&FrequencyMode> = selected_freq
        .modes
        .iter()
        .filter(|mode| mode.is_imaginary || mode.frequency_cm1 < 0.0)
        .collect();
    if imaginary.is_empty() {
        return FrequencyReport {
            has_frequency: true,
            status: "No imaginary frequencies".to_string(),
            imaginary_modes: Vec::new(),
            thermochemistry,
        };
    }

    let normal_block = normal_blocks
        .iter()
        .find(|block| block.start_line > selected_freq.start_line)
        .or_else(|| normal_blocks.last());
    let base_atoms = coord_blocks
        .iter()
        .rev()
        .find(|block| block.start_line < selected_freq.start_line)
        .or_else(|| coord_blocks.last())
        .map(|block| block.atoms.clone())
        .unwrap_or_else(|| parse_fallback_last_atoms(lines));

    let mut imaginary_modes = Vec::new();
    if let Some(normal) = normal_block {
        for mode in imaginary {
            if let Some(vector) = normal.vectors.get(&mode.mode_index) {
                if vector.len() >= base_atoms.len() * 3 && !base_atoms.is_empty() {
                    let xyz = generate_mode_xyz(
                        &base_atoms,
                        vector,
                        mode.mode_index,
                        mode.frequency_cm1,
                        IMAGINARY_MODE_FRAME_COUNT,
                        1.0,
                    );
                    imaginary_modes.push(ImaginaryMode {
                        mode_index: mode.mode_index,
                        frequency_cm1: mode.frequency_cm1,
                        xyz_trajectory: xyz,
                    });
                }
            }
        }
    }

    if imaginary_modes.is_empty() {
        return FrequencyReport {
            has_frequency: true,
            status: "Imaginary frequencies found, but failed to extract vibration modes"
                .to_string(),
            imaginary_modes: Vec::new(),
            thermochemistry,
        };
    }

    FrequencyReport {
        has_frequency: true,
        status: format!("Found {} imaginary mode(s)", imaginary_modes.len()),
        imaginary_modes,
        thermochemistry,
    }
}

fn parse_thermochemistry(lines: &[&str]) -> Option<Thermochemistry> {
    let mut electronic_energy_hartree: Option<f64> = None;
    let mut gibbs_free_energy_hartree: Option<f64> = None;
    let mut thermal_correction_to_gibbs_free_energy_hartree: Option<f64> = None;

    for line in lines {
        if line.contains("Electronic energy") {
            if let Some(v) = extract_hartree_value(line) {
                electronic_energy_hartree = Some(v);
            }
            continue;
        }

        if line.contains("Final Gibbs free energy") {
            if let Some(v) = extract_hartree_value(line) {
                gibbs_free_energy_hartree = Some(v);
            }
            continue;
        }

        if line.contains("G-E(el)") || line.contains("Thermal correction to Gibbs Free Energy") {
            if let Some(v) = extract_hartree_value(line) {
                thermal_correction_to_gibbs_free_energy_hartree = Some(v);
            }
            continue;
        }

        if line.contains("Sum of electronic and thermal Free Energies") {
            if let Some(v) = extract_hartree_value(line) {
                gibbs_free_energy_hartree = Some(v);
            }
        }
    }

    if electronic_energy_hartree.is_none()
        && gibbs_free_energy_hartree.is_none()
        && thermal_correction_to_gibbs_free_energy_hartree.is_none()
    {
        return None;
    }

    Some(Thermochemistry {
        electronic_energy_hartree,
        sum_electronic_and_thermal_free_energies_hartree: gibbs_free_energy_hartree,
        thermal_correction_to_gibbs_free_energy_hartree,
    })
}

fn extract_hartree_value(line: &str) -> Option<f64> {
    let mut prev: Option<&str> = None;
    for tok in line.split_whitespace() {
        if tok == "Eh" {
            return prev.and_then(|v| v.parse::<f64>().ok());
        }
        prev = Some(tok);
    }
    prev.and_then(|v| v.parse::<f64>().ok())
}

fn parse_frequency_row(line: &str) -> Option<(usize, f64)> {
    let parts: Vec<&str> = line.split(':').collect();
    if parts.len() < 2 {
        return None;
    }
    let mode_index = parts[0].trim().parse::<usize>().ok()?;
    let right = parts[1];
    let mut found = None;
    for tok in right.split_whitespace() {
        if tok == "cm**-1" {
            break;
        }
        if let Ok(v) = tok.parse::<f64>() {
            found = Some(v);
            break;
        }
    }
    found.map(|freq| (mode_index, freq))
}

fn generate_mode_xyz(
    atoms: &[crate::models::Atom],
    displacement: &[f64],
    mode_index: usize,
    frequency_cm1: f64,
    frame_count: usize,
    scale: f64,
) -> String {
    let mut out = String::new();
    let pi = std::f64::consts::PI;
    let total = frame_count.max(2);
    for frame in 0..total {
        let phase = (2.0 * pi * (frame as f64) / ((total - 1) as f64)).sin();
        out.push_str(&format!("{}\n", atoms.len()));
        out.push_str(&format!(
            "mode={} freq={:.2} cm^-1 frame={} phase={:.6}\n",
            mode_index, frequency_cm1, frame, phase
        ));
        for (idx, atom) in atoms.iter().enumerate() {
            let base = 3 * idx;
            let dx = displacement.get(base).copied().unwrap_or(0.0);
            let dy = displacement.get(base + 1).copied().unwrap_or(0.0);
            let dz = displacement.get(base + 2).copied().unwrap_or(0.0);
            out.push_str(&format!(
                "{} {:.10} {:.10} {:.10}\n",
                atom.element,
                atom.x + scale * phase * dx,
                atom.y + scale * phase * dy,
                atom.z + scale * phase * dz
            ));
        }
    }
    out
}
