import { distance } from "./geometry.js";

const BOND_TOLERANCE_SCALE = 1.25;
const MIN_BOND_DISTANCE = 0.35;

const COVALENT_RADII = {
  H: 0.31,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Br: 1.2,
  I: 1.39,
  Si: 1.11,
};

const PREFERRED_VALENCE = {
  H: 1,
  B: 3,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  P: 3,
  S: 2,
  Cl: 1,
  Br: 1,
  I: 1,
  Si: 4,
};

const AROMATIC_ELEMENTS = new Set(["B", "C", "N", "O", "P", "S"]);

export function toMolWithInferredBondOrders(atoms) {
  const bonds = inferBondsWithOrders(atoms);
  const lines = [
    "molvis",
    "3Dmol inferred bonds",
    "",
    formatMolCounts(atoms.length, bonds.length),
  ];

  for (const atom of atoms) {
    lines.push(
      `${padMolFloat(atom.x, 10, 4)}${padMolFloat(atom.y, 10, 4)}${padMolFloat(atom.z, 10, 4)} ${padMolAtom(atom.element)}  0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  }

  for (const bond of bonds) {
    lines.push(
      `${String(bond.a + 1).padStart(3, " ")}${String(bond.b + 1).padStart(3, " ")}${String(bond.order).padStart(3, " ")}  0  0  0  0`,
    );
  }

  lines.push("M  END");
  return lines.join("\n");
}

function inferBondsWithOrders(atoms) {
  const candidateBonds = [];
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const a = atoms[i];
      const b = atoms[j];
      const dist = distance(a, b);
      const maxDist =
        (getCovalentRadius(a.element) + getCovalentRadius(b.element)) *
        BOND_TOLERANCE_SCALE;
      if (dist >= MIN_BOND_DISTANCE && dist <= maxDist) {
        candidateBonds.push({ a: i, b: j, dist, order: 1 });
      }
    }
  }

  const valenceUsed = new Array(atoms.length).fill(0);
  for (const bond of candidateBonds) {
    valenceUsed[bond.a] += 1;
    valenceUsed[bond.b] += 1;
  }

  const remainingValence = atoms.map((atom, idx) => {
    const preferred = getPreferredValence(atom.element);
    return Math.max(0, preferred - valenceUsed[idx]);
  });

  const incrementOrderPass = () => {
    const sorted = [...candidateBonds].sort((x, y) => x.dist - y.dist);
    for (const bond of sorted) {
      const maxOrder = getMaxBondOrder(
        atoms[bond.a].element,
        atoms[bond.b].element,
      );
      if (bond.order >= maxOrder) continue;
      if (remainingValence[bond.a] <= 0 || remainingValence[bond.b] <= 0)
        continue;
      bond.order += 1;
      remainingValence[bond.a] -= 1;
      remainingValence[bond.b] -= 1;
    }
  };

  incrementOrderPass();
  incrementOrderPass();
  assignAromaticRings(atoms, candidateBonds);

  return candidateBonds;
}

function assignAromaticRings(atoms, bonds) {
  if (bonds.length < 6) return;
  const adjacency = new Map();
  const bondByEdge = new Map();

  for (const bond of bonds) {
    if (!adjacency.has(bond.a)) adjacency.set(bond.a, []);
    if (!adjacency.has(bond.b)) adjacency.set(bond.b, []);
    adjacency.get(bond.a).push(bond.b);
    adjacency.get(bond.b).push(bond.a);
    bondByEdge.set(edgeKey(bond.a, bond.b), bond);
  }

  const rings = findSixMemberCycles(atoms.length, adjacency);
  for (const ring of rings) {
    if (!isAromaticRing(ring, atoms, adjacency, bondByEdge)) continue;
    applyKekulePattern(ring, bondByEdge);
  }
}

function applyKekulePattern(ring, bondByEdge) {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const bond = bondByEdge.get(edgeKey(a, b));
    if (!bond) continue;
    bond.order = i % 2 === 0 ? 2 : 1;
  }
}

function isAromaticRing(ring, atoms, adjacency, bondByEdge) {
  const lengths = [];

  for (let i = 0; i < ring.length; i += 1) {
    const atomIdx = ring[i];
    const element = normalizeElement(atoms[atomIdx]?.element);
    if (!AROMATIC_ELEMENTS.has(element)) return false;
    if ((adjacency.get(atomIdx)?.length ?? 0) < 2) return false;

    const next = ring[(i + 1) % ring.length];
    const bond = bondByEdge.get(edgeKey(atomIdx, next));
    if (!bond) return false;
    lengths.push(bond.dist);
  }

  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  const avgLen =
    lengths.reduce((sum, value) => sum + value, 0) / lengths.length;

  if (avgLen < 1.3 || avgLen > 1.47) return false;
  if (maxLen - minLen > 0.16) return false;
  return true;
}

function findSixMemberCycles(atomCount, adjacency) {
  const seen = new Set();
  const cycles = [];

  const dfs = (start, current, path, used) => {
    if (path.length === 6) {
      if (adjacency.get(current)?.includes(start)) {
        const key = canonicalCycleKey(path);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...path]);
        }
      }
      return;
    }

    const neighbors = adjacency.get(current) ?? [];
    for (const next of neighbors) {
      if (next === start) continue;
      if (used.has(next)) continue;
      if (next < start) continue;
      used.add(next);
      path.push(next);
      dfs(start, next, path, used);
      path.pop();
      used.delete(next);
    }
  };

  for (let start = 0; start < atomCount; start += 1) {
    const used = new Set([start]);
    dfs(start, start, [start], used);
  }

  return cycles;
}

function canonicalCycleKey(cycle) {
  const n = cycle.length;
  const variants = [];

  for (let shift = 0; shift < n; shift += 1) {
    const forward = [];
    const backward = [];
    for (let i = 0; i < n; i += 1) {
      forward.push(cycle[(shift + i) % n]);
      backward.push(cycle[(shift - i + n) % n]);
    }
    variants.push(forward.join("-"));
    variants.push(backward.join("-"));
  }

  variants.sort();
  return variants[0];
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function getMaxBondOrder(elemA, elemB) {
  if (isSingleOnlyElement(elemA) || isSingleOnlyElement(elemB)) {
    return 1;
  }
  return 3;
}

function isSingleOnlyElement(element) {
  const normalized = normalizeElement(element);
  return ["H", "F", "Cl", "Br", "I"].includes(normalized);
}

function getPreferredValence(element) {
  return PREFERRED_VALENCE[normalizeElement(element)] ?? 4;
}

function getCovalentRadius(element) {
  return COVALENT_RADII[normalizeElement(element)] ?? 0.77;
}

function formatMolCounts(atomCount, bondCount) {
  return `${String(atomCount).padStart(3, " ")}${String(bondCount).padStart(3, " ")}  0  0  0  0  0  0  0  0  1 V2000`;
}

function padMolFloat(value, width, decimals) {
  return Number(value).toFixed(decimals).padStart(width, " ");
}

function padMolAtom(element) {
  return normalizeElement(element).slice(0, 3).padEnd(3, " ");
}

function normalizeElement(element) {
  if (!element) return "C";
  const text = String(element).trim();
  if (!text) return "C";
  if (text.length === 1) return text.toUpperCase();
  return text[0].toUpperCase() + text.slice(1).toLowerCase();
}
