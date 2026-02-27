mod frequency;
mod geometry;

use crate::models::{Atom, Frame, ParseResult};
use frequency::{build_frequency_report, parse_frequency_blocks, parse_normal_mode_blocks};
use geometry::parse_cartesian_blocks;

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
