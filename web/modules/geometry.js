export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

export function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

export function centroid3(a, b, c) {
  return {
    x: (a.x + b.x + c.x) / 3,
    y: (a.y + b.y + c.y) / 3,
    z: (a.z + b.z + c.z) / 3,
  };
}

export function angleDegrees(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const baNorm = norm(ba);
  const bcNorm = norm(bc);
  if (baNorm < 1e-12 || bcNorm < 1e-12) return 0;
  const cosTheta = clamp(dot(ba, bc) / (baNorm * bcNorm), -1, 1);
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

export function dihedralDegrees(a, b, c, d) {
  const b1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const b2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const b3 = { x: d.x - c.x, y: d.y - c.y, z: d.z - c.z };
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const b2norm = norm(b2);
  const n1norm = norm(n1);
  const n2norm = norm(n2);
  if (b2norm < 1e-12 || n1norm < 1e-12 || n2norm < 1e-12) return 0;

  const b2unit = scale(b2, 1 / b2norm);
  const m1 = cross(n1, b2unit);
  const x = dot(n1, n2);
  const y = dot(m1, n2);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function dot(u, v) {
  return u.x * v.x + u.y * v.y + u.z * v.z;
}

function cross(u, v) {
  return {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  };
}

function norm(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function scale(v, factor) {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
