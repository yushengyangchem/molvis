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
    pub frames: Vec<Frame>,
    pub final_converged: Option<bool>,
}
