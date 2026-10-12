// Outils « Modifier » de Revit : mesurer, aligner, décaler, ajuster/prolonger,
// scinder, déplacer, copier, rotation, symétrie, réseau.
import {
  alignTo,
  demolish,
  arrayElements,
  duplicate,
  elementsCenter,
  extendToLine,
  mirrorElements,
  moveElements,
  offsetWall,
  reflectPoint,
  refLinesNear,
  rotateElements,
  splitWall,
  transformElement,
  trimToCorner,
  type RefLine,
  type Transform,
} from '../model/edit';
import { add, dist, dot, mul, norm, perp, projectOnSegment, rotate, sub, wallDir } from '../model/geometry';
import { formatLength, isHosted } from '../model/project';
import type { Element, Id, Vec2, Wall } from '../model/types';
import type { PlanView } from '../views/planView';
import { LengthInput } from './draw';
import type { PointerInfo, Tool } from './tool';

const SELECT = '#1a73e8';
const REF = '#e8711a';

/** Mur le plus proche du curseur (dans son épaisseur + tolérance). */
function wallAt(view: PlanView, p: Vec2, tolPx = 8): Wall | null {
  let best: { w: Wall; d: number } | null = null;
  for (const w of view.project.ofKind('wall', view.levelId)) {
    const pr = projectOnSegment(p, w.a, w.b);
    if (pr.dist < view.project.thickness(w) / 2 + view.px(tolPx) && (!best || pr.dist < best.d)) best = { w, d: pr.dist };
  }
  return best?.w ?? null;
}

// ---------------------------------------------------------------------------
// Mesurer

export class MeasureTool implements Tool {
  readonly hint = 'Mesurer : cliquez des points successifs. Échap pour recommencer.';
  private pts: Vec2[] = [];
  private cursor: Vec2 | null = null;

  constructor(private view: PlanView) {}

  anchor(): Vec2 | null {
    return this.pts[this.pts.length - 1] ?? null;
  }

  private report(): void {
    const all = this.cursor ? [...this.pts, this.cursor] : this.pts;
    let total = 0;
    for (let i = 0; i < all.length - 1; i++) total += dist(all[i], all[i + 1]);
    const u = this.view.project.data.units;
    const last = all.length >= 2 ? all[all.length - 1] : null;
    const prev = all.length >= 2 ? all[all.length - 2] : null;
    if (!last || !prev) return;
    const seg = dist(prev, last);
    const ang = (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI;
    const dx = Math.abs(last.x - prev.x);
    const dy = Math.abs(last.y - prev.y);
    this.view.app.status(
      `Segment : ${formatLength(seg, u, true)} · Total : ${formatLength(total, u, true)} · ΔX ${formatLength(dx, u)} ΔY ${formatLength(dy, u)} · Angle ${ang.toFixed(1)}°`,
    );
  }

  onDown(p: PointerInfo): void {
    this.pts.push(p.point);
    this.report();
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
    if (this.pts.length) this.report();
  }

  cancel(): boolean {
    if (!this.pts.length) return false;
    this.pts = [];
    return true;
  }

  draw(): void {
    const all = this.cursor ? [...this.pts, this.cursor] : this.pts;
    for (let i = 0; i < all.length - 1; i++) {
      this.view.line(all[i], all[i + 1], REF, 1.5, [6, 3]);
      this.view.drawTempDimension(all[i], all[i + 1], 14);
    }
    for (const q of this.pts) this.view.drawGrip(q);
  }
}

// ---------------------------------------------------------------------------
// Aligner

export class AlignTool implements Tool {
  readonly hint = 'Aligner : cliquez la ligne de référence, puis la ligne de l’élément à aligner.';
  private ref: RefLine | null = null;
  private hover: RefLine | null = null;

  constructor(private view: PlanView) {}

  onMove(p: PointerInfo): void {
    const lines = refLinesNear(this.view.project, this.view.levelId, p.raw, this.view.px(8));
    this.hover = lines.find((l) => !this.ref || l.ownerId !== this.ref.ownerId) ?? null;
    this.view.app.status(this.hover ? `${this.ref ? 'Aligner' : 'Référence'} : ${this.hover.label}` : this.ref ? 'Cliquez la ligne à aligner.' : this.hint);
  }

  onDown(): void {
    if (!this.hover) return;
    if (!this.ref) {
      this.ref = this.hover;
      return;
    }
    const target = this.hover;
    const ref = this.ref;
    const proj = this.view.project;
    const ok = proj.transact('Aligner', () => alignTo(proj, ref, target));
    if (!ok) this.view.app.status('Alignement impossible : les lignes ne sont pas parallèles.');
    // La référence est conservée pour aligner plusieurs éléments à la suite.
    this.ref = { ...ref };
  }

  cancel(): boolean {
    if (!this.ref) return false;
    this.ref = null;
    return true;
  }

  draw(): void {
    if (this.ref) this.view.line(this.ref.a, this.ref.b, REF, 2.5);
    if (this.hover) this.view.line(this.hover.a, this.hover.b, SELECT, 2.5, [6, 3]);
  }
}

// ---------------------------------------------------------------------------
// Décaler

export class OffsetTool implements Tool {
  readonly hint = 'Décaler : survolez un mur ; le décalage se fait du côté du curseur. Cliquez pour valider.';
  private hover: { wall: Wall; side: 1 | -1 } | null = null;

  constructor(private view: PlanView) {}

  onMove(p: PointerInfo): void {
    const w = wallAt(this.view, p.raw, 20);
    this.hover = w ? { wall: w, side: dot(sub(p.raw, w.a), perp(wallDir(w))) >= 0 ? 1 : -1 } : null;
  }

  onDown(): void {
    if (!this.hover) return;
    const { wall, side } = this.hover;
    const o = this.view.app.options;
    const proj = this.view.project;
    proj.transact('Décaler', () => offsetWall(proj, wall.id, o.offsetDistance * side, o.offsetCopy));
  }

  draw(): void {
    if (!this.hover) return;
    const { wall, side } = this.hover;
    const d = mul(perp(wallDir(wall)), this.view.app.options.offsetDistance * side);
    this.view.line(wall.a, wall.b, REF, 2);
    this.view.line(add(wall.a, d), add(wall.b, d), SELECT, 2, [8, 4]);
  }
}

// ---------------------------------------------------------------------------
// Ajuster / prolonger

export class TrimTool implements Tool {
  readonly hint: string;
  private first: { id: Id; click: Vec2 } | null = null;
  private ref: RefLine | null = null;
  private hoverWall: Wall | null = null;
  private hoverLine: RefLine | null = null;

  constructor(
    private view: PlanView,
    private mode: 'corner' | 'single',
  ) {
    this.hint =
      mode === 'corner'
        ? 'Ajuster/prolonger pour former un angle : cliquez la partie à conserver de chaque mur.'
        : 'Ajuster/prolonger un élément : cliquez la limite (référence), puis les murs à ajuster.';
  }

  private get corner(): boolean {
    return this.mode === 'corner';
  }

  onMove(p: PointerInfo): void {
    this.hoverWall = wallAt(this.view, p.raw);
    this.hoverLine = !this.corner && !this.ref ? refLinesNear(this.view.project, this.view.levelId, p.raw, this.view.px(8))[0] ?? null : null;
  }

  onDown(p: PointerInfo): void {
    const proj = this.view.project;
    if (!this.corner) {
      if (!this.ref) {
        this.ref = this.hoverLine;
        return;
      }
      if (!this.hoverWall || this.hoverWall.id === this.ref.ownerId) return;
      const ref = this.ref;
      const wid = this.hoverWall.id;
      if (!proj.transact('Prolonger', () => extendToLine(proj, wid, ref.a, ref.b, p.raw))) this.view.app.status('Les éléments sont parallèles.');
      return;
    }
    if (!this.hoverWall) return;
    if (!this.first) {
      this.first = { id: this.hoverWall.id, click: p.raw };
      return;
    }
    const first = this.first;
    const second = { id: this.hoverWall.id, click: p.raw };
    this.first = null;
    if (!proj.transact('Ajuster/prolonger', () => trimToCorner(proj, first.id, first.click, second.id, second.click))) {
      this.view.app.status('Impossible : murs parallèles ou identiques.');
    }
  }

  cancel(): boolean {
    if (!this.first && !this.ref) return false;
    this.first = null;
    this.ref = null;
    return true;
  }

  draw(): void {
    const proj = this.view.project;
    if (this.first) {
      const w = proj.get<'wall'>(this.first.id);
      if (w) this.view.line(w.a, w.b, REF, 3);
    }
    if (this.ref) this.view.line(this.ref.a, this.ref.b, REF, 2.5);
    if (this.hoverLine) this.view.line(this.hoverLine.a, this.hoverLine.b, SELECT, 2, [6, 3]);
    else if (this.hoverWall) this.view.line(this.hoverWall.a, this.hoverWall.b, SELECT, 2, [6, 3]);
  }
}

// ---------------------------------------------------------------------------
// Scinder

export class SplitTool implements Tool {
  readonly hint = 'Scinder : cliquez sur un mur à l’endroit de la coupure.';
  private at: { wall: Wall; point: Vec2 } | null = null;

  constructor(private view: PlanView) {}

  onMove(p: PointerInfo): void {
    const w = wallAt(this.view, p.raw);
    this.at = w ? { wall: w, point: projectOnSegment(p.point, w.a, w.b).point } : null;
    if (this.at) this.view.app.status(`Distance depuis l’origine : ${formatLength(dist(this.at.wall.a, this.at.point), this.view.project.data.units, true)}`);
  }

  onDown(): void {
    if (!this.at) return;
    const { wall, point } = this.at;
    const proj = this.view.project;
    proj.transact('Scinder', () => splitWall(proj, wall.id, point));
  }

  draw(): void {
    if (!this.at) return;
    const n = mul(perp(wallDir(this.at.wall)), this.view.project.thickness(this.at.wall) / 2 + this.view.px(6));
    this.view.line(add(this.at.point, n), sub(this.at.point, n), REF, 2.5);
  }
}

// ---------------------------------------------------------------------------
// Transformations de la sélection : déplacer, copier, rotation, symétrie, réseau

type Mode = 'move' | 'copy' | 'rotate' | 'mirror' | 'array';

const HINTS: Record<Mode, string> = {
  move: 'Déplacer : cliquez le point de départ, puis la destination (ou tapez une distance + Entrée).',
  copy: 'Copier : cliquez le point de départ, puis la destination (ou tapez une distance + Entrée).',
  rotate: 'Rotation : cliquez la direction de départ puis d’arrivée autour du centre (ou tapez un angle + Entrée). Espace : placer le centre.',
  mirror: 'Symétrie : cliquez deux points de l’axe de symétrie.',
  array: 'Réseau : cliquez le point de départ puis l’espacement entre deux exemplaires.',
};

export class TransformTool implements Tool {
  readonly hint: string;
  private base: Vec2 | null = null;
  private cursor: Vec2 | null = null;
  private center: Vec2;
  private input: LengthInput;

  constructor(
    private view: PlanView,
    private mode: Mode,
  ) {
    this.hint = HINTS[mode];
    this.input = new LengthInput(view);
    this.center = elementsCenter(view.project, this.ids());
    if (!this.ids().length) this.hint = 'Sélectionnez d’abord des éléments (outil Modifier), puis relancez cet outil.';
  }

  get snapExclude(): Set<string> {
    return new Set(this.ids());
  }

  private ids(): Id[] {
    return [...this.view.app.selection].filter((id) => {
      const e = this.view.project.get(id);
      return e && !(isHosted(e) && this.view.app.selection.has(e.hostId));
    });
  }

  anchor(): Vec2 | null {
    if (this.mode === 'rotate') return this.center;
    return this.base;
  }

  /** Transformation courante pour l'aperçu et la validation. */
  private transform(to: Vec2): Transform | null {
    if (this.mode === 'rotate') {
      if (!this.base) return null;
      const a = this.angle(to);
      return (q) => rotate(q, a, this.center);
    }
    if (!this.base) return null;
    if (this.mode === 'mirror') {
      const b = this.base;
      if (dist(b, to) < 1e-6) return null;
      return (q) => reflectPoint(q, b, to);
    }
    const d = sub(to, this.base);
    return (q) => add(q, d);
  }

  private angle(to: Vec2): number {
    const s = this.base!;
    const a0 = Math.atan2(s.y - this.center.y, s.x - this.center.x);
    const a1 = Math.atan2(to.y - this.center.y, to.x - this.center.x);
    let a = a1 - a0;
    // Accrochage aux multiples de 15°.
    const step = Math.PI / 12;
    if (Math.abs(a / step - Math.round(a / step)) < 0.12) a = Math.round(a / step) * step;
    return a;
  }

  onMove(p: PointerInfo): void {
    this.cursor = p.point;
    const u = this.view.project.data.units;
    if (this.base && !this.input.buffer) {
      if (this.mode === 'rotate') this.view.app.status(`Angle : ${((this.angle(p.point) * 180) / Math.PI).toFixed(1)}°`);
      else this.view.app.status(`Distance : ${formatLength(dist(this.base, p.point), u, true)}`);
    }
  }

  onDown(p: PointerInfo): void {
    if (!this.ids().length) return;
    if (!this.base) {
      this.base = p.point;
      return;
    }
    this.apply(p.point);
  }

  private apply(to: Vec2): void {
    const proj = this.view.project;
    const ids = this.ids();
    const o = this.view.app.options;
    const base = this.base!;
    let created: Id[] = [];
    switch (this.mode) {
      case 'move':
        proj.transact('Déplacer', () => moveElements(proj, ids, sub(to, base)));
        break;
      case 'copy': {
        const d = sub(to, base);
        created = proj.transact('Copier', () => duplicate(proj, ids, (q) => add(q, d)));
        break;
      }
      case 'rotate': {
        const deg = (this.angle(to) * 180) / Math.PI;
        proj.transact('Rotation', () => rotateElements(proj, ids, this.center, deg));
        break;
      }
      case 'mirror':
        if (dist(base, to) < 1e-6) return;
        if (o.mirrorCopy) created = proj.transact('Symétrie', () => duplicate(proj, ids, (q) => reflectPoint(q, base, to), { mirror: true }));
        else proj.transact('Symétrie', () => mirrorElements(proj, ids, base, to));
        break;
      case 'array':
        created = proj.transact('Réseau', () => arrayElements(proj, ids, sub(to, base), Math.max(2, o.arrayCount)));
        break;
    }
    if (this.mode === 'copy' && o.multipleCopy) {
      this.base = to;
      return;
    }
    if (created.length && this.mode !== 'array') this.view.app.select(created);
    this.base = null;
    this.view.app.setTool('select');
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === ' ' && this.mode === 'rotate' && this.cursor) {
      this.center = this.cursor;
      this.base = null;
      return true;
    }
    if (!this.base || !this.cursor) return false;
    if (this.mode === 'rotate') {
      if (/^[0-9.,-]$/.test(e.key)) {
        this.input.buffer += e.key;
        this.view.app.status(`Angle : ${this.input.buffer}° — Entrée pour valider`);
        return true;
      }
      if (e.key === 'Enter' && this.input.buffer) {
        const deg = parseFloat(this.input.buffer.replace(',', '.'));
        this.input.buffer = '';
        if (!Number.isNaN(deg)) {
          const proj = this.view.project;
          proj.transact('Rotation', () => rotateElements(proj, this.ids(), this.center, deg));
          this.view.app.setTool('select');
        }
        return true;
      }
      return false;
    }
    const r = this.input.key(e);
    if (r === 'enter') {
      const l = this.input.value();
      const d = norm(sub(this.cursor, this.base));
      if (l && (d.x || d.y)) this.apply(add(this.base, mul(d, l)));
      return true;
    }
    return r !== null;
  }

  cancel(): boolean {
    if (!this.base) return false;
    this.base = null;
    return true;
  }

  draw(): void {
    const view = this.view;
    if (this.mode === 'rotate') {
      view.drawGrip(this.center, true);
      if (this.base) view.line(this.center, this.base, REF, 1.2, [6, 3]);
      if (this.cursor) view.line(this.center, this.cursor, SELECT, 1.2, [6, 3]);
    } else if (this.base && this.cursor) {
      view.line(this.base, this.cursor, this.mode === 'mirror' ? REF : SELECT, 1.4, this.mode === 'mirror' ? [12, 4, 3, 4] : [6, 3]);
      if (this.mode !== 'mirror') view.drawTempDimension(this.base, this.cursor, 16);
    }
    if (!this.cursor) return;
    const f = this.transform(this.cursor);
    if (!f) return;
    const copies = this.mode === 'array' ? Math.max(2, view.app.options.arrayCount) - 1 : 1;
    for (const id of this.ids()) {
      const e = view.project.get(id);
      if (!e || isHosted(e)) continue;
      for (let k = 1; k <= copies; k++) {
        const ghost = structuredClone(e) as Element;
        ghost.id = `_ghost_${id}_${k}`;
        let g: Transform = f;
        if (this.mode === 'array') {
          const d = sub(this.cursor, this.base!);
          g = (q) => add(q, mul(d, k));
        }
        transformElement(ghost, g, this.mode === 'mirror');
        view.drawElement(ghost, { stroke: SELECT, width: 1.5, fill: 'rgba(26,115,232,0.08)' });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Démolir (phases)

export class DemolishTool implements Tool {
  readonly hint = 'Démolir : cliquez les éléments existants à démolir dans la phase de la vue.';
  private hover: Id | null = null;

  constructor(private view: PlanView) {}

  onMove(p: PointerInfo): void {
    this.hover = this.view.hitTest(p.raw);
  }

  onDown(): void {
    if (!this.hover) return;
    const proj = this.view.project;
    const phase = proj.activePhase ?? proj.phases[proj.phases.length - 1].id;
    const id = this.hover;
    const n = proj.transact('Démolir', () => demolish(proj, [id], phase));
    this.view.app.status(n ? `${n} élément(s) démoli(s) dans la phase « ${proj.phases.find((ph) => ph.id === phase)?.name} ».` : 'Cet élément est créé dans la phase de la vue : supprimez-le plutôt que de le démolir.');
  }

  draw(): void {
    const e = this.hover ? this.view.project.get(this.hover) : undefined;
    if (e) this.view.drawElement(e, { stroke: '#c79a00', width: 2.5, fill: 'rgba(242,194,0,0.25)' });
  }
}
