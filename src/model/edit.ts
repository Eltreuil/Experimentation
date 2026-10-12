// Opérations de modification du modèle (équivalents des outils « Modifier » de
// Revit). Fonctions pures sur un Project, à appeler dans project.transact().
import {
  add,
  bounds,
  cross,
  dot,
  lineIntersect,
  mul,
  norm,
  perp,
  polygonCentroid,
  projectOnSegment,
  rotate,
  samePoint,
  sub,
  v,
  wallDir,
  wallLength,
} from './geometry';
import { isHosted, newId, type Project } from './project';
import type { Element, Id, Vec2, Wall } from './types';

export type Transform = (p: Vec2) => Vec2;

/** Applique une transformation ponctuelle aux points d'un élément. */
export function transformElement(e: Element, f: Transform, mirror = false): void {
  switch (e.kind) {
    case 'wall':
    case 'stair':
    case 'dimension':
    case 'grid':
    case 'section':
    case 'detail':
      e.a = f(e.a);
      e.b = f(e.b);
      break;
    case 'floor':
    case 'room':
    case 'roof':
    case 'shaft':
    case 'ceiling':
    case 'railing':
    case 'region':
      e.points = e.points.map(f);
      if (e.kind === 'room' && e.seed) e.seed = f(e.seed);
      // Une symétrie inverse le sens du contour ; on le rétablit (sauf tracé ouvert).
      if (mirror && e.kind !== 'railing') e.points.reverse();
      break;
    case 'column':
    case 'component':
    case 'text':
    case 'cad':
      e.pos = f(e.pos);
      break;
    case 'door':
    case 'window':
    case 'opening':
      // Les éléments hébergés suivent leur mur.
      break;
  }
}

/** Ajoute à un ensemble d'éléments les portes/fenêtres/ouvertures de leurs murs. */
export function withHosted(p: Project, ids: Iterable<Id>): Set<Id> {
  const set = new Set(ids);
  for (const e of p.elements) if (isHosted(e) && set.has(e.hostId)) set.add(e.id);
  return set;
}

/** Points représentatifs (centre de la sélection pour rotation/symétrie). */
export function elementsCenter(p: Project, ids: Iterable<Id>): Vec2 {
  const pts: Vec2[] = [];
  for (const id of ids) {
    const e = p.get(id);
    if (!e) continue;
    if ('a' in e) pts.push(e.a, e.b);
    else if ('points' in e) pts.push(polygonCentroid(e.points));
    else if ('pos' in e) pts.push(e.pos);
  }
  if (!pts.length) return v(0, 0);
  const b = bounds(pts);
  return v((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2);
}

/** Inverse le sens d'un mur en conservant la position de ses ouvertures. */
export function reverseWall(p: Project, w: Wall): void {
  const L = wallLength(w);
  for (const o of p.hosted(w.id)) {
    o.offset = L - o.offset;
    if (o.kind === 'door') o.flipHand = !o.flipHand;
  }
  const a = w.a;
  w.a = w.b;
  w.b = a;
}

function renumber(p: Project, e: Element): void {
  if (e.kind === 'room') e.number = p.nextRoomNumber();
  else if (e.kind === 'grid') e.label = p.nextGridLabel();
  else if (e.kind === 'section') e.name = nextSectionName(p);
  else if (e.mark && (e.kind === 'column' || e.kind === 'stair' || e.kind === 'door' || e.kind === 'window')) e.mark = p.nextMark(e.kind);
}

export function nextSectionName(p: Project): string {
  const used = new Set(p.ofKind('section').map((s) => s.name));
  for (let i = 1; i < 1000; i++) if (!used.has(`Coupe ${i}`)) return `Coupe ${i}`;
  return 'Coupe';
}

/**
 * Duplique des éléments (et leurs éléments hébergés) en appliquant une
 * transformation. Retourne les identifiants créés.
 */
export function duplicate(p: Project, ids: Iterable<Id>, f: Transform, opts: { mirror?: boolean; levelId?: Id } = {}): Id[] {
  const all = withHosted(p, ids);
  const idMap = new Map<Id, Id>();
  const created: Id[] = [];
  const sources = [...all].map((id) => p.get(id)).filter((e): e is Element => !!e);
  for (const src of sources) {
    if (isHosted(src)) continue;
    const e = structuredClone(src);
    e.id = newId(e.kind.slice(0, 2));
    idMap.set(src.id, e.id);
    if (opts.levelId && 'levelId' in e) e.levelId = opts.levelId;
    // Une copie appartient à la phase courante et n'est pas démolie.
    if (p.activePhase) e.phaseCreated = p.activePhase;
    e.phaseDemolished = null;
    transformElement(e, f, opts.mirror);
    if (e.kind === 'wall') e.attachRoofId = e.attachRoofId ?? null;
    renumber(p, e);
    p.add(e);
    created.push(e.id);
  }
  for (const src of sources) {
    if (!isHosted(src)) continue;
    const host = idMap.get(src.hostId);
    if (!host) continue;
    const e = structuredClone(src);
    e.id = newId(e.kind.slice(0, 2));
    e.hostId = host;
    if (p.activePhase) e.phaseCreated = p.activePhase;
    e.phaseDemolished = null;
    renumber(p, e);
    p.add(e);
    created.push(e.id);
  }
  if (opts.mirror) {
    for (const id of created) {
      const e = p.get(id);
      if (e?.kind === 'wall') reverseWall(p, e);
    }
  }
  return created;
}

/** Extrémités de murs non concernés raccordées à des points donnés. */
export function linkedWallEnds(p: Project, points: Vec2[], exclude: Set<Id>, levelId?: Id): { id: Id; end: 'a' | 'b'; origin: Vec2 }[] {
  const refs: { id: Id; end: 'a' | 'b'; origin: Vec2 }[] = [];
  for (const w of p.ofKind('wall', levelId)) {
    if (exclude.has(w.id)) continue;
    for (const end of ['a', 'b'] as const) {
      if (points.some((q) => samePoint(q, w[end]))) refs.push({ id: w.id, end, origin: { ...w[end] } });
    }
  }
  return refs;
}

/**
 * Extrémités de murs non déplacés appuyées en T sur un mur déplacé : elles
 * suivent la composante perpendiculaire du déplacement pour rester jointes.
 */
export function tJoinedEnds(p: Project, movedIds: Set<Id>): { id: Id; end: 'a' | 'b'; origin: Vec2; normal: Vec2 }[] {
  const out: { id: Id; end: 'a' | 'b'; origin: Vec2; normal: Vec2 }[] = [];
  for (const id of movedIds) {
    const w = p.get<'wall'>(id);
    if (!w || w.kind !== 'wall') continue;
    const L = wallLength(w);
    const n = perp(wallDir(w));
    const tol = p.thickness(w) / 2 + 1e-3;
    for (const o of p.ofKind('wall', w.levelId)) {
      if (movedIds.has(o.id)) continue;
      for (const end of ['a', 'b'] as const) {
        const pr = projectOnSegment(o[end], w.a, w.b);
        const s = pr.t * L;
        if (pr.dist <= tol && s > 1e-3 && s < L - 1e-3 && !samePoint(o[end], w.a) && !samePoint(o[end], w.b)) {
          out.push({ id: o.id, end, origin: { ...o[end] }, normal: n });
        }
      }
    }
  }
  return out;
}

/** Déplace des éléments ; les murs raccordés non sélectionnés s'étirent pour suivre. */
export function moveElements(p: Project, ids: Iterable<Id>, delta: Vec2, stretch = true): void {
  const set = new Set(ids);
  const wallPts: Vec2[] = [];
  for (const id of set) {
    const e = p.get(id);
    if (e?.kind === 'wall') wallPts.push(e.a, e.b);
  }
  const linked = stretch ? linkedWallEnds(p, wallPts, set) : [];
  const tees = stretch ? tJoinedEnds(p, set) : [];
  for (const id of set) {
    const e = p.get(id);
    if (!e || e.pinned) continue;
    if (isHosted(e)) {
      if (set.has(e.hostId)) continue;
      const w = p.get<'wall'>(e.hostId);
      if (w) e.offset += dot(delta, wallDir(w));
      continue;
    }
    transformElement(e, (q) => add(q, delta));
  }
  for (const l of linked) {
    const w = p.get<'wall'>(l.id);
    if (w) w[l.end] = add(l.origin, delta);
  }
  for (const t of tees) {
    const w = p.get<'wall'>(t.id);
    if (w) w[t.end] = add(t.origin, mul(t.normal, dot(delta, t.normal)));
  }
  p.clampOpenings();
}

export function rotateElements(p: Project, ids: Iterable<Id>, center: Vec2, degrees: number): void {
  const a = (degrees * Math.PI) / 180;
  for (const id of ids) {
    const e = p.get(id);
    if (!e || e.pinned) continue;
    transformElement(e, (q) => rotate(q, a, center));
    if (e.kind === 'column' || e.kind === 'component' || e.kind === 'text' || e.kind === 'cad') e.rotation = normDeg(e.rotation + degrees);
  }
}

/** Réflexion d'un point par rapport à la droite (a, b). */
export function reflectPoint(q: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = norm(sub(b, a));
  const rel = sub(q, a);
  const along = mul(d, dot(rel, d));
  return add(a, sub(mul(along, 2), rel));
}

export function mirrorElements(p: Project, ids: Iterable<Id>, a: Vec2, b: Vec2): void {
  const axisDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const list = [...ids];
  for (const id of list) {
    const e = p.get(id);
    if (!e || e.pinned) continue;
    transformElement(e, (q) => reflectPoint(q, a, b), true);
    if (e.kind === 'column' || e.kind === 'component') e.rotation = normDeg(2 * axisDeg - e.rotation + 180);
  }
  for (const id of list) {
    const e = p.get(id);
    if (e?.kind === 'wall') reverseWall(p, e);
  }
}

/** Réseau linéaire : `count` exemplaires au total (original compris), espacés de `delta`. */
export function arrayElements(p: Project, ids: Id[], delta: Vec2, count: number): Id[] {
  const created: Id[] = [];
  for (let i = 1; i < count; i++) created.push(...duplicate(p, ids, (q) => add(q, mul(delta, i))));
  return created;
}

const normDeg = (d: number) => ((Math.round(d * 1e6) / 1e6) % 360 + 360) % 360;

// ---------------------------------------------------------------------------
// Murs

/** Scinde un mur au point le plus proche de `at`. Retourne l'id du second tronçon. */
export function splitWall(p: Project, wallId: Id, at: Vec2): Id | null {
  const w = p.get<'wall'>(wallId);
  if (!w) return null;
  const L = wallLength(w);
  const pr = projectOnSegment(at, w.a, w.b);
  const s = pr.t * L;
  if (s < 0.01 || s > L - 0.01) return null;
  const second: Wall = { ...structuredClone(w), id: newId('w'), a: { ...pr.point }, b: { ...w.b } };
  w.b = { ...pr.point };
  p.add(second);
  for (const o of p.hosted(w.id)) {
    if (o.offset > s) {
      o.hostId = second.id;
      o.offset -= s;
    }
  }
  return second.id;
}

/**
 * Ajuster/prolonger pour former un angle : les deux murs sont coupés ou
 * prolongés jusqu'à l'intersection de leurs axes. Les clics indiquent la
 * partie de chaque mur à conserver.
 */
export function trimToCorner(p: Project, id1: Id, click1: Vec2, id2: Id, click2: Vec2): boolean {
  const w1 = p.get<'wall'>(id1);
  const w2 = p.get<'wall'>(id2);
  if (!w1 || !w2 || id1 === id2) return false;
  const ip = lineIntersect(w1.a, sub(w1.b, w1.a), w2.a, sub(w2.b, w2.a));
  if (!ip) return false;
  setEndToward(p, w1, ip, click1);
  setEndToward(p, w2, ip, click2);
  p.clampOpenings();
  return true;
}

/** Place l'extrémité appropriée d'un mur au point `ip` (en gardant le côté cliqué). */
function setEndToward(p: Project, w: Wall, ip: Vec2, click: Vec2): void {
  const dir = wallDir(w);
  const sIp = dot(sub(ip, w.a), dir);
  const sClick = dot(sub(click, w.a), dir);
  const L = wallLength(w);
  let end: 'a' | 'b';
  if (sIp <= 0) end = 'a';
  else if (sIp >= L) end = 'b';
  else end = sClick > sIp ? 'a' : 'b';
  if (end === 'a') {
    // L'origine change : les ouvertures sont remesurées.
    const shift = sIp;
    for (const o of p.hosted(w.id)) o.offset -= shift;
    w.a = { ...ip };
  } else {
    w.b = { ...ip };
  }
}

/** Prolonge/ajuste un mur jusqu'à une ligne de référence (axe d'un autre mur, quadrillage…). */
export function extendToLine(p: Project, wallId: Id, la: Vec2, lb: Vec2, click: Vec2): boolean {
  const w = p.get<'wall'>(wallId);
  if (!w) return false;
  const ip = lineIntersect(w.a, sub(w.b, w.a), la, sub(lb, la));
  if (!ip) return false;
  setEndToward(p, w, ip, click);
  p.clampOpenings();
  return true;
}

/** Décale un mur (copie ou déplacement) perpendiculairement à son axe. */
export function offsetWall(p: Project, wallId: Id, distance: number, copy: boolean): Id | null {
  const w = p.get<'wall'>(wallId);
  if (!w) return null;
  const d = mul(perp(wallDir(w)), distance);
  if (copy) return duplicate(p, [w.id], (q) => add(q, d))[0] ?? null;
  moveElements(p, [w.id], d, false);
  return w.id;
}

/** Ligne de référence repérée dans le modèle (face ou axe de mur, quadrillage, arête). */
export interface RefLine {
  a: Vec2;
  b: Vec2;
  ownerId: Id;
  /** Indice d'arête pour les éléments à contour. */
  edge?: number;
  label: string;
}

/** Lignes de référence proches d'un point (pour Aligner). */
export function refLinesNear(p: Project, levelId: Id, pt: Vec2, tol: number): RefLine[] {
  const out: (RefLine & { d: number })[] = [];
  const consider = (l: RefLine) => {
    const d = projectOnSegment(pt, l.a, l.b).dist;
    if (d < tol) out.push({ ...l, d });
  };
  for (const w of p.ofKind('wall', levelId)) {
    const o = p.outline(w);
    consider({ a: o.aL, b: o.bL, ownerId: w.id, label: 'Nu du mur' });
    consider({ a: o.aR, b: o.bR, ownerId: w.id, label: 'Nu du mur' });
    consider({ a: w.a, b: w.b, ownerId: w.id, label: 'Axe du mur' });
  }
  for (const g of p.ofKind('grid')) consider({ a: g.a, b: g.b, ownerId: g.id, label: `Quadrillage ${g.label}` });
  for (const e of p.elements) {
    if ((e.kind === 'floor' || e.kind === 'roof' || e.kind === 'room' || e.kind === 'ceiling' || e.kind === 'shaft') && e.levelId === levelId) {
      e.points.forEach((a, i) => consider({ a, b: e.points[(i + 1) % e.points.length], ownerId: e.id, edge: i, label: 'Arête' }));
    }
    if (e.kind === 'column' && e.levelId === levelId) {
      const h = e.width / 2;
      const c = e.pos;
      consider({ a: v(c.x - h, c.y), b: v(c.x + h, c.y), ownerId: e.id, label: 'Axe du poteau' });
      consider({ a: v(c.x, c.y - h), b: v(c.x, c.y + h), ownerId: e.id, label: 'Axe du poteau' });
    }
  }
  return out.sort((x, y) => x.d - y.d);
}

/**
 * Aligner : déplace l'élément cible pour que sa ligne coïncide avec la
 * ligne de référence (les deux lignes doivent être parallèles).
 */
export function alignTo(p: Project, ref: RefLine, target: RefLine): boolean {
  const dr = norm(sub(ref.b, ref.a));
  const dt = norm(sub(target.b, target.a));
  if (Math.abs(cross(dr, dt)) > 0.02) return false;
  const n = perp(dr);
  const delta = mul(n, dot(sub(ref.a, target.a), n));
  if (Math.hypot(delta.x, delta.y) < 1e-9) return true;
  const e = p.get(target.ownerId);
  if (!e) return false;
  if (target.edge !== undefined && 'points' in e) {
    // Seule l'arête visée se déplace (modification d'esquisse).
    const i = target.edge;
    const j = (i + 1) % e.points.length;
    e.points[i] = add(e.points[i], delta);
    e.points[j] = add(e.points[j], delta);
  } else {
    moveElements(p, [e.id], delta);
  }
  return true;
}

/** Attache le haut des murs au toit situé au-dessus d'eux. Retourne le nombre de murs attachés. */
export function attachWallsToRoof(p: Project, wallIds: Iterable<Id>): number {
  let n = 0;
  const roofs = p.ofKind('roof');
  for (const id of wallIds) {
    const w = p.get<'wall'>(id);
    if (!w) continue;
    const base = (p.level(w.levelId)?.elevation ?? 0) + w.baseOffset;
    const mid = mul(add(w.a, w.b), 0.5);
    let best: { id: Id; z: number } | null = null;
    for (const r of roofs) {
      const z = (p.level(r.levelId)?.elevation ?? 0) + r.baseOffset;
      if (z <= base + 0.1) continue;
      if (!pointInPoly(mid, r.points)) continue;
      if (!best || z < best.z) best = { id: r.id, z };
    }
    if (best) {
      w.attachRoofId = best.id;
      n++;
    }
  }
  return n;
}

/**
 * Démolir : marque les éléments (et leurs éléments hébergés) comme démolis
 * dans la phase donnée. Un élément créé dans cette même phase ne peut pas être
 * démoli (il faut le supprimer). Retourne le nombre d'éléments démolis.
 */
export function demolish(p: Project, ids: Iterable<Id>, phaseId: Id): number {
  const target = p.phases.findIndex((ph) => ph.id === phaseId);
  let n = 0;
  for (const id of withHosted(p, ids)) {
    const e = p.get(id);
    if (!e) continue;
    const created = Math.max(0, p.phases.findIndex((ph) => ph.id === (e.phaseCreated ?? p.phases[0].id)));
    if (created >= target) continue;
    e.phaseDemolished = phaseId;
    n++;
  }
  return n;
}

export function detachWalls(p: Project, wallIds: Iterable<Id>): void {
  for (const id of wallIds) {
    const w = p.get<'wall'>(id);
    if (w) w.attachRoofId = null;
  }
}

function pointInPoly(q: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Cotes en chaîne d'un mur : extrémités et jambages des ouvertures, sur une face. */
export function wallChainPoints(p: Project, w: Wall, side: 1 | -1): Vec2[] {
  const o = p.outline(w);
  const dir = wallDir(w);
  const n = perp(dir);
  const h = (p.thickness(w) / 2) * side;
  const L = wallLength(w);
  const ss = new Set<number>([0, L]);
  for (const sp of p.openingSpans(w)) {
    ss.add(Math.max(0, Math.min(L, sp.start)));
    ss.add(Math.max(0, Math.min(L, sp.end)));
  }
  const face0 = side > 0 ? o.aL : o.aR;
  const face1 = side > 0 ? o.bL : o.bR;
  const s0 = dot(sub(face0, w.a), dir);
  const s1 = dot(sub(face1, w.a), dir);
  const list = [...ss].map((s) => (s === 0 ? s0 : s === L ? s1 : s)).sort((x, y) => x - y);
  return list.filter((s, i) => i === 0 || Math.abs(s - list[i - 1]) > 1e-4).map((s) => add(add(w.a, mul(dir, s)), mul(n, h)));
}

