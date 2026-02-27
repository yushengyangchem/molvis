import {
  angleDegrees,
  centroid3,
  dihedralDegrees,
  distance,
  midpoint,
} from "./geometry.js";

export function getPickedAtomIndex(atom) {
  if (Number.isInteger(atom?.index)) return atom.index;
  if (Number.isInteger(atom?.serial)) return atom.serial - 1;
  return null;
}

export function buildMeasurementStatus(frame, ids) {
  const suffix = " (Esc or Clear Measure to reset).";

  if (!frame || ids.length === 0) {
    return `Selection cleared.${suffix}`;
  }
  if (ids.length === 1) {
    return `Picked atom ${ids[0]}. Pick a 2nd atom for bond length${suffix}`;
  }
  if (ids.length === 2) {
    const a = frame.atoms[ids[0]];
    const b = frame.atoms[ids[1]];
    if (!a || !b) return `Pick atoms to measure.${suffix}`;
    const d = distance(a, b);
    return `Bond length: ${ids[0]}-${ids[1]} = ${d.toFixed(3)} Å. Pick a 3rd atom for angle${suffix}`;
  }
  if (ids.length === 3) {
    const [a, b, c] = ids.map((id) => frame.atoms[id]);
    if (!a || !b || !c) return `Pick atoms to measure.${suffix}`;
    const angle = angleDegrees(a, b, c);
    return `Angle: ${ids[0]}-${ids[1]}-${ids[2]} = ${angle.toFixed(2)} deg. Pick a 4th atom for dihedral${suffix}`;
  }

  const [a, b, c, d] = ids.map((id) => frame.atoms[id]);
  if (!a || !b || !c || !d) return `Pick atoms to measure.${suffix}`;
  const dih = dihedralDegrees(a, b, c, d);
  return `Dihedral: ${ids[0]}-${ids[1]}-${ids[2]}-${ids[3]} = ${dih.toFixed(2)} deg. Pick another atom to start next measurement${suffix}`;
}

export function addSelectionOverlay(viewer, frame, ids) {
  const atoms = ids.map((id) => frame.atoms[id]);
  if (!atoms.length || atoms.some((a) => !a)) return;

  const tags = ["A", "B", "C", "D"];
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    viewer.addSphere({
      center: { x: atom.x, y: atom.y, z: atom.z },
      radius: 0.34,
      color: "#f97316",
      opacity: 0.7,
    });
    viewer.addLabel(`${tags[i]}${ids[i]}`, {
      position: { x: atom.x, y: atom.y, z: atom.z },
      fontColor: "#7c2d12",
      backgroundColor: "#ffedd5",
      backgroundOpacity: 0.88,
      borderThickness: 0,
      fontSize: 12,
      inFront: true,
    });
  }

  for (let i = 0; i < atoms.length - 1; i += 1) {
    const a = atoms[i];
    const b = atoms[i + 1];
    viewer.addLine({
      start: { x: a.x, y: a.y, z: a.z },
      end: { x: b.x, y: b.y, z: b.z },
      dashed: true,
      color: "#f97316",
      linewidth: 2,
    });
  }

  if (atoms.length === 2) {
    const [a, b] = atoms;
    viewer.addLabel(`${distance(a, b).toFixed(3)} Å`, {
      position: midpoint(a, b),
      fontColor: "#111827",
      backgroundColor: "#fff7d1",
      backgroundOpacity: 0.8,
      borderThickness: 0,
      fontSize: 13,
      inFront: true,
    });
  }

  if (atoms.length === 3) {
    const [a, b, c] = atoms;
    viewer.addLabel(`${angleDegrees(a, b, c).toFixed(2)} deg`, {
      position: centroid3(a, b, c),
      fontColor: "#111827",
      backgroundColor: "#e0f2fe",
      backgroundOpacity: 0.84,
      borderThickness: 0,
      fontSize: 13,
      inFront: true,
    });
  }

  if (atoms.length >= 4) {
    const [a, b, c, d] = atoms;
    viewer.addLabel(`${dihedralDegrees(a, b, c, d).toFixed(2)} deg`, {
      position: midpoint(b, c),
      fontColor: "#111827",
      backgroundColor: "#ede9fe",
      backgroundOpacity: 0.84,
      borderThickness: 0,
      fontSize: 13,
      inFront: true,
    });
  }
}
