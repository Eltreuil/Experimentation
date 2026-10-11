// Génération de la géométrie 3D (indépendante du moteur de rendu) : chaque
// élément produit des solides triangulés, réutilisés par la vue 3D et l'export.
import { polygonArea, projectOnSegment, roofFacets, roofHeightAt, stairSteps, wallPieces, add, mul, perp, type RoofFacet } from './geometry';
import type { Project } from './project';
import type { Element, Id, Vec2 } from './types';

/** Repère monde : x = est, y = haut, z = -nord (repère Three.js). */
export type V3 = [number, number, number];

export interface Solid {
  /** Triangles à plat : 9 nombres par triangle. */
  positions: number[];
  color: string;
  /** Matériau de rendu. */
  material: 'opaque' | 'glass';
}

export interface ElementMesh {
  id: Id;
  kind: Element['kind'];
  solids: Solid[];
}

const toW = (p: Vec2, z: number): V3 => [p.x, z, -p.y];

function pushTri(out: number[], a: V3, b: V3, c: V3): void {
  out.push(...a, ...b, ...c);
}

function pushQuad(out: number[], a: V3, b: V3, c: V3, d: V3): void {
  pushTri(out, a, b, c);
  pushTri(out, a, c, d);
}

/**
 * Triangulation d'un polygone simple (ear clipping). Retourne des indices.
 * Le polygone peut être horaire ou anti-horaire.
 */
export function triangulate(pts: Vec2[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (polygonArea(pts) < 0) idx.reverse();
  const tris: [number, number, number][] = [];
  const isEar = (i0: number, i1: number, i2: number, list: number[]): boolean => {
    const a = pts[i0];
    const b = pts[i1];
    const c = pts[i2];
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cr <= 1e-12) return false;
    for (const k of list) {
      if (k === i0 || k === i1 || k === i2) continue;
      const p = pts[k];
      const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      const d2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
      const d3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
      if (d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12) return false;
    }
    return true;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      if (isEar(i0, i1, i2, idx)) {
        tris.push([i0, i1, i2]);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) {
      // Polygone dégénéré : éventail de secours.
      for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
      return tris;
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** Prisme vertical : contour à plat, extrudé de z0 à z1 (hauteurs absolues, éventuellement variables). */
export function prism(pts: Vec2[], z0: number | ((p: Vec2) => number), z1: number | ((p: Vec2) => number)): number[] {
  const out: number[] = [];
  const bot = (p: Vec2) => (typeof z0 === 'number' ? z0 : z0(p));
  const top = (p: Vec2) => (typeof z1 === 'number' ? z1 : z1(p));
  const ccw = polygonArea(pts) >= 0;
  const ring = ccw ? pts : [...pts].reverse();
  const tris = triangulate(ring);
  for (const [a, b, c] of tris) {
    pushTri(out, toW(ring[a], top(ring[a])), toW(ring[b], top(ring[b])), toW(ring[c], top(ring[c])));
    pushTri(out, toW(ring[a], bot(ring[a])), toW(ring[c], bot(ring[c])), toW(ring[b], bot(ring[b])));
  }
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    pushQuad(out, toW(p, bot(p)), toW(q, bot(q)), toW(q, top(q)), toW(p, top(p)));
  }
  return out;
}

/** Toit : pans triangulés (dessus et sous-face) et rives sur le contour extérieur. */
function roofSolid(outline: Vec2[], facets: RoofFacet[], h: (p: Vec2) => number, thickness: number): number[] {
  const out: number[] = [];
  const onOutline = (p: Vec2, q: Vec2): boolean => {
    const m = mul(add(p, q), 0.5);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if (projectOnSegment(p, a, b).dist < 1e-6 && projectOnSegment(q, a, b).dist < 1e-6 && projectOnSegment(m, a, b).dist < 1e-6) return true;
    }
    return false;
  };
  for (const f of facets) {
    const ring = polygonArea(f.points) >= 0 ? f.points : [...f.points].reverse();
    for (const [a, b, c] of triangulate(ring)) {
      const [pa, pb, pc] = [ring[a], ring[b], ring[c]];
      pushTri(out, toW(pa, h(pa) + thickness), toW(pb, h(pb) + thickness), toW(pc, h(pc) + thickness));
      pushTri(out, toW(pa, h(pa)), toW(pc, h(pc)), toW(pb, h(pb)));
    }
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if (!onOutline(p, q)) continue;
      pushQuad(out, toW(p, h(p)), toW(q, h(q)), toW(q, h(q) + thickness), toW(p, h(p) + thickness));
    }
  }
  return out;
}

/** Boîte orientée selon une direction en plan. */
function orientedBox(center: Vec2, dir: Vec2, along: number, across: number, z0: number, z1: number): number[] {
  const n = perp(dir);
  const a = mul(dir, along / 2);
  const c = mul(n, across / 2);
  const pts = [add(add(center, mul(a, -1)), mul(c, -1)), add(add(center, a), mul(c, -1)), add(add(center, a), c), add(add(center, mul(a, -1)), c)];
  return prism(pts, z0, z1);
}

export function elementMeshes(p: Project, e: Element): ElementMesh | null {
  const lvlElev = (levelId: Id) => p.level(levelId)?.elevation ?? 0;
  const solids: Solid[] = [];
  switch (e.kind) {
    case 'wall': {
      const t = p.wallType(e.typeId);
      const base = lvlElev(e.levelId) + e.baseOffset;
      for (const pc of wallPieces(e, p.outline(e), t.thickness, p.openingSpans(e))) {
        solids.push({ positions: prism(pc.quad, base + pc.bottom, base + pc.top), color: t.color, material: 'opaque' });
      }
      break;
    }
    case 'door':
    case 'window': {
      const fr = p.openingFrame(e);
      if (!fr) return null;
      const wall = fr.wall;
      const t = p.thickness(wall);
      const base = lvlElev(wall.levelId) + wall.baseOffset;
      const frame = 0.05;
      if (e.kind === 'door') {
        const dt = p.doorType(e.typeId);
        const z1 = base + dt.height;
        // Huisserie (montants + traverse) et vantail.
        const dir = fr.dir;
        const jL = add(fr.center, mul(dir, -dt.width / 2 + frame / 2));
        const jR = add(fr.center, mul(dir, dt.width / 2 - frame / 2));
        const frameColor = '#e8e4dc';
        solids.push({ positions: orientedBox(jL, dir, frame, t + 0.01, base, z1), color: frameColor, material: 'opaque' });
        solids.push({ positions: orientedBox(jR, dir, frame, t + 0.01, base, z1), color: frameColor, material: 'opaque' });
        solids.push({ positions: orientedBox(fr.center, dir, dt.width, t + 0.01, z1 - frame, z1), color: frameColor, material: 'opaque' });
        const side = e.flipFacing ? 1 : -1;
        const leafPos = add(fr.center, mul(perp(dir), (side * t) / 2 - side * 0.03));
        solids.push({ positions: orientedBox(leafPos, dir, dt.width - frame * 2, 0.04, base, z1 - frame), color: dt.color, material: 'opaque' });
      } else {
        const wt = p.windowType(e.typeId);
        const z0 = base + e.sill;
        const z1 = z0 + wt.height;
        const dir = fr.dir;
        const fw = 0.06;
        const depth = 0.08;
        const c = fr.center;
        const parts: [Vec2, number, number, number][] = [
          [add(c, mul(dir, -wt.width / 2 + fw / 2)), fw, z0, z1],
          [add(c, mul(dir, wt.width / 2 - fw / 2)), fw, z0, z1],
        ];
        for (const [pos, w, a, b] of parts) solids.push({ positions: orientedBox(pos, dir, w, depth, a, b), color: wt.color, material: 'opaque' });
        solids.push({ positions: orientedBox(c, dir, wt.width, depth, z0, z0 + fw), color: wt.color, material: 'opaque' });
        solids.push({ positions: orientedBox(c, dir, wt.width, depth, z1 - fw, z1), color: wt.color, material: 'opaque' });
        if (wt.width > 1.0) solids.push({ positions: orientedBox(c, dir, fw, depth, z0, z1), color: wt.color, material: 'opaque' });
        // Appui de fenêtre
        if (e.sill > 0.05) {
          const sillPos = add(c, mul(perp(dir), 0));
          solids.push({ positions: orientedBox(sillPos, dir, wt.width + 0.06, t + 0.06, z0 - 0.03, z0), color: '#cfcac0', material: 'opaque' });
        }
        solids.push({ positions: orientedBox(c, dir, wt.width - fw, 0.012, z0 + fw, z1 - fw), color: '#9cc9e8', material: 'glass' });
      }
      break;
    }
    case 'floor': {
      const top = lvlElev(e.levelId) + e.offset;
      solids.push({ positions: prism(e.points, top - e.thickness, top), color: '#bdb6a8', material: 'opaque' });
      break;
    }
    case 'roof': {
      const base = lvlElev(e.levelId) + e.baseOffset;
      const slope = e.shape === 'flat' ? 0 : e.slope;
      const h = (q: Vec2) => base + roofHeightAt(e.points, slope, q, e.shape);
      const vertical = e.thickness / Math.cos((Math.min(slope, 80) * Math.PI) / 180);
      solids.push({ positions: roofSolid(e.points, roofFacets(e.points, e.shape, slope), h, vertical), color: '#8c4a3a', material: 'opaque' });
      break;
    }
    case 'column': {
      const base = lvlElev(e.levelId);
      let pts: Vec2[];
      if (e.shape === 'round') {
        pts = [];
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          pts.push({ x: e.pos.x + Math.cos(a) * (e.width / 2), y: e.pos.y + Math.sin(a) * (e.width / 2) });
        }
      } else {
        const a = (e.rotation * Math.PI) / 180;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        solids.push({ positions: orientedBox(e.pos, dir, e.width, e.depth, base, base + e.height), color: '#a7a9ac', material: 'opaque' });
        break;
      }
      solids.push({ positions: prism(pts, base, base + e.height), color: '#a7a9ac', material: 'opaque' });
      break;
    }
    case 'stair': {
      const base = lvlElev(e.levelId);
      const steps = stairSteps(e.a, e.b, e.width, e.height, e.maxRiser);
      // Escalier massif : chaque marche est un bloc posé sur le niveau.
      for (const s of steps) {
        solids.push({ positions: prism(s.quad, base, base + s.z1), color: '#d4c4a8', material: 'opaque' });
      }
      break;
    }
    case 'room':
    case 'dimension':
    case 'grid':
      return null;
  }
  return { id: e.id, kind: e.kind, solids };
}

/** Volume d'un maillage fermé (théorème de la divergence). */
export function meshVolume(positions: number[]): number {
  let vol = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol);
}

