use crate::models::{Atom, Frame, ParseResult};

pub fn parse_orca_out(source: &str, content: &str) -> ParseResult {
    let mut frames: Vec<Frame> = Vec::new();
    let mut current_energy: Option<f64> = None;

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0usize;

    while i < lines.len() {
        let line = lines[i].trim();

        if let Some(e) = parse_energy_line(line) {
            current_energy = Some(e);
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
                    energy_hartree: current_energy,
                    atoms,
                });
            }
        }

        i += 1;
    }

    ParseResult {
        source: source.to_string(),
        frames,
    }
}

fn parse_energy_line(line: &str) -> Option<f64> {
    let markers = [
        "FINAL SINGLE POINT ENERGY",
        "Total Energy       :",
        "The current total energy in Eh",
    ];

    if !markers.iter().any(|m| line.contains(m)) {
        return None;
    }

    line.split_whitespace()
        .rev()
        .find_map(|tok| tok.parse::<f64>().ok())
}

#[cfg(test)]
mod tests {
    use super::parse_orca_out;

    #[test]
    fn parse_basic_energy_and_coordinates() {
        let content = r#"
FINAL SINGLE POINT ENERGY     -10.5000
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
C       0.0000      0.0000      0.0000
H       0.0000      0.0000      1.0800

FINAL SINGLE POINT ENERGY     -10.6000
CARTESIAN COORDINATES (ANGSTROEM)
---------------------------------
C       0.0100      0.0000      0.0000
H       0.0000      0.0100      1.0700
"#;
        let result = parse_orca_out("test.out", content);
        assert_eq!(result.frames.len(), 2);
        assert_eq!(result.frames[0].atoms.len(), 2);
        assert_eq!(result.frames[1].atoms.len(), 2);
        assert_eq!(result.frames[0].energy_hartree, Some(-10.5));
        assert_eq!(result.frames[1].energy_hartree, Some(-10.6));
    }

    #[test]
    fn parse_returns_empty_when_no_coordinates() {
        let content = "FINAL SINGLE POINT ENERGY     -1.2345";
        let result = parse_orca_out("test.out", content);
        assert!(result.frames.is_empty());
    }
}
