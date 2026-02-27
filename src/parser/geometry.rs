use crate::models::Atom;

#[derive(Debug, Clone)]
pub(super) struct CoordinateBlock {
    pub(super) start_line: usize,
    pub(super) atoms: Vec<Atom>,
}

pub(super) fn parse_cartesian_blocks(lines: &[&str]) -> Vec<CoordinateBlock> {
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

pub(super) fn parse_fallback_last_atoms(lines: &[&str]) -> Vec<Atom> {
    parse_cartesian_blocks(lines)
        .last()
        .map(|block| block.atoms.clone())
        .unwrap_or_default()
}
