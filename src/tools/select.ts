import { add, dot, mul, perp, samePoint, sub, wallDir, wallLength } from '../model/geometry';
import { linkedWallEnds, tJoinedEnds } from '../model/edit';
import { isHosted } from '../model/project';
import type { Element, Id, Vec2 } from '../model/types';
import type { PlanView } from '../views/planView';
import type { PointerInfo, Tool } from './tool';

/** Référence vers un point modifiable par poignée. */
interface GripRef {
  id: Id;
  /** 'a' | 'b' | indice de sommet | 'offset' (cote) */
  key: 'a' | 'b' | number;
  point: Vec2;
}

type DragState =
  | { mode: 'box'; start: Vec2; current: Vec2; screenStart: Vec2 }
  | { mode: 'move'; start: Vec2; before: string; originals: Map<Id, Element>; moved: boolean; stretch: StretchRef[]; tees: ReturnType<typeof tJoinedEnds> }
  | { mode: 'grip'; grip: GripRef; before: string; original: Element; linked: StretchRef[] };

/** Extrémité d'un mur raccordé qui doit suivre un déplacement. */
interface StretchRef {
  id: Id;
  end: 'a' | 'b';
  origin: Vec2;
}

export class SelectTool implements Tool {
  readonly hint = 'Sélection : cliquez un élément (Maj = ajouter), glissez pour une sélection par fenêtre ou pour déplacer.';
  private drag: DragState | null = null;
  snapExclude = new Set<string>();

  constructor(private view: PlanView) {}

  private get app() {
    return this.view.app;
  }
  private get project() {
    return this.view.project;
  }

  anchor(): Vec2 | null {
    if (this.drag?.mode === 'move') return this.drag.start;
    return null;
  }

  grips(): GripRef[] {
    if (this.app.selection.size !== 1) return [];
    const id = [...this.app.selection][0];
    const e = this.project.get(id);
    if (!e) return [];
    switch (e.kind) {
      case 'wall':
      case 'stair':
      case 'dimension':
      case 'grid':
      case 'section':
      case 'detail':
        return [
          { id, key: 'a', point: e.a },
          { id, key: 'b', point: e.b },
        ];
      case 'floor':
      case 'room':
      case 'roof':
      case 'shaft':
      case 'ceiling':
      case 'railing':
      case 'region':
        return e.points.map((p, i) => ({ id, key: i, point: p }));
      default:
        return [];
    }
  }

  private gripAt(p: Vec2): GripRef | null {
    const tol = this.view.px(7);
    for (const g of this.grips()) {
      if (Math.abs(g.point.x - p.x) < tol && Math.abs(g.point.y - p.y) < tol) return g;
    }
    return null;
  }

  /** Extrémités des murs non sélectionnés raccordés aux murs déplacés. */
  private linkedEnds(points: Vec2[], exclude: Set<Id>, levelId: Id): StretchRef[] {
    const refs: StretchRef[] = [];
    for (const w of this.project.ofKind('wall', levelId)) {
      if (exclude.has(w.id)) continue;
      for (const end of ['a', 'b'] as const) {
        if (points.some((p) => samePoint(p, w[end]))) refs.push({ id: w.id, end, origin: { ...w[end] } });
      }
    }
    return refs;
  }

  private setWallLength(id: Id, length: number): void {
    const proj = this.project;
    proj.transact('Longueur du mur', () => {
      const w = proj.get<'wall'>(id);
      if (!w) return;
      const nb = add(w.a, mul(wallDir(w), length));
      // Les murs raccordés à l'extrémité déplacée suivent.
      for (const l of linkedWallEnds(proj, [w.b], new Set([id]), w.levelId)) {
        const o = proj.get<'wall'>(l.id);
        if (o) o[l.end] = { ...nb };
      }
      w.b = nb;
      proj.clampOpenings();
    });
  }

  private setOpening(id: Id, offset: number): void {
    const proj = this.project;
    proj.transact('Position de l’ouverture', () => {
      const o = proj.get(id);
      if (o && isHosted(o)) o.offset = offset;
      proj.clampOpenings();
    });
  }

  onDown(p: PointerInfo): void {
    const dim = this.view.editableDimAt(p.raw);
    if (dim) {
      this.view.editValue(dim.pos, dim.value, dim.apply);
      return;
    }
    const grip = this.gripAt(p.raw);
    if (grip && this.project.get(grip.id)?.pinned) {
      this.app.status('Élément épinglé : désépinglez-le pour le modifier.');
      return;
    }
    if (grip) {
      const original = structuredClone(this.project.get(grip.id)!);
      const linked =
        original.kind === 'wall' && typeof grip.key === 'string'
          ? this.linkedEnds([grip.point], new Set([grip.id]), original.levelId)
          : [];
      this.snapExclude = new Set([grip.id, ...linked.map((l) => l.id)]);
      this.drag = { mode: 'grip', grip, before: this.project.snapshot(), original, linked };
      return;
    }
    const hit = this.view.hitTest(p.raw);
    if (hit) {
      if (p.shift || p.ctrl) {
        this.app.select([hit], true);
        return;
      }
      if (!this.app.selection.has(hit)) this.app.select([hit]);
      const originals = new Map<Id, Element>();
      for (const id of this.app.selection) {
        const e = this.project.get(id);
        if (e && !e.pinned) originals.set(id, structuredClone(e));
      }
      if (!originals.size) {
        this.app.status('Élément épinglé : désépinglez-le (PN/UP ou Propriétés) pour le déplacer.');
        return;
      }
      const movedWallPts: Vec2[] = [];
      for (const e of originals.values()) if (e.kind === 'wall') movedWallPts.push(e.a, e.b);
      const stretch = this.linkedEnds(movedWallPts, new Set(originals.keys()), this.view.levelId);
      const tees = tJoinedEnds(this.project, new Set(originals.keys()));
      this.snapExclude = new Set([...originals.keys(), ...stretch.map((s) => s.id), ...tees.map((t) => t.id)]);
      const start = this.view.snap(p.raw, {}).point;
      this.drag = { mode: 'move', start, before: this.project.snapshot(), originals, moved: false, stretch, tees };
      return;
    }
    this.drag = { mode: 'box', start: p.raw, current: p.raw, screenStart: this.view.w2s(p.raw) };
    if (!p.shift && !p.ctrl) this.app.clearSelection();
  }

  onMove(p: PointerInfo): void {
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'box') {
      d.current = p.raw;
      return;
    }
    if (d.mode === 'grip') {
      this.applyGrip(d, p.point);
      this.project.touch();
      this.app.status(`Déplacement de poignée`);
      return;
    }
    const delta = sub(p.point, d.start);
    const screenDist = Math.hypot(delta.x, delta.y) * this.view.cam.scale;
    if (!d.moved && screenDist < 4) return;
    d.moved = true;
    for (const [id, orig] of d.originals) {
      const e = this.project.data.elements[id];
      if (!e) continue;
      applyMove(e, orig, delta, this.app.selection, (hid) => {
        const w = this.project.get<'wall'>(hid);
        return w ? wallDir(w) : null;
      });
    }
    for (const s of d.stretch) {
      const w = this.project.get<'wall'>(s.id);
      if (w) w[s.end] = add(s.origin, delta);
    }
    for (const t of d.tees) {
      const w = this.project.get<'wall'>(t.id);
      if (w) w[t.end] = add(t.origin, mul(t.normal, dot(delta, t.normal)));
    }
    this.project.clampOpenings();
    this.project.touch();
  }

  private applyGrip(d: Extract<DragState, { mode: 'grip' }>, pt: Vec2): void {
    const e = this.project.data.elements[d.grip.id];
    if (!e) return;
    const key = d.grip.key;
    if (typeof key === 'number') {
      if ('points' in e) e.points[key] = { ...pt };
    } else if ('a' in e) {
      e[key] = { ...pt };
      for (const l of d.linked) {
        const w = this.project.get<'wall'>(l.id);
        if (w) w[l.end] = { ...pt };
      }
    }
    this.project.clampOpenings();
  }

  onUp(p: PointerInfo): void {
    const d = this.drag;
    this.drag = null;
    this.snapExclude = new Set();
    if (!d) return;
    if (d.mode === 'box') {
      const s0 = d.screenStart;
      const s1 = this.view.w2s(p.raw);
      if (Math.abs(s1.x - s0.x) < 4 && Math.abs(s1.y - s0.y) < 4) return;
      // Gauche → droite : fenêtre (contenu entièrement) ; droite → gauche : capture.
      const crossing = s1.x < s0.x;
      this.app.select(this.view.elementsInRect(d.start, p.raw, crossing), p.shift || p.ctrl);
      return;
    }
    if (d.mode === 'grip') {
      this.project.commit('Modifier', d.before);
      return;
    }
    if (d.moved) this.project.commit('Déplacer', d.before);
  }

  cancel(): boolean {
    const d = this.drag;
    if (!d) return false;
    if (d.mode !== 'box') this.project.revert(d.before);
    this.drag = null;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const d = this.drag;
    if (d?.mode === 'box') {
      const a = this.view.w2s(d.start);
      const b = this.view.w2s(d.current);
      const crossing = b.x < a.x;
      ctx.save();
      ctx.strokeStyle = '#1a73e8';
      ctx.fillStyle = crossing ? 'rgba(52,168,83,0.08)' : 'rgba(26,115,232,0.08)';
      ctx.setLineDash(crossing ? [5, 4] : []);
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }
    for (const g of this.grips()) this.view.drawGrip(g.point, d?.mode === 'grip' && d.grip.key === g.key);
    // Cotes temporaires modifiables (comme dans Revit) pour l'élément sélectionné.
    if (this.app.selection.size === 1 && !d) {
      const e = this.project.get([...this.app.selection][0]);
      if (e?.kind === 'wall') {
        this.view.drawTempDimension(e.a, e.b, 28, (m) => this.setWallLength(e.id, m));
      } else if (e && isHosted(e)) {
        const w = this.project.get<'wall'>(e.hostId);
        if (w) {
          const dir = wallDir(w);
          const width = this.project.openingSize(e).width;
          const L = wallLength(w);
          const start = e.offset - width / 2;
          const n = mul(perp(dir), this.project.thickness(w) / 2);
          const at = (s: number) => add(add(w.a, mul(dir, s)), n);
          // Distances aux extrémités du mur, de part et d'autre de l'ouverture.
          this.view.drawTempDimension(at(0), at(start), 26, (m) => this.setOpening(e.id, m + width / 2));
          this.view.drawTempDimension(at(start + width), at(L), 26, (m) => this.setOpening(e.id, L - m - width / 2));
        }
      }
    }
  }
}

function applyMove(e: Element, orig: Element, delta: Vec2, selection: Set<Id>, hostDir: (id: Id) => Vec2 | null): void {
  switch (e.kind) {
    case 'wall':
    case 'stair':
    case 'dimension':
    case 'grid':
    case 'section':
    case 'detail': {
      const o = orig as typeof e;
      e.a = add(o.a, delta);
      e.b = add(o.b, delta);
      break;
    }
    case 'floor':
    case 'room':
    case 'roof':
    case 'shaft':
    case 'ceiling':
    case 'railing':
    case 'region': {
      const o = orig as typeof e;
      e.points = o.points.map((p) => add(p, delta));
      if (e.kind === 'room' && o.kind === 'room' && o.seed) e.seed = add(o.seed, delta);
      break;
    }
    case 'column':
    case 'component':
    case 'text':
    case 'cad':
      e.pos = add((orig as typeof e).pos, delta);
      break;
    case 'door':
    case 'window':
    case 'opening': {
      // Une ouverture suit son mur hôte ; déplacée seule, elle coulisse le long du mur.
      if (selection.has(e.hostId)) break;
      const dir = hostDir(e.hostId);
      if (dir) e.offset = (orig as typeof e).offset + dot(delta, dir);
      break;
    }
  }
}
