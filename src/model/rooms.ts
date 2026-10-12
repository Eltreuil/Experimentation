import { bounds, lineIntersect, norm, perp, add, mul, sub, pointInPolygon, polygonArea } from './geometry';
import type { Project } from './project';
import type { Column, Id, Vec2, Wall } from './types';
import { phaseStatus } from './phases';

/**
 * Rasterise les murs d'un niveau sur une grille fine. Utilisé pour détecter
 * automatiquement les contours de pièces et l'emprise extérieure du bâtiment.
 */
class WallRaster {
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  readonly origin: Vec2;
  readonly solid: Uint8Array;

  constructor(project: Project, levelId: Id, margin = 1, phaseId?: Id) {
    // Seuls les murs présents dans la phase délimitent les pièces.
    const present = (e: Wall | Column) => {
      if (!phaseId) return true;
      const st = phaseStatus(project, e, phaseId);
      return st === 'existing' || st === 'new';
    };
    const walls = project.ofKind('wall', levelId).filter(present);
    const polys = walls.map((w) => {
      const o = project.outline(w);
      return [o.aL, o.bL, o.bR, o.aR];
    });
    for (const c of project.ofKind('column', levelId).filter(present)) {
      const h = c.width / 2;
      polys.push([
        { x: c.pos.x - h, y: c.pos.y - h },
        { x: c.pos.x + h, y: c.pos.y - h },
        { x: c.pos.x + h, y: c.pos.y + h },
        { x: c.pos.x - h, y: c.pos.y + h },
      ]);
    }
    const all = polys.flat();
    const b = all.length ? bounds(all) : { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
    const w = b.max.x - b.min.x + margin * 2;
    const h = b.max.y - b.min.y + margin * 2;
    // Résolution de 2 cm, réduite si le modèle est très grand.
    let cell = 0.02;
    while ((w / cell) * (h / cell) > 4_000_000) cell *= 1.5;
    this.cell = cell;
    this.origin = { x: b.min.x - margin, y: b.min.y - margin };
    this.nx = Math.ceil(w / cell);
    this.ny = Math.ceil(h / cell);
    this.solid = new Uint8Array(this.nx * this.ny);
    for (const poly of polys) {
      const pb = bounds(poly);
      const i0 = Math.max(0, Math.floor((pb.min.x - this.origin.x) / cell));
      const i1 = Math.min(this.nx - 1, Math.ceil((pb.max.x - this.origin.x) / cell));
      const j0 = Math.max(0, Math.floor((pb.min.y - this.origin.y) / cell));
      const j1 = Math.min(this.ny - 1, Math.ceil((pb.max.y - this.origin.y) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (pointInPolygon(this.center(i, j), poly)) this.solid[j * this.nx + i] = 1;
        }
      }
    }
  }

  center(i: number, j: number): Vec2 {
    return { x: this.origin.x + (i + 0.5) * this.cell, y: this.origin.y + (j + 0.5) * this.cell };
  }

  cellOf(p: Vec2): [number, number] {
    return [Math.floor((p.x - this.origin.x) / this.cell), Math.floor((p.y - this.origin.y) / this.cell)];
  }

  /** Remplissage par diffusion depuis une cellule. Retourne null si la zone touche le bord. */
  flood(i0: number, j0: number, allowBorder = false): Uint8Array | null {
    const { nx, ny, solid } = this;
    if (i0 < 0 || j0 < 0 || i0 >= nx || j0 >= ny || solid[j0 * nx + i0]) return null;
    const mark = new Uint8Array(nx * ny);
    const stack = [j0 * nx + i0];
    mark[j0 * nx + i0] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % nx;
      const j = (k - i) / nx;
      if (!allowBorder && (i === 0 || j === 0 || i === nx - 1 || j === ny - 1)) return null;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1];
      for (const n of nb) {
        if (n >= 0 && !mark[n] && !solid[n]) {
          mark[n] = 1;
          stack.push(n);
        }
      }
    }
    return mark;
  }

  /** Contour extérieur (sens trigonométrique) d'une région de cellules marquées. */
  trace(mark: Uint8Array): Vec2[] {
    const { nx, ny, cell, origin } = this;
    const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && mark[j * nx + i] === 1;
    // Arêtes orientées entre coins de cellules (indices de sommets (nx+1)*(ny+1)).
    const next = new Map<number, number[]>();
    const vid = (i: number, j: number) => j * (nx + 1) + i;
    const addEdge = (a: number, b: number) => {
      const l = next.get(a);
      if (l) l.push(b);
      else next.set(a, [b]);
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!filled(i, j)) continue;
        if (!filled(i, j - 1)) addEdge(vid(i, j), vid(i + 1, j));
        if (!filled(i + 1, j)) addEdge(vid(i + 1, j), vid(i + 1, j + 1));
        if (!filled(i, j + 1)) addEdge(vid(i + 1, j + 1), vid(i, j + 1));
        if (!filled(i - 1, j)) addEdge(vid(i, j + 1), vid(i, j));
      }
    }
    const loops: Vec2[][] = [];
    while (next.size) {
      const start = next.keys().next().value as number;
      const loop: number[] = [];
      let cur = start;
      for (let guard = 0; guard < 10_000_000; guard++) {
        const outs = next.get(cur);
        if (!outs || outs.length === 0) break;
        const nxt = outs.pop()!;
        if (outs.length === 0) next.delete(cur);
        loop.push(cur);
        cur = nxt;
        if (cur === start) break;
      }
      loops.push(
        loop.map((k) => {
          const i = k % (nx + 1);
          const j = (k - i) / (nx + 1);
          return { x: origin.x + i * cell, y: origin.y + j * cell };
        }),
      );
    }
    loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    return loops[0] ?? [];
  }
}

/** Simplification de Douglas-Peucker sur un polygone fermé. */
export function simplifyPolygon(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 4) return pts;
  const dp = (seg: Vec2[]): Vec2[] => {
    if (seg.length < 3) return seg;
    const a = seg[0];
    const b = seg[seg.length - 1];
    const d = sub(b, a);
    const L = Math.hypot(d.x, d.y);
    let maxD = -1;
    let idx = 0;
    for (let i = 1; i < seg.length - 1; i++) {
      const p = seg[i];
      const dd = L < 1e-9 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x) / L;
      if (dd > maxD) {
        maxD = dd;
        idx = i;
      }
    }
    if (maxD <= tol) return [a, b];
    const left = dp(seg.slice(0, idx + 1));
    const right = dp(seg.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  // On coupe le contour au point le plus éloigné du premier pour un résultat stable.
  let far = 0;
  let farD = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = dp(pts.slice(0, far + 1));
  const b = dp([...pts.slice(far), pts[0]]);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
}

/** Détecte le contour de la pièce fermée contenant le point p, ou null si la zone n'est pas close. */
export function detectRoom(project: Project, levelId: Id, p: Vec2, phaseId?: Id): Vec2[] | null {
  const r = new WallRaster(project, levelId, 1, phaseId);
  const [i, j] = r.cellOf(p);
  const mark = r.flood(i, j);
  if (!mark) return null;
  const loop = r.trace(mark);
  if (loop.length < 3) return null;
  return snapToFaces(project, levelId, simplifyPolygon(loop, r.cell * 1.5));
}

/** Contour extérieur de l'ensemble des murs d'un niveau (emprise du bâtiment). */
export function buildingFootprint(project: Project, levelId: Id): Vec2[] | null {
  const r = new WallRaster(project, levelId);
  const outside = r.flood(0, 0, true);
  if (!outside) return null;
  const inside = new Uint8Array(outside.length);
  for (let k = 0; k < outside.length; k++) inside[k] = outside[k] ? 0 : 1;
  const loop = r.trace(inside);
  if (loop.length < 3) return null;
  return snapToFaces(project, levelId, simplifyPolygon(loop, r.cell * 1.5));
}

/**
 * Recale chaque arête du contour rastérisé sur la face de mur parallèle la plus proche,
 * puis recalcule les sommets par intersection : on retrouve des cotes exactes.
 */
function snapToFaces(project: Project, levelId: Id, pts: Vec2[]): Vec2[] {
  const faces: { p: Vec2; d: Vec2 }[] = [];
  for (const w of project.ofKind('wall', levelId)) {
    if (w.phaseDemolished) continue;
    const o = project.outline(w);
    faces.push({ p: o.aL, d: norm(sub(o.bL, o.aL)) }, { p: o.aR, d: norm(sub(o.bR, o.aR)) });
  }
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const d = norm(sub(b, a));
    const mid = mul(add(a, b), 0.5);
    let best: { p: Vec2; d: Vec2 } = { p: mid, d };
    let bestD = 0.06;
    for (const f of faces) {
      if (Math.abs(f.d.x * d.y - f.d.y * d.x) > 0.02) continue;
      const nn = perp(f.d);
      const dd = Math.abs((mid.x - f.p.x) * nn.x + (mid.y - f.p.y) * nn.y);
      if (dd < bestD) {
        bestD = dd;
        best = { p: f.p, d: f.d };
      }
    }
    return best;
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const ip = lineIntersect(prev.p, prev.d, cur.p, cur.d);
    out.push(ip && Math.hypot(ip.x - pts[i].x, ip.y - pts[i].y) < 0.1 ? ip : pts[i]);
  }
  return out.map((p) => ({ x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 }));
}

/** Décalage d'un polygone (positif = vers l'extérieur). */
export function offsetPolygon(pts: Vec2[], d: number): Vec2[] {
  const ccw = polygonArea(pts) >= 0;
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dir = norm(sub(b, a));
    const out = ccw ? mul(perp(dir), -1) : perp(dir);
    return { p: add(a, mul(out, d)), d: dir };
  });
  return pts.map((p, i) => {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    return lineIntersect(prev.p, prev.d, cur.p, cur.d) ?? add(p, mul(perp(cur.d), ccw ? -d : d));
  });
}
