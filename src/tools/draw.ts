import {
  add,
  dist,
  dot,
  lineIntersect,
  mul,
  norm,
  perp,
  polygonArea,
  projectOnSegment,
  sub,
  v,
  wallDir,
  wallLength,
} from '../model/geometry';
import { formatLength, newId, parseLength } from '../model/project';
import { detectRoom } from '../model/rooms';
import type { DetailLine, FilledRegion, Ceiling, Column, Component, Dimension, Door, Grid, Id, Railing, Room, Section, Shaft, Stair, TextNote, Vec2, Wall, WallOpening, Window } from '../model/types';
import { nextSectionName, wallChainPoints } from '../model/edit';
import { promptDialog } from '../ui/dialogs';
import type { PlanView } from '../views/planView';
import type { PointerInfo, Tool } from './tool';

/** Saisie clavier d'une longueur pendant un tracé (ex. « 450 » puis Entrée). */
export class LengthInput {
  buffer = '';
  constructor(private view: PlanView) {}

  key(e: KeyboardEvent): 'changed' | 'enter' | null {
    if (/^[0-9.,]$/.test(e.key) || (this.buffer && /^[mc]$/i.test(e.key))) {
      this.buffer += e.key;
      this.show();
      return 'changed';
    }
    if (e.key === 'Backspace' && this.buffer) {
      this.buffer = this.buffer.slice(0, -1);
      this.show();
      return 'changed';
    }
    if (e.key === 'Enter' && this.buffer) return 'enter';
    return null;
  }

  value(): number | null {
    const v = parseLength(this.buffer, this.view.project.data.units);
    this.buffer = '';
    return v;
  }

  private show(): void {
    this.view.app.status(`Longueur : ${this.buffer} (${this.view.project.data.units}) — Entrée pour valider`);
  }
}

// ---------------------------------------------------------------------------
// Murs

export class WallTool implements Tool {
  readonly hint: string;
  private start: Vec2 | null = null;
  private cursor: Vec2 | null = null;
  private lastWallId: Id | null = null;
  private input: LengthInput;

  constructor(private view: PlanView) {
    this.input = new LengthInput(view);
    this.hint =
      view.app.options.wallShape === 'rect'
        ? 'Mur (rectangle) : cliquez deux coins opposés.'
        : 'Mur : cliquez le point de départ puis les points suivants. Tapez une longueur + Entrée. Échap pour terminer. Maj = orthogonal.';
  }

  anchor(): Vec2 | null {
    return this.view.app.options.wallShape === 'rect' ? null : this.start;
  }

  private thickness(): number {
    return this.view.project.wallType(this.view.app.options.wallTypeId).thickness;
  }

  /** Décalage de l'axe du mur selon la ligne de justification. */
  private axisOffset(a: Vec2, b: Vec2): Vec2 {
    const loc = this.view.app.options.wallLocation;
    if (loc === 'center') return v(0, 0);
    const n = perp(norm(sub(b, a)));
    const t = this.thickness() / 2;
    return mul(n, loc === 'left' ? -t : t);
  }

  private height(): number {
    const lvl = this.view.project.level(this.view.levelId);
    const above = this.view.project.levelAbove(this.view.levelId);
    const def = above && lvl ? above.elevation - lvl.elevation : lvl?.height ?? 3;
    return this.view.app.options.wallHeight ?? def;
  }

  private makeWall(a: Vec2, b: Vec2): Wall {
    return {
      id: newId('w'),
      kind: 'wall',
      levelId: this.view.levelId,
      typeId: this.view.app.options.wallTypeId,
      a,
      b,
      height: this.height(),
      baseOffset: 0,
    };
  }

  private addSegment(a: Vec2, b: Vec2): void {
    if (dist(a, b) < 0.01) return;
    const p = this.view.project;
    const off = this.axisOffset(a, b);
    const wall = this.makeWall(add(a, off), add(b, off));
    p.transact('Mur', () => {
      // Raccorde l'axe décalé au mur précédent de la chaîne.
      const prev = this.lastWallId ? p.get<'wall'>(this.lastWallId) : undefined;
      if (prev && this.view.app.options.wallLocation !== 'center') {
        const ip = lineIntersect(prev.a, sub(prev.b, prev.a), wall.a, sub(wall.b, wall.a));
        if (ip && dist(ip, prev.b) < 2 * this.thickness()) {
          prev.b = ip;
          wall.a = { ...ip };
        }
      }
      p.add(wall);
    });
    this.lastWallId = wall.id;
  }

  onDown(pi: PointerInfo): void {
    const p = pi.point;
    if (!this.start) {
      this.start = p;
      this.lastWallId = null;
      return;
    }
    if (this.view.app.options.wallShape === 'rect') {
      const a = this.start;
      const c = p;
      if (Math.abs(c.x - a.x) > 0.01 && Math.abs(c.y - a.y) > 0.01) {
        const pts = [a, v(c.x, a.y), c, v(a.x, c.y)];
        // Sens trigonométrique pour que « intérieur/extérieur » soit cohérent.
        if (polygonArea(pts) < 0) pts.reverse();
        const proj = this.view.project;
        proj.transact('Murs (rectangle)', () => {
          pts.forEach((q, i) => proj.add(this.makeWall({ ...q }, { ...pts[(i + 1) % 4] })));
        });
      }
      this.start = null;
      return;
    }
    const closes = dist(p, this.start) < 1e-6;
    if (!closes) this.addSegment(this.start, p);
    this.start = this.view.app.options.chain ? p : null;
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
    if (this.start && !this.input.buffer) {
      this.view.app.status(`Longueur : ${formatLength(dist(this.start, p.point), this.view.project.data.units, true)}`);
    }
  }

  onDblClick(): void {
    this.start = null;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.start || !this.cursor || this.view.app.options.wallShape === 'rect') return false;
    const r = this.input.key(e);
    if (r === 'enter') {
      const l = this.input.value();
      const d = norm(sub(this.cursor, this.start));
      if (l && l > 0 && (d.x || d.y)) {
        const end = add(this.start, mul(d, l));
        this.addSegment(this.start, end);
        this.start = this.view.app.options.chain ? end : null;
      }
      return true;
    }
    return r !== null;
  }

  cancel(): boolean {
    if (this.start) {
      this.start = null;
      this.input.buffer = '';
      return true;
    }
    return false;
  }

  draw(): void {
    if (!this.start || !this.cursor) return;
    const view = this.view;
    const t = this.thickness();
    const pts: [Vec2, Vec2][] =
      view.app.options.wallShape === 'rect'
        ? (() => {
            const a = this.start!;
            const c = this.cursor!;
            const q = [a, v(c.x, a.y), c, v(a.x, c.y)];
            if (polygonArea(q) < 0) q.reverse();
            return q.map((p, i) => [p, q[(i + 1) % 4]] as [Vec2, Vec2]);
          })()
        : [[this.start, this.cursor]];
    for (const [a0, b0] of pts) {
      const off = this.axisOffset(a0, b0);
      const a = add(a0, off);
      const b = add(b0, off);
      const n = mul(perp(norm(sub(b, a))), t / 2);
      view.poly([add(a, n), add(b, n), sub(b, n), sub(a, n)], { stroke: view.colors.select, width: 1.5, fill: 'rgba(26,115,232,0.15)' });
      view.drawTempDimension(a0, b0, 22);
    }
  }
}

// ---------------------------------------------------------------------------
// Portes et fenêtres

interface OpeningPreview {
  wall: Wall;
  offset: number;
  facing: boolean;
  valid: boolean;
}

export class OpeningTool implements Tool {
  readonly hint: string;
  private preview: OpeningPreview | null = null;

  constructor(
    private view: PlanView,
    private kind: 'door' | 'window' | 'opening',
  ) {
    const label = { door: 'Porte', window: 'Fenêtre', opening: 'Ouverture' }[kind];
    this.hint = `${label} : survolez un mur et cliquez pour placer. Le côté du curseur détermine l'ouverture.`;
  }

  private width(): number {
    const o = this.view.app.options;
    if (this.kind === 'opening') return o.openingWidth;
    return this.kind === 'door' ? this.view.project.doorType(o.doorTypeId).width : this.view.project.windowType(o.windowTypeId).width;
  }

  onMove(p: PointerInfo): void {
    const proj = this.view.project;
    const tol = this.view.px(12);
    let best: { w: Wall; d: number; t: number } | null = null;
    for (const w of proj.ofKind('wall', this.view.levelId)) {
      const pr = projectOnSegment(p.raw, w.a, w.b);
      const lim = proj.thickness(w) / 2 + tol;
      if (pr.dist < lim && (!best || pr.dist < best.d)) best = { w, d: pr.dist, t: pr.t };
    }
    if (!best) {
      this.preview = null;
      return;
    }
    const w = best.w;
    const L = wallLength(w);
    const width = this.width();
    const inc = this.view.increment();
    let offset = Math.round((best.t * L) / inc) * inc;
    offset = Math.min(Math.max(offset, width / 2), L - width / 2);
    const side = dot(sub(p.raw, w.a), perp(wallDir(w)));
    const spans = proj.openingSpans(w);
    const valid = L >= width && spans.every((s) => offset + width / 2 <= s.start + 1e-6 || offset - width / 2 >= s.end - 1e-6);
    this.preview = { wall: w, offset, facing: side > 0, valid };
    this.view.app.status(
      valid
        ? `Distance depuis l'extrémité : ${formatLength(offset - width / 2, proj.data.units, true)}`
        : 'Emplacement impossible : chevauchement ou mur trop court',
    );
  }

  onDown(): void {
    const pv = this.preview;
    if (!pv || !pv.valid) return;
    const proj = this.view.project;
    const o = this.view.app.options;
    proj.transact({ door: 'Porte', window: 'Fenêtre', opening: 'Ouverture' }[this.kind], () => {
      if (this.kind === 'opening') {
        proj.add<WallOpening>({ id: newId('o'), kind: 'opening', hostId: pv.wall.id, offset: pv.offset, width: o.openingWidth, height: o.openingHeight, sill: o.openingSill });
      } else if (this.kind === 'door') {
        proj.add<Door>({
          id: newId('d'),
          kind: 'door',
          hostId: pv.wall.id,
          typeId: o.doorTypeId,
          offset: pv.offset,
          flipHand: false,
          flipFacing: pv.facing,
          mark: proj.nextMark('door'),
        });
      } else {
        const t = proj.windowType(o.windowTypeId);
        proj.add<Window>({
          id: newId('f'),
          kind: 'window',
          hostId: pv.wall.id,
          typeId: o.windowTypeId,
          offset: pv.offset,
          sill: t.sill,
          mark: proj.nextMark('window'),
        });
      }
    });
    this.preview = { ...pv, valid: false };
  }

  draw(): void {
    const pv = this.preview;
    if (!pv) return;
    const color = pv.valid ? this.view.colors.select : '#d93025';
    const style = { stroke: color, width: 1.5, fill: pv.valid ? 'rgba(26,115,232,0.15)' : 'rgba(217,48,37,0.15)' };
    const o = this.view.app.options;
    if (this.kind === 'opening') {
      this.view.drawOpening({ id: '_p', kind: 'opening', hostId: pv.wall.id, offset: pv.offset, width: o.openingWidth, height: o.openingHeight, sill: 0 }, style);
    } else if (this.kind === 'door') {
      this.view.drawDoor({ id: '_p', kind: 'door', hostId: pv.wall.id, typeId: o.doorTypeId, offset: pv.offset, flipHand: false, flipFacing: pv.facing }, style);
    } else {
      const t = this.view.project.windowType(o.windowTypeId);
      this.view.drawWindow({ id: '_p', kind: 'window', hostId: pv.wall.id, typeId: o.windowTypeId, offset: pv.offset, sill: Math.min(t.sill, 1.0) }, style);
    }
    const w = pv.wall;
    const dir = wallDir(w);
    const half = this.width() / 2;
    const n = perp(dir);
    const off = (this.view.project.thickness(w) / 2) * (pv.facing ? -1 : 1);
    this.view.drawTempDimension(add(w.a, mul(n, off)), add(add(w.a, mul(dir, pv.offset - half)), mul(n, off)), pv.facing ? -22 : 22);
  }
}

// ---------------------------------------------------------------------------
// Contours (sols, toits, pièces dessinées)

export class SketchTool implements Tool {
  readonly hint: string;
  private pts: Vec2[] = [];
  private cursor: Vec2 | null = null;
  private input: LengthInput;

  constructor(
    private view: PlanView,
    private kind: 'floor' | 'roof' | 'room' | 'shaft' | 'ceiling' | 'railing' | 'region',
  ) {
    this.input = new LengthInput(view);
    const label = { floor: 'Sol', roof: 'Toit', room: 'Pièce', shaft: 'Trémie', ceiling: 'Faux-plafond', railing: 'Garde-corps', region: 'Zone remplie' }[kind];
    this.hint =
      kind === 'railing'
        ? 'Garde-corps : cliquez les points du tracé. Double-clic ou Entrée pour terminer.'
        : `${label} : cliquez les sommets du contour. Cliquez le premier point, double-cliquez ou Entrée pour fermer.`;
  }

  private get open(): boolean {
    return this.kind === 'railing';
  }

  anchor(): Vec2 | null {
    return this.pts[this.pts.length - 1] ?? null;
  }

  onDown(p: PointerInfo): void {
    if (!this.open && this.pts.length >= 3 && dist(p.point, this.pts[0]) < this.view.px(8)) {
      this.finish();
      return;
    }
    const last = this.pts[this.pts.length - 1];
    if (!last || dist(last, p.point) > 1e-4) this.pts.push(p.point);
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
  }

  onDblClick(): void {
    this.finish();
  }

  onKey(e: KeyboardEvent): boolean {
    const last = this.anchor();
    if (last && this.cursor) {
      const r = this.input.key(e);
      if (r === 'enter') {
        const l = this.input.value();
        const d = norm(sub(this.cursor, last));
        if (l && (d.x || d.y)) this.pts.push(add(last, mul(d, l)));
        return true;
      }
      if (r) return true;
    }
    if (e.key === 'Enter') {
      this.finish();
      return true;
    }
    return false;
  }

  private finish(): void {
    const pts = this.pts.filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 1e-4);
    this.pts = [];
    const proj = this.view.project;
    const o = this.view.app.options;
    const levelId = this.view.levelId;
    if (this.open) {
      if (pts.length < 2) return;
      proj.transact('Garde-corps', () => proj.add<Railing>({ id: newId('gc'), kind: 'railing', levelId, points: pts, height: o.railingHeight, baseOffset: 0 }));
      return;
    }
    if (pts.length < 3 || Math.abs(polygonArea(pts)) < 1e-4) return;
    if (this.kind === 'region') {
      proj.transact('Zone remplie', () => proj.add<FilledRegion>({ id: newId('zr'), kind: 'region', levelId, points: pts, pattern: o.regionPattern, color: o.regionColor, border: true }));
      return;
    }
    if (this.kind === 'shaft') {
      proj.transact('Trémie', () => proj.add<Shaft>({ id: newId('tr'), kind: 'shaft', levelId, points: pts, height: o.shaftHeight }));
      return;
    }
    if (this.kind === 'ceiling') {
      proj.transact('Faux-plafond', () => proj.add<Ceiling>({ id: newId('fp'), kind: 'ceiling', levelId, points: pts, height: o.ceilingHeight, thickness: 0.02 }));
      return;
    }
    if (this.kind === 'floor') {
      proj.transact('Sol', () => proj.add({ id: newId('s'), kind: 'floor', levelId, points: pts, thickness: o.floorThickness, offset: 0 }));
    } else if (this.kind === 'roof') {
      const lvl = proj.level(levelId);
      proj.transact('Toit', () =>
        proj.add({ id: newId('t'), kind: 'roof', levelId, points: pts, thickness: o.roofThickness, slope: o.roofSlope, shape: o.roofShape, baseOffset: lvl?.height ?? 2.7 }),
      );
    } else {
      proj.transact('Pièce', () => proj.add<Room>({ id: newId('r'), kind: 'room', levelId, points: pts, name: 'Pièce', number: proj.nextRoomNumber() }));
    }
  }

  cancel(): boolean {
    if (this.pts.length) {
      this.pts = [];
      return true;
    }
    return false;
  }

  draw(): void {
    if (!this.pts.length) return;
    const pts = this.cursor ? [...this.pts, this.cursor] : this.pts;
    if (this.open) {
      for (let i = 0; i < pts.length - 1; i++) this.view.line(pts[i], pts[i + 1], this.view.colors.select, 2);
    } else {
      this.view.poly(pts, { stroke: this.view.colors.select, width: 1.5, fill: 'rgba(26,115,232,0.1)' }, [6, 3]);
    }
    for (const p of this.pts) this.view.drawGrip(p);
    const last = this.pts[this.pts.length - 1];
    if (this.cursor) this.view.drawTempDimension(last, this.cursor, 20);
  }
}

/** Pièce : clic dans un espace fermé par des murs (détection automatique) ou contour dessiné. */
export class RoomTool implements Tool {
  readonly hint: string;
  private sketch: SketchTool;
  private hover: Vec2[] | null = null;
  private lastProbe = 0;

  constructor(
    private view: PlanView,
    private kind: 'room' | 'ceiling' = 'room',
  ) {
    this.sketch = new SketchTool(view, kind);
    const label = kind === 'room' ? 'Pièce' : 'Faux-plafond';
    this.hint = view.app.options.roomMode === 'auto' ? `${label} : cliquez à l’intérieur d’un espace fermé par des murs.` : this.sketch.hint;
  }

  private existing(q: Vec2): boolean {
    return this.view.project.ofKind(this.kind, this.view.levelId).some((r) => r.points.length > 2 && pointIn(q, r.points));
  }

  private create(pts: Vec2[], seed?: Vec2): void {
    const proj = this.view.project;
    const levelId = this.view.levelId;
    if (this.kind === 'room') {
      proj.transact('Pièce', () => proj.add<Room>({ id: newId('r'), kind: 'room', levelId, points: pts, name: 'Pièce', number: proj.nextRoomNumber(), seed }));
    } else {
      const o = this.view.app.options;
      proj.transact('Faux-plafond', () => proj.add<Ceiling>({ id: newId('fp'), kind: 'ceiling', levelId, points: pts, height: o.ceilingHeight, thickness: 0.02 }));
    }
  }

  private get auto(): boolean {
    return this.view.app.options.roomMode === 'auto';
  }

  anchor(): Vec2 | null {
    return this.auto ? null : this.sketch.anchor();
  }

  onMove(p: PointerInfo): void {
    if (!this.auto) return this.sketch.onMove(p);
    // Détection limitée en fréquence (calcul raster).
    const now = performance.now();
    if (now - this.lastProbe < 120) return;
    this.lastProbe = now;
    const proj = this.view.project;
    const existing = this.existing(p.raw);
    this.hover = existing ? null : detectRoom(proj, this.view.levelId, p.raw, proj.activePhase ?? undefined);
    this.view.app.status(existing ? 'Un élément existe déjà ici.' : this.hover ? 'Cliquez pour créer l’élément.' : 'Espace non fermé.');
  }

  onDown(p: PointerInfo): void {
    if (!this.auto) return this.sketch.onDown(p);
    if (this.existing(p.raw)) return;
    const pts = detectRoom(this.view.project, this.view.levelId, p.raw, this.view.project.activePhase ?? undefined);
    if (!pts) {
      this.view.app.status('Impossible : l’espace n’est pas fermé par des murs.');
      return;
    }
    this.create(pts, { ...p.raw });
    this.hover = null;
  }

  onDblClick(p: PointerInfo): void {
    if (!this.auto) this.sketch.onDblClick();
    else void p;
  }

  onKey(e: KeyboardEvent): boolean {
    return this.auto ? false : this.sketch.onKey(e);
  }

  cancel(): boolean {
    return this.auto ? false : this.sketch.cancel();
  }

  draw(): void {
    if (!this.auto) return this.sketch.draw();
    if (this.hover) this.view.poly(this.hover, { stroke: this.view.colors.select, width: 2, fill: 'rgba(26,115,232,0.12)' });
  }
}

function pointIn(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Poteaux

export class ColumnTool implements Tool {
  readonly hint = 'Poteau : cliquez pour placer. Barre d’espace : rotation de 90°.';
  private cursor: Vec2 | null = null;
  private rotation = 0;

  constructor(private view: PlanView) {}

  private make(pos: Vec2): Column {
    const o = this.view.app.options;
    const lvl = this.view.project.level(this.view.levelId);
    return {
      id: newId('c'),
      kind: 'column',
      levelId: this.view.levelId,
      pos,
      width: o.columnSize,
      depth: o.columnSize,
      height: lvl?.height ?? 2.7,
      rotation: this.rotation,
      shape: o.columnShape,
    };
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
  }

  onDown(p: PointerInfo): void {
    const proj = this.view.project;
    const c = this.make(p.point);
    c.mark = proj.nextMark('column');
    proj.transact('Poteau', () => proj.add(c));
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === ' ') {
      this.rotation = (this.rotation + 90) % 360;
      return true;
    }
    return false;
  }

  draw(): void {
    if (this.cursor) this.view.drawColumn(this.make(this.cursor), { stroke: this.view.colors.select, fill: 'rgba(26,115,232,0.3)', width: 1.5 });
  }
}

// ---------------------------------------------------------------------------
// Éléments définis par deux points : escalier, cote, quadrillage

abstract class TwoPointTool implements Tool {
  abstract readonly hint: string;
  protected start: Vec2 | null = null;
  protected cursor: Vec2 | null = null;

  constructor(protected view: PlanView) {}

  anchor(): Vec2 | null {
    return this.start;
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
  }

  onDown(p: PointerInfo): void {
    if (!this.start) {
      this.start = p.point;
      return;
    }
    if (dist(this.start, p.point) > 0.05) this.create(this.start, p.point);
    this.start = null;
  }

  cancel(): boolean {
    if (this.start) {
      this.start = null;
      return true;
    }
    return false;
  }

  protected abstract create(a: Vec2, b: Vec2): void;
}

export class StairTool extends TwoPointTool {
  readonly hint = 'Escalier : cliquez le départ (bas) puis l’arrivée (haut) de la volée.';

  private stairHeight(): number {
    const p = this.view.project;
    const lvl = p.level(this.view.levelId);
    const above = p.levelAbove(this.view.levelId);
    return above && lvl ? above.elevation - lvl.elevation : lvl?.height ?? 2.7;
  }

  private make(a: Vec2, b: Vec2): Stair {
    return { id: newId('st'), kind: 'stair', levelId: this.view.levelId, a, b, width: this.view.app.options.stairWidth, height: this.stairHeight(), maxRiser: 0.18 };
  }

  protected create(a: Vec2, b: Vec2): void {
    const p = this.view.project;
    const s = this.make(a, b);
    s.mark = p.nextMark('stair');
    p.transact('Escalier', () => p.add(s));
  }

  draw(): void {
    if (!this.start || !this.cursor) return;
    if (dist(this.start, this.cursor) > 0.05) {
      this.view.drawStair(this.make(this.start, this.cursor), { stroke: this.view.colors.select, width: 1.2 });
      this.view.drawTempDimension(this.start, this.cursor, 40);
    }
  }
}

export class DimensionTool implements Tool {
  readonly hint = 'Cote : cliquez deux points puis placez la ligne de cote.';
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;
  private cursor: Vec2 | null = null;

  constructor(private view: PlanView) {}

  anchor(): Vec2 | null {
    return this.b ? null : this.a;
  }

  onMove(p: PointerInfo): void {
    this.cursor = this.b ? p.raw : p.point;
  }

  private offsetFor(c: Vec2): number {
    const n = perp(norm(sub(this.b!, this.a!)));
    return dot(sub(c, this.a!), n);
  }

  onDown(p: PointerInfo): void {
    if (!this.a) {
      this.a = p.point;
    } else if (!this.b) {
      if (dist(this.a, p.point) > 0.01) this.b = p.point;
    } else {
      const proj = this.view.project;
      const d: Dimension = { id: newId('dim'), kind: 'dimension', levelId: this.view.levelId, a: this.a, b: this.b, offset: this.offsetFor(p.raw) };
      proj.transact('Cote', () => proj.add(d));
      this.a = this.b = null;
    }
  }

  cancel(): boolean {
    if (this.a) {
      this.a = this.b = null;
      return true;
    }
    return false;
  }

  draw(): void {
    if (!this.a || !this.cursor) return;
    if (!this.b) {
      this.view.line(this.a, this.cursor, this.view.colors.select, 1, [4, 3]);
      return;
    }
    this.view.drawDimension({ id: '_d', kind: 'dimension', levelId: this.view.levelId, a: this.a, b: this.b, offset: this.offsetFor(this.cursor) }, this.view.colors.select);
  }
}

export class GridTool extends TwoPointTool {
  readonly hint = 'Quadrillage : cliquez le début puis la fin de l’axe.';

  protected create(a: Vec2, b: Vec2): void {
    const p = this.view.project;
    const g: Grid = { id: newId('g'), kind: 'grid', a, b, label: p.nextGridLabel() };
    p.transact('Quadrillage', () => p.add(g));
  }

  draw(): void {
    if (this.start && this.cursor) this.view.line(this.start, this.cursor, '#3e7cb1', 1.2, [14, 4, 3, 4]);
  }
}

// ---------------------------------------------------------------------------
// Composants (mobilier, sanitaires…)

export class ComponentTool implements Tool {
  readonly hint = 'Composant : cliquez pour placer. Barre d’espace : rotation de 90°.';
  private cursor: Vec2 | null = null;
  private rotation = 0;

  constructor(private view: PlanView) {}

  private make(pos: Vec2): Component {
    const o = this.view.app.options;
    const proj = this.view.project;
    const fam = proj.family(o.componentFamily) ?? proj.families[0];
    const type = fam?.types.find((t) => t.id === o.componentTypeId) ?? fam?.types[0];
    return { id: newId('cp'), kind: 'component', levelId: this.view.levelId, family: fam?.id ?? '', typeId: type?.id, pos, rotation: this.rotation };
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
  }

  onDown(p: PointerInfo): void {
    const proj = this.view.project;
    const c = this.make(p.point);
    proj.transact('Composant', () => proj.add(c));
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === ' ') {
      this.rotation = (this.rotation + 90) % 360;
      return true;
    }
    return false;
  }

  draw(): void {
    if (this.cursor) this.view.drawComponent(this.make(this.cursor), { stroke: this.view.colors.select, width: 1.2, fill: 'rgba(26,115,232,0.12)' });
  }
}

// ---------------------------------------------------------------------------
// Texte

export class TextTool implements Tool {
  readonly hint = 'Texte : cliquez pour placer une note de texte.';
  private busy = false;

  constructor(private view: PlanView) {}

  async onDown(p: PointerInfo): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const text = await promptDialog('Texte', 'Contenu de la note :', '');
    this.busy = false;
    if (!text) return;
    const proj = this.view.project;
    const note: TextNote = { id: newId('tx'), kind: 'text', levelId: this.view.levelId, pos: p.point, text, size: this.view.app.options.textSize, rotation: 0 };
    proj.transact('Texte', () => proj.add(note));
  }
}

// ---------------------------------------------------------------------------
// Coupe

export class SectionTool extends TwoPointTool {
  readonly hint = 'Coupe : cliquez le début puis la fin de la ligne de coupe. La vue regarde à droite du tracé.';

  protected create(a: Vec2, b: Vec2): void {
    const p = this.view.project;
    const sc: Section = { id: newId('cp'), kind: 'section', name: nextSectionName(p), a, b, depth: 20, flip: false };
    p.transact('Coupe', () => p.add(sc));
    this.view.app.status(`${sc.name} créée : ouvrez-la depuis l’arborescence (Coupes).`);
  }

  draw(): void {
    if (this.start && this.cursor && dist(this.start, this.cursor) > 0.05) {
      this.view.drawSection({ id: '_s', kind: 'section', name: '?', a: this.start, b: this.cursor, depth: 20, flip: false }, this.view.colors.select);
    }
  }
}

/** Cotes en chaîne d'un mur (extrémités et ouvertures), placées du côté du curseur. */
export class WallDimensionTool implements Tool {
  readonly hint = 'Cote de mur : survolez un mur et cliquez pour coter ses extrémités et ses ouvertures (côté du curseur).';
  private hover: { wall: Wall; side: 1 | -1 } | null = null;

  constructor(private view: PlanView) {}

  private chain(): { pts: Vec2[]; offset: number } | null {
    if (!this.hover) return null;
    const { wall, side } = this.hover;
    const pts = wallChainPoints(this.view.project, wall, side);
    // Les cotes sont orientées a→b ; leur décalage positif est à gauche.
    return { pts, offset: side * 0.6 };
  }

  onMove(p: PointerInfo): void {
    const proj = this.view.project;
    let best: { w: Wall; d: number } | null = null;
    for (const w of proj.ofKind('wall', this.view.levelId)) {
      const pr = projectOnSegment(p.raw, w.a, w.b);
      if (pr.dist < proj.thickness(w) / 2 + this.view.px(14) && (!best || pr.dist < best.d)) best = { w, d: pr.dist };
    }
    this.hover = best ? { wall: best.w, side: dot(sub(p.raw, best.w.a), perp(wallDir(best.w))) >= 0 ? 1 : -1 } : null;
  }

  onDown(): void {
    const c = this.chain();
    if (!c || c.pts.length < 2) return;
    const proj = this.view.project;
    const levelId = this.view.levelId;
    proj.transact('Cotes du mur', () => {
      for (let i = 0; i < c.pts.length - 1; i++) {
        proj.add<Dimension>({ id: newId('dim'), kind: 'dimension', levelId, a: c.pts[i], b: c.pts[i + 1], offset: c.offset });
      }
    });
  }

  draw(): void {
    const c = this.chain();
    if (!c) return;
    for (let i = 0; i < c.pts.length - 1; i++) {
      this.view.drawDimension({ id: '_d', kind: 'dimension', levelId: this.view.levelId, a: c.pts[i], b: c.pts[i + 1], offset: c.offset }, this.view.colors.select);
    }
  }
}

// ---------------------------------------------------------------------------
// Lignes de détail (dessin 2D en chaîne)

export class DetailLineTool implements Tool {
  readonly hint = 'Ligne de détail : cliquez les points successifs (chaîne). Échap pour terminer. Tapez une longueur + Entrée.';
  private start: Vec2 | null = null;
  private cursor: Vec2 | null = null;
  private input: LengthInput;

  constructor(private view: PlanView) {
    this.input = new LengthInput(view);
  }

  anchor(): Vec2 | null {
    return this.start;
  }

  private add(a: Vec2, b: Vec2): void {
    if (dist(a, b) < 1e-4) return;
    const proj = this.view.project;
    proj.transact('Ligne de détail', () => proj.add<DetailLine>({ id: newId('ld'), kind: 'detail', levelId: this.view.levelId, a, b, style: this.view.app.options.detailStyle }));
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
  }

  onDown(p: PointerInfo): void {
    if (this.start) this.add(this.start, p.point);
    this.start = p.point;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.start || !this.cursor) return false;
    const r = this.input.key(e);
    if (r === 'enter') {
      const l = this.input.value();
      const d = norm(sub(this.cursor, this.start));
      if (l && (d.x || d.y)) {
        const end = add(this.start, mul(d, l));
        this.add(this.start, end);
        this.start = end;
      }
      return true;
    }
    return r !== null;
  }

  onDblClick(): void {
    this.start = null;
  }

  cancel(): boolean {
    if (!this.start) return false;
    this.start = null;
    return true;
  }

  draw(): void {
    if (this.start && this.cursor) {
      this.view.drawDetail({ id: '_d', kind: 'detail', levelId: this.view.levelId, a: this.start, b: this.cursor, style: this.view.app.options.detailStyle }, this.view.colors.select);
      this.view.drawTempDimension(this.start, this.cursor, 16);
    }
  }
}
