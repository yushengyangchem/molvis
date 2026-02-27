use crate::models::{Atom, Frame, FrequencyReport, ImaginaryMode, ParseResult, Thermochemistry};
use std::collections::HashMap;

const IMAGINARY_MODE_FRAME_COUNT: usize = 21;

pub fn parse_orca_out(source: &str, content: &str) -> ParseResult {
    let mut frames: Vec<Frame> = Vec::new();
    let mut pending_energy: Option<f64> = None;
    let final_converged = parse_final_convergence(content);
    let lines: Vec<&str> = content.lines().collect();
    let coord_blocks = parse_cartesian_blocks(&lines);
    let freq_blocks = parse_frequency_blocks(&lines);
    let normal_blocks = parse_normal_mode_blocks(&lines);
    let (charge, multiplicity) = parse_charge_multiplicity(&lines);

    let mut i = 0usize;

    while i < lines.len() {
        let line = lines[i].trim();

        if let Some(e) = parse_energy_line(line) {
            if let Some(last_frame) = frames.last_mut() {
                // ORCA optimization logs report energies after a geometry block.
                // Keep updating the latest frame as more precise energies appear.
                last_frame.energy_hartree = Some(e);
            } else {
                // Keep compatibility for outputs that list an energy before coordinates.
                pending_energy = Some(e);
            }
        }

        if line.contains("CARTESIAN COORDINATES (ANGSTROEM)") {
            let mut atoms = Vec::new();
            i += 1;

            while i < lines.len() {
                let raw = lines[i].trim();
                if raw.is_empty() && !atoms.is_empty() {
                    break;
                }

                let cols: Vec<&str> = raw.split_whitespace().collect();
                if cols.len() >= 4 {
                    if let (Ok(x), Ok(y), Ok(z)) = (
                        cols[1].parse::<f64>(),
                        cols[2].parse::<f64>(),
                        cols[3].parse::<f64>(),
                    ) {
                        atoms.push(Atom {
                            element: cols[0].to_string(),
                            x,
                            y,
                            z,
                        });
                    }
                }
                i += 1;
            }

            if !atoms.is_empty() {
                frames.push(Frame {
                    step: frames.len(),
                    energy_hartree: pending_energy.take(),
                    atoms,
                });
            }
        }

        i += 1;
    }

    ParseResult {
        source: source.to_string(),
        frames,
        final_converged,
        charge,
        multiplicity,
        frequency: build_frequency_report(&lines, &coord_blocks, &freq_blocks, &normal_blocks),
    }
}

#[derive(Debug, Clone)]
struct CoordinateBlock {
    start_line: usize,
    atoms: Vec<Atom>,
}

#[derive(Debug, Clone)]
struct FrequencyMode {
    mode_index: usize,
    frequency_cm1: f64,
    is_imaginary: bool,
}

#[derive(Debug, Clone)]
struct FrequencyBlock {
    start_line: usize,
    modes: Vec<FrequencyMode>,
}

#[derive(Debug, Clone)]
struct NormalModeBlock {
    start_line: usize,
    vectors: HashMap<usize, Vec<f64>>,
}

fn parse_cartesian_blocks(lines: &[&str]) -> Vec<CoordinateBlock> {
    let mut blocks = Vec::new();
    let mut i = 0usize;
    while i < lines.len() {
        if !lines[i]
            .trim()
            .contains("CARTESIAN COORDINATES (ANGSTROEM)")
        {
            i += 1;
            continue;
        }
        let start_line = i;
        let mut atoms = Vec::new();
        i += 1;
        while i < lines.len() {
            let raw = lines[i].trim();
            if raw.is_empty() && !atoms.is_empty() {
                break;
            }
            let cols: Vec<&str> = raw.split_whitespace().collect();
            if cols.len() >= 4 {
                if let (Ok(x), Ok(y), Ok(z)) = (
                    cols[1].parse::<f64>(),
                    cols[2].parse::<f64>(),
                    cols[3].parse::<f64>(),
                ) {
                    atoms.push(Atom {
                        element: cols[0].to_string(),
                        x,
                        y,
                        z,
                    });
                }
            }
            i += 1;
        }
        if !atoms.is_empty() {
            blocks.push(CoordinateBlock { start_line, atoms });
        }
        i += 1;
    }
    blocks
}

fn parse_frequency_blocks(lines: &[&str]) -> Vec<FrequencyBlock> {
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

fn parse_normal_mode_blocks(lines: &[&str]) -> Vec<NormalModeBlock> {
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

            if !tokens.is_empty() && tokens.iter().all(|tok| tok.parse::<usize>().is_ok()) {
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

fn build_frequency_report(
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

fn parse_fallback_last_atoms(lines: &[&str]) -> Vec<Atom> {
    parse_cartesian_blocks(lines)
        .last()
        .map(|block| block.atoms.clone())
        .unwrap_or_default()
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
    atoms: &[Atom],
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

fn parse_energy_line(line: &str) -> Option<f64> {
    if line.contains("FINAL SINGLE POINT ENERGY") {
        return line
            .split_whitespace()
            .rev()
            .find_map(|tok| tok.parse::<f64>().ok());
    }
    None
}

fn parse_charge_multiplicity(lines: &[&str]) -> (Option<i32>, Option<u32>) {
    let mut charge: Option<i32> = None;
    let mut multiplicity: Option<u32> = None;

    for line in lines {
        if line.contains("Total Charge") {
            if let Some(v) = extract_last_int(line) {
                charge = Some(v as i32);
            }
            continue;
        }
        if line.contains("Multiplicity") && line.contains("Mult") {
            if let Some(v) = extract_last_int(line) {
                multiplicity = Some(v as u32);
            }
        }
    }

    (charge, multiplicity)
}

fn extract_last_int(line: &str) -> Option<i64> {
    line.split_whitespace()
        .rev()
        .find_map(|tok| tok.parse::<i64>().ok())
}

fn parse_final_convergence(content: &str) -> Option<bool> {
    let upper = content.to_ascii_uppercase();

    if upper.contains("THE OPTIMIZATION HAS CONVERGED")
        || upper.contains("*** OPTIMIZATION RUN DONE ***")
    {
        return Some(true);
    }
    if upper.contains("THE OPTIMIZATION HAS NOT CONVERGED") {
        return Some(false);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::parse_orca_out;

    #[test]
    fn parse_geometry_then_energy_cycles() {
        let content = r#"
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
C       0.0000      0.0000      0.0000
H       0.0000      0.0000      1.0800

FINAL SINGLE POINT ENERGY     -10.5000
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
C       0.0100      0.0000      0.0000
H       0.0000      0.0100      1.0700

FINAL SINGLE POINT ENERGY     -10.6000
"#;
        let result = parse_orca_out("test.out", content);
        assert_eq!(result.frames.len(), 2);
        assert_eq!(result.frames[0].atoms.len(), 2);
        assert_eq!(result.frames[1].atoms.len(), 2);
        assert_eq!(result.frames[0].energy_hartree, Some(-10.5));
        assert_eq!(result.frames[1].energy_hartree, Some(-10.6));
        assert_eq!(result.final_converged, None);
        assert!(!result.frequency.has_frequency);
        assert!(result.frequency.thermochemistry.is_none());
    }

    #[test]
    fn parse_returns_empty_when_no_coordinates() {
        let content = "FINAL SINGLE POINT ENERGY     -1.2345";
        let result = parse_orca_out("test.out", content);
        assert!(result.frames.is_empty());
        assert_eq!(result.final_converged, None);
        assert!(!result.frequency.has_frequency);
        assert!(result.frequency.thermochemistry.is_none());
    }

    #[test]
    fn parse_final_convergence_true() {
        let content = r#"
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
C       0.0000      0.0000      0.0000
H       0.0000      0.0000      1.0800

THE OPTIMIZATION HAS CONVERGED
"#;
        let result = parse_orca_out("test.out", content);
        assert_eq!(result.final_converged, Some(true));
        assert!(!result.frequency.has_frequency);
    }

    #[test]
    fn parse_final_convergence_false() {
        let content = r#"
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
C       0.0000      0.0000      0.0000
H       0.0000      0.0000      1.0800

THE OPTIMIZATION HAS NOT CONVERGED
"#;
        let result = parse_orca_out("test.out", content);
        assert_eq!(result.final_converged, Some(false));
        assert!(!result.frequency.has_frequency);
    }

    #[test]
    fn parse_frequency_no_imaginary() {
        let content = r#"
VIBRATIONAL FREQUENCIES
-----------------------
     0:       0.00 cm**-1
     1:      10.23 cm**-1
     2:      30.55 cm**-1
"#;
        let result = parse_orca_out("test.out", content);
        assert!(result.frequency.has_frequency);
        assert_eq!(result.frequency.status, "No imaginary frequencies");
        assert!(result.frequency.imaginary_modes.is_empty());
        assert!(result.frequency.thermochemistry.is_none());
    }

    #[test]
    fn parse_frequency_with_imaginary_and_modes() {
        let content = r#"
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
H       0.0000      0.0000      0.0000
H       0.0000      0.0000      0.7400

VIBRATIONAL FREQUENCIES
-----------------------
     0:       0.00 cm**-1
     1:       0.00 cm**-1
     2:       0.00 cm**-1
     3:       0.00 cm**-1
     4:       0.00 cm**-1
     5:       0.00 cm**-1
     6:     -50.00 cm**-1  ***imaginary mode***

NORMAL MODES
------------
                  6
      0       0.100000
      1       0.000000
      2       0.000000
      3      -0.100000
      4       0.000000
      5       0.000000
"#;
        let result = parse_orca_out("test.out", content);
        assert!(result.frequency.has_frequency);
        assert_eq!(result.frequency.imaginary_modes.len(), 1);
        assert_eq!(result.frequency.imaginary_modes[0].mode_index, 6);
        assert!(result.frequency.imaginary_modes[0]
            .xyz_trajectory
            .contains("mode=6"));
    }

    #[test]
    fn parse_charge_and_multiplicity() {
        let content = r#"
Total Charge           Charge          ....   -1
Multiplicity           Mult            ....    2
"#;
        let result = parse_orca_out("test.out", content);
        assert_eq!(result.charge, Some(-1));
        assert_eq!(result.multiplicity, Some(2));
    }

    #[test]
    fn parse_thermochemistry_values() {
        let content = r#"
VIBRATIONAL FREQUENCIES
-----------------------
     0:       0.00 cm**-1
     1:      10.23 cm**-1

Electronic energy                ...  -4031.68143711 Eh
Final Gibbs free energy          ...  -4030.77524000 Eh
G-E(el)                          ...      0.90619711 Eh
"#;
        let result = parse_orca_out("test.out", content);
        let thermo = result.frequency.thermochemistry.expect("thermochemistry");
        assert_eq!(thermo.electronic_energy_hartree, Some(-4031.68143711));
        assert_eq!(
            thermo.sum_electronic_and_thermal_free_energies_hartree,
            Some(-4030.77524)
        );
        assert_eq!(
            thermo.thermal_correction_to_gibbs_free_energy_hartree,
            Some(0.90619711)
        );
    }
}
