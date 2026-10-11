import type { RoofShape, Vec2, Wall, WallType } from './types';

export const EPS = 1e-6;
export const JOIN_TOL = 1e-3;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
/** Perpendiculaire à gauche (rotation +90°). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const rotate = (p: Vec2, angle: number, c: Vec2 = { x: 0, y: 0 }): Vec2 => {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
};
export const samePoint = (a: Vec2, b: Vec2, tol = JOIN_TOL): boolean => dist(a, b) < tol;

/** Intersection de deux droites (p + t·d). Retourne null si parallèles. */
export function lineIntersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}

/** Projection d'un point sur un segment : paramètre t ∈ [0,1] et point le plus proche. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 < EPS ? 0 : dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, mul(ab, t));
  return { t, point, dist: dist(p, point) };
}

export function polygonArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonPerimeter(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

export function polygonCentroid(pts: Vec2[]): Vec2 {
  const a = polygonArea(pts);
  if (Math.abs(a) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), v(0, 0));
    return mul(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return v(cx / (6 * a), cy / (6 * a));
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function bounds(pts: Vec2[]): { min: Vec2; max: Vec2 } {
  const min = v(Infinity, Infinity);
  const max = v(-Infinity, -Infinity);
  for (const p of pts) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Murs
// ---------------------------------------------------------------------------

export const wallLength = (w: Wall): number => dist(w.a, w.b);
export const wallDir = (w: Wall): Vec2 => norm(sub(w.b, w.a));

export interface WallOutline {
  /** Coins gauche/droite (par rapport au sens a→b) aux extrémités a et b. */
  aL: Vec2;
  aR: Vec2;
  bL: Vec2;
  bR: Vec2;
  /** Vrai si l'extrémité est raccordée à un autre mur (pas de trait de fermeture en plan). */
  aJoined: boolean;
  bJoined: boolean;
}

type ThicknessOf = (w: Wall) => number;

interface EndResult {
  left: Vec2;
  right: Vec2;
  joined: boolean;
}

/**
 * Calcule les coins d'une extrémité de mur en tenant compte des raccords
 * (angles en onglet, jonctions multiples, raccords en T sur la face d'un autre mur).
 * left/right sont exprimés dans le repère « sortant » de l'extrémité.
 */
function endCorners(wall: Wall, end: 'a' | 'b', others: Wall[], thick: ThicknessOf): EndResult {
  const E = end === 'a' ? wall.a : wall.b;
  const dir = wallDir(wall);
  const dAway = end === 'a' ? dir : mul(dir, -1);
  const h = thick(wall) / 2;
  const nL = perp(dAway);
  const pL = add(E, mul(nL, h));
  const pR = add(E, mul(nL, -h));
  const limit = Math.max(h * 8, 0.5);
  let left = pL;
  let right = pR;
  let joined = false;

  const connected: { d: Vec2; h: number; ang: number }[] = [];
  for (const o of others) {
    if (o.id === wall.id || o.levelId !== wall.levelId) continue;
    let d: Vec2 | null = null;
    if (samePoint(o.a, E)) d = wallDir(o);
    else if (samePoint(o.b, E)) d = mul(wallDir(o), -1);
    if (!d || len(d) < EPS) continue;
    let ang = Math.atan2(cross(dAway, d), dot(dAway, d));
    if (ang <= 1e-6) ang += Math.PI * 2;
    connected.push({ d, h: thick(o) / 2, ang });
  }

  const accept = (p: Vec2 | null): p is Vec2 => !!p && dist(p, E) < limit;

  if (connected.length > 0) {
    connected.sort((x, y) => x.ang - y.ang);
    const ccw = connected[0];
    const cw = connected[connected.length - 1];
    // Côté gauche : rencontre le côté droit du voisin trigonométrique.
    const iL = lineIntersect(pL, dAway, add(E, mul(perp(ccw.d), -ccw.h)), ccw.d);
    const iR = lineIntersect(pR, dAway, add(E, mul(perp(cw.d), cw.h)), cw.d);
    // Murs colinéaires : on garde une coupe droite mais l'extrémité reste raccordée.
    if (accept(iL)) left = iL;
    if (accept(iR)) right = iR;
    joined = true;
  } else {
    // Raccord en T : l'extrémité touche le milieu d'un autre mur.
    for (const o of others) {
      if (o.id === wall.id || o.levelId !== wall.levelId) continue;
      const ho = thick(o) / 2;
      const pr = projectOnSegment(E, o.a, o.b);
      const lo = wallLength(o);
      if (pr.t * lo < ho || (1 - pr.t) * lo < ho) continue;
      if (pr.dist > ho + JOIN_TOL) continue;
      const od = wallDir(o);
      const nO = perp(od);
      const side = Math.sign(dot(dAway, nO)) || 1;
      if (Math.abs(dot(dAway, nO)) < 0.05) continue;
      const faceP = add(o.a, mul(nO, ho * side));
      const iL = lineIntersect(pL, dAway, faceP, od);
      const iR = lineIntersect(pR, dAway, faceP, od);
      if (accept(iL) && accept(iR)) {
        left = iL;
        right = iR;
        joined = true;
        break;
      }
    }
  }
  return { left, right, joined };
}

export function wallOutline(wall: Wall, walls: Wall[], thick: ThicknessOf): WallOutline {
  const ea = endCorners(wall, 'a', walls, thick);
  const eb = endCorners(wall, 'b', walls, thick);
  // À l'extrémité b, la gauche « sortante » est la droite du sens a→b.
  return { aL: ea.left, aR: ea.right, bL: eb.right, bR: eb.left, aJoined: ea.joined, bJoined: eb.joined };
}

export interface OpeningSpan {
  id: string;
  start: number;
  end: number;
  bottom: number;
  top: number;
}

export interface WallPiece {
  /** Polygone d'emprise [s0L, s1L, s1R, s0R]. */
  quad: [Vec2, Vec2, Vec2, Vec2];
  s0: number;
  s1: number;
  bottom: number;
  top: number;
  /** Faut-il dessiner un trait de fermeture en plan à chaque extrémité ? */
  capStart: boolean;
  capEnd: boolean;
}

/**
 * Découpe un mur en volumes pleins autour de ses ouvertures (portes/fenêtres).
 * Les hauteurs sont relatives à la base du mur.
 */
export function wallPieces(
  wall: Wall,
  outline: WallOutline,
  thickness: number,
  openings: OpeningSpan[],
): WallPiece[] {
  const L = wallLength(wall);
  const dir = wallDir(wall);
  const n = perp(dir);
  const h = thickness / 2;
  const H = wall.height;
  const leftAt = (s: number): Vec2 =>
    s <= EPS ? outline.aL : s >= L - EPS ? outline.bL : add(add(wall.a, mul(dir, s)), mul(n, h));
  const rightAt = (s: number): Vec2 =>
    s <= EPS ? outline.aR : s >= L - EPS ? outline.bR : add(add(wall.a, mul(dir, s)), mul(n, -h));
  const quad = (s0: number, s1: number): [Vec2, Vec2, Vec2, Vec2] => [leftAt(s0), leftAt(s1), rightAt(s1), rightAt(s0)];

  const ops = openings
    .map((o) => ({ ...o, start: Math.max(0, o.start), end: Math.min(L, o.end), top: Math.min(H, o.top) }))
    .filter((o) => o.end - o.start > EPS)
    .sort((x, y) => x.start - y.start);

  const pieces: WallPiece[] = [];
  let cursor = 0;
  for (const o of ops) {
    const s0 = Math.max(cursor, o.start);
    if (o.start > cursor + EPS) {
      pieces.push({
        quad: quad(cursor, o.start),
        s0: cursor,
        s1: o.start,
        bottom: 0,
        top: H,
        capStart: cursor <= EPS ? !outline.aJoined : true,
        capEnd: true,
      });
    }
    if (o.end > s0 + EPS) {
      if (o.bottom > EPS) {
        pieces.push({ quad: quad(s0, o.end), s0, s1: o.end, bottom: 0, top: o.bottom, capStart: false, capEnd: false });
      }
      if (o.top < H - EPS) {
        pieces.push({ quad: quad(s0, o.end), s0, s1: o.end, bottom: o.top, top: H, capStart: false, capEnd: false });
      }
    }
    cursor = Math.max(cursor, o.end);
  }
  if (cursor < L - EPS || ops.length === 0) {
    pieces.push({
      quad: quad(cursor, L),
      s0: cursor,
      s1: L,
      bottom: 0,
      top: H,
      capStart: cursor <= EPS ? !outline.aJoined : true,
      capEnd: !outline.bJoined,
    });
  }
  return pieces;
}

export function wallTypeThickness(types: WallType[]): ThicknessOf {
  const map = new Map(types.map((t) => [t.id, t.thickness]));
  return (w) => map.get(w.typeId) ?? 0.2;
}

// ---------------------------------------------------------------------------
// Toits

export interface RoofFacet {
  /** Contour du pan en plan. */
  points: Vec2[];
}

interface SlopeEdge {
  a: Vec2;
  inward: Vec2;
}

/** Arêtes du contour qui définissent une pente, selon la forme du toit. */
export function roofSlopeEdges(points: Vec2[], shape: RoofShape | undefined, slope: number): SlopeEdge[] {
  const n = points.length;
  if (n < 3 || slope <= 0 || shape === 'flat') return [];
  const ccw = polygonArea(points) >= 0;
  const edges = points.map((a, i) => {
    const d = norm(sub(points[(i + 1) % n], a));
    return { a, d, inward: ccw ? perp(d) : mul(perp(d), -1) };
  });
  const s = shape ?? 'mono';
  if (s === 'hip') return edges;
  if (s === 'mono') return [edges[0]];
  // Deux pans : première arête et l'arête la plus opposée (antiparallèle).
  let best = 1;
  let bestDot = Infinity;
  for (let i = 1; i < n; i++) {
    const dd = dot(edges[i].d, edges[0].d);
    if (dd < bestDot) {
      bestDot = dd;
      best = i;
    }
  }
  return [edges[0], edges[best]];
}

/** Hauteur de la sous-face du toit en un point (relative à sa base). */
export function roofHeightAt(points: Vec2[], slopeDeg: number, p: Vec2, shape?: RoofShape): number {
  const edges = roofSlopeEdges(points, shape, slopeDeg);
  if (!edges.length) return 0;
  const t = Math.tan((slopeDeg * Math.PI) / 180);
  let m = Infinity;
  for (const e of edges) m = Math.min(m, dot(sub(p, e.a), e.inward));
  return Math.max(0, m) * t;
}

/** Découpe d'un polygone par le demi-plan dot(p, n) <= c (Sutherland–Hodgman). */
function clipHalfPlane(poly: Vec2[], n: Vec2, c: number): Vec2[] {
  const out: Vec2[] = [];
  const inside = (p: Vec2) => dot(p, n) <= c + 1e-9;
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const ci = inside(cur);
    const pi = inside(prev);
    if (ci !== pi) {
      const dp = dot(prev, n) - c;
      const dc = dot(cur, n) - c;
      out.push(lerp(prev, cur, dp / (dp - dc)));
    }
    if (ci) out.push(cur);
  }
  return out;
}

/**
 * Pans du toit : chaque arête définissant la pente gouverne la zone du plan
 * où elle est la plus proche (pans plans, faîtages et arêtiers aux frontières).
 */
export function roofFacets(points: Vec2[], shape: RoofShape | undefined, slope: number): RoofFacet[] {
  const edges = roofSlopeEdges(points, shape, slope);
  if (edges.length <= 1) return [{ points }];
  const facets: RoofFacet[] = [];
  edges.forEach((ei, i) => {
    let poly = points;
    edges.forEach((ej, j) => {
      if (i === j || poly.length < 3) return;
      // d_i(p) <= d_j(p)  ⇔  dot(p, in_i - in_j) <= dot(a_i, in_i) - dot(a_j, in_j)
      const n = sub(ei.inward, ej.inward);
      const c = dot(ei.a, ei.inward) - dot(ej.a, ej.inward);
      if (len(n) < 1e-9) {
        // Arêtes parallèles de même sens : la plus intérieure l'emporte, égalité → la première.
        if (c > 1e-9 || (Math.abs(c) <= 1e-9 && j < i)) poly = [];
        return;
      }
      poly = clipHalfPlane(poly, n, c);
    });
    if (poly.length >= 3 && Math.abs(polygonArea(poly)) > 1e-6) facets.push({ points: poly });
  });
  return facets;
}

export interface StairStep {
  quad: [Vec2, Vec2, Vec2, Vec2];
  z0: number;
  z1: number;
}

export function stairRisers(height: number, maxRiser: number): number {
  return Math.max(1, Math.ceil(height / Math.max(0.05, maxRiser) - 1e-9));
}

/** Marches d'un escalier droit entre a (départ) et b (arrivée). */
export function stairSteps(a: Vec2, b: Vec2, width: number, height: number, maxRiser: number): StairStep[] {
  const n = stairRisers(height, maxRiser);
  const run = dist(a, b);
  const dir = norm(sub(b, a));
  const side = mul(perp(dir), width / 2);
  const tread = run / n;
  const riser = height / n;
  const steps: StairStep[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = add(a, mul(dir, tread * i));
    const p1 = add(a, mul(dir, tread * (i + 1)));
    steps.push({
      quad: [add(p0, side), add(p1, side), sub(p1, side), sub(p0, side)],
      z0: 0,
      z1: riser * (i + 1),
    });
  }
  return steps;
}
