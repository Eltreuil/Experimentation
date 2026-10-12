import type { App } from '../app';
import {
  add,
  bounds,
  dist,
  dot,
  lineIntersect,
  mul,
  norm,
  perp,
  pointInPolygon,
  roofFacets,
  roofSlopeEdges,
  polygonArea,
  polygonCentroid,
  projectOnSegment,
  stairSteps,
  sub,
  v,
  wallPieces,
} from '../model/geometry';
import { formatLength, levelOf, type Project } from '../model/project';
import type { Ceiling, Column, Component, Dimension, Door, Element, ElementKind, ElementOf, Floor, Grid, Id, Railing, Room, Roof, Section, Shaft, Stair, TextNote, Vec2, ViewSettings, Wall, WallOpening, Window } from '../model/types';
import { componentFamily } from '../model/components';
import type { PointerInfo, SnapKind, SnapResult, Tool } from '../tools/tool';
import { createTool } from '../tools';
import { RecordingContext, type VShape } from '../io/vector';

/** Hauteur du plan de coupe au-dessus du niveau (convention Revit : 1,20 m). */
export const CUT_HEIGHT = 1.2;

const COLORS = {
  bg: '#ffffff',
  grid: '#f1f3f5',
  gridMajor: '#e3e6ea',
  line: '#1d1d1f',
  thin: '#55595f',
  underlay: '#c7cbd1',
  select: '#1a73e8',
  hover: '#4ea1ff',
  room: 'rgba(120, 170, 255, 0.10)',
  floor: 'rgba(0, 0, 0, 0.035)',
  annotation: '#1d1d1f',
  gridLine: '#3e7cb1',
  snap: '#e8711a',
};

interface DrawStyle {
  stroke?: string;
  fill?: string;
  width?: number;
}

export class PlanView {
  readonly canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cam = { cx: 5, cy: 4, scale: 50 };
  hoverId: Id | null = null;
  /** Calque courant (export DXF/SVG). */
  layer = '0';
  /** Vrai pendant un export vectoriel (tailles de texte non bornées). */
  exporting = false;
  cursor: Vec2 | null = null;
  lastSnap: SnapResult | null = null;
  tool: Tool;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private panning: { x: number; y: number; cx: number; cy: number } | null = null;
  private disposers: (() => void)[] = [];
  private fitted = false;

  constructor(
    readonly app: App,
    readonly container: HTMLElement,
    public levelId: Id,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan-canvas';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.tool = createTool(app.tool, this);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());

    this.disposers.push(app.project.onChange(() => this.requestDraw()));
    this.disposers.push(app.on('selection', () => this.requestDraw()));
    this.disposers.push(app.on('options', () => this.requestDraw()));
    this.disposers.push(
      app.on('tool', () => {
        this.tool = createTool(app.tool, this);
        this.updateCursor();
        this.app.status(this.tool.hint);
        this.requestDraw();
      }),
    );

    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('dblclick', this.onDblClick);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.hoverId = null;
      this.requestDraw();
    });
    this.resize();
    this.updateCursor();
    this.app.status(this.tool.hint);
  }

  get project(): Project {
    return this.app.project;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const d of this.disposers) d();
    this.canvas.remove();
  }

  setLevel(levelId: Id): void {
    this.levelId = levelId;
    this.tool = createTool(this.app.tool, this);
    this.requestDraw();
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    if (!this.fitted && this.width > 10) {
      this.fitted = true;
      this.zoomExtents();
    }
    this.draw();
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.app.tool === 'select' ? 'default' : 'crosshair';
  }

  // -------------------------------------------------------------------------
  // Repères

  w2s(p: Vec2): Vec2 {
    return v((p.x - this.cam.cx) * this.cam.scale + this.width / 2, this.height / 2 - (p.y - this.cam.cy) * this.cam.scale);
  }

  s2w(sx: number, sy: number): Vec2 {
    return v((sx - this.width / 2) / this.cam.scale + this.cam.cx, (this.height / 2 - sy) / this.cam.scale + this.cam.cy);
  }

  /** Tolérance de sélection exprimée en mètres. */
  px(n: number): number {
    return (n * this.paperK) / this.cam.scale;
  }

  /** Facteur appliqué aux tailles exprimées en pixels écran (≈ 0,35 mm par pixel à l'export). */
  get paperK(): number {
    return this.exporting ? 0.35 : 1;
  }

  zoomExtents(): void {
    const pts: Vec2[] = [];
    for (const e of this.project.elements) {
      const lv = levelOf(this.project, e);
      if (lv !== undefined && lv !== this.levelId) continue;
      pts.push(...elementPoints(this.project, e));
    }
    if (pts.length === 0) {
      this.cam = { cx: 5, cy: 4, scale: 50 };
    } else {
      const b = bounds(pts);
      const w = Math.max(1, b.max.x - b.min.x);
      const h = Math.max(1, b.max.y - b.min.y);
      this.cam.cx = (b.min.x + b.max.x) / 2;
      this.cam.cy = (b.min.y + b.max.y) / 2;
      this.cam.scale = Math.min((this.width * 0.85) / w, (this.height * 0.85) / h);
    }
    this.requestDraw();
  }

  zoomBy(f: number, at?: Vec2): void {
    const anchor = at ?? v(this.cam.cx, this.cam.cy);
    const before = this.w2s(anchor);
    this.cam.scale = Math.min(5000, Math.max(2, this.cam.scale * f));
    const after = this.s2w(before.x, before.y);
    this.cam.cx += anchor.x - after.x;
    this.cam.cy += anchor.y - after.y;
    this.requestDraw();
  }

  // -------------------------------------------------------------------------
  // Événements

  private pointerInfo(e: PointerEvent | MouseEvent): PointerInfo {
    const r = this.canvas.getBoundingClientRect();
    const raw = this.s2w(e.clientX - r.left, e.clientY - r.top);
    const snap = this.snap(raw, { from: this.tool.anchor?.() ?? undefined, forceOrtho: e.shiftKey, noSnap: e.altKey });
    return { raw, point: snap.point, snap, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.focus();
    if (e.button === 1 || e.button === 2) {
      // Clic milieu ou droit : panoramique (clic droit simple = annuler l'outil).
      this.panning = { x: e.clientX, y: e.clientY, cx: this.cam.cx, cy: this.cam.cy };
      this.canvas.setPointerCapture(e.pointerId);
      (this.panning as { moved?: boolean }).moved = false;
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.tool.onDown?.(this.pointerInfo(e));
    this.requestDraw();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.panning) {
      const dx = e.clientX - this.panning.x;
      const dy = e.clientY - this.panning.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) (this.panning as { moved?: boolean }).moved = true;
      this.cam.cx = this.panning.cx - dx / this.cam.scale;
      this.cam.cy = this.panning.cy + dy / this.cam.scale;
      this.requestDraw();
      return;
    }
    const info = this.pointerInfo(e);
    this.cursor = info.point;
    this.lastSnap = info.snap;
    if (this.app.tool === 'select') this.hoverId = this.hitTest(info.raw);
    this.tool.onMove?.(info);
    this.app.emit('status');
    this.requestDraw();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.panning) {
      const moved = (this.panning as { moved?: boolean }).moved;
      this.panning = null;
      if (e.button === 2 && !moved) this.escape();
      return;
    }
    if (e.button !== 0) return;
    this.tool.onUp?.(this.pointerInfo(e));
    this.requestDraw();
  };

  private onDblClick = (e: MouseEvent): void => {
    this.tool.onDblClick?.(this.pointerInfo(e));
    this.requestDraw();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const at = this.s2w(e.clientX - r.left, e.clientY - r.top);
    this.zoomBy(Math.exp(-e.deltaY * 0.0015), at);
  };

  /** Échap : annule la saisie en cours, puis revient à l'outil de sélection. */
  escape(): void {
    if (this.tool.cancel?.()) {
      this.requestDraw();
      return;
    }
    if (this.app.tool !== 'select') this.app.setTool('select');
    else this.app.clearSelection();
  }

  handleKey(e: KeyboardEvent): boolean {
    const used = this.tool.onKey?.(e) ?? false;
    if (used) this.requestDraw();
    return used;
  }

  // -------------------------------------------------------------------------
  // Accrochage

  snap(raw: Vec2, opts: { from?: Vec2; forceOrtho?: boolean; noSnap?: boolean } = {}): SnapResult {
    if (opts.noSnap) return { point: raw, kind: 'nearest' };
    const tol = this.px(10);
    const exclude = this.tool.snapExclude;
    let best: SnapResult | null = null;
    let bestD = tol;
    const consider = (p: Vec2, kind: SnapKind) => {
      const d = dist(p, raw);
      if (d < bestD) {
        bestD = d;
        best = { point: { ...p }, kind };
      }
    };
    const levelIds = new Set([this.levelId, this.project.levelBelow(this.levelId)?.id]);
    const walls = this.project.ofKind('wall').filter((w) => levelIds.has(w.levelId) && !exclude?.has(w.id));
    for (const w of walls) {
      consider(w.a, 'end');
      consider(w.b, 'end');
      consider(mul(add(w.a, w.b), 0.5), 'mid');
      if (w.levelId === this.levelId) {
        const o = this.project.outline(w);
        for (const p of [o.aL, o.aR, o.bL, o.bR]) consider(p, 'end');
      }
    }
    for (const e of this.project.elements) {
      if (exclude?.has(e.id)) continue;
      if ((e.kind === 'floor' || e.kind === 'room' || e.kind === 'roof' || e.kind === 'shaft' || e.kind === 'ceiling' || e.kind === 'railing') && levelIds.has(e.levelId)) {
        for (const p of e.points) consider(p, 'vertex');
      } else if ((e.kind === 'component' || e.kind === 'text') && e.levelId === this.levelId) {
        consider(e.pos, 'center');
      } else if (e.kind === 'section') {
        consider(e.a, 'end');
        consider(e.b, 'end');
      } else if (e.kind === 'column' && e.levelId === this.levelId) {
        consider(e.pos, 'center');
      } else if ((e.kind === 'stair' || e.kind === 'dimension') && e.levelId === this.levelId) {
        consider(e.a, 'end');
        consider(e.b, 'end');
      }
    }
    const grids = this.project.ofKind('grid').filter((g) => !exclude?.has(g.id));
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        const gi = grids[i];
        const gj = grids[j];
        const p = lineIntersect(gi.a, sub(gi.b, gi.a), gj.a, sub(gj.b, gj.a));
        if (p) consider(p, 'intersection');
      }
    }
    if (best) return best;

    // Alignement orthogonal depuis le point de départ.
    if (opts.from) {
      const d = sub(raw, opts.from);
      const ang = Math.atan2(d.y, d.x);
      const step = Math.PI / 2;
      const snapped = Math.round(ang / step) * step;
      const nearAxis = Math.abs(ang - snapped) < (4 * Math.PI) / 180;
      if (opts.forceOrtho || nearAxis) {
        const axis = v(Math.cos(snapped), Math.sin(snapped));
        const l = this.roundInc(dot(d, axis));
        return { point: add(opts.from, mul(axis, l)), kind: 'ortho' };
      }
      if (len2(d) > 0) {
        const l = this.roundInc(Math.hypot(d.x, d.y));
        return { point: add(opts.from, mul(norm(d), l)), kind: 'increment' };
      }
    }

    // Point le plus proche sur une face ou un axe de mur / quadrillage.
    let near: SnapResult | null = null;
    let nearD = tol;
    const segs: [Vec2, Vec2][] = [];
    for (const w of walls) {
      if (w.levelId !== this.levelId) continue;
      const o = this.project.outline(w);
      segs.push([o.aL, o.bL], [o.aR, o.bR], [w.a, w.b]);
    }
    for (const g of grids) segs.push([g.a, g.b]);
    for (const [a, b] of segs) {
      const pr = projectOnSegment(raw, a, b);
      if (pr.dist < nearD) {
        nearD = pr.dist;
        near = { point: pr.point, kind: 'nearest' };
      }
    }
    if (near) return near;
    const inc = this.increment();
    return { point: v(Math.round(raw.x / inc) * inc, Math.round(raw.y / inc) * inc), kind: 'increment' };
  }

  increment(): number {
    const s = this.cam.scale;
    return s > 300 ? 0.005 : s > 120 ? 0.01 : s > 40 ? 0.05 : 0.1;
  }

  private roundInc(x: number): number {
    const inc = this.increment();
    return Math.round(x / inc) * inc;
  }

  // -------------------------------------------------------------------------
  // Sélection

  /** Éléments visibles dans cette vue, par ordre de priorité de sélection. */
  visibleElements(): Element[] {
    const order: Element['kind'][] = ['door', 'window', 'opening', 'text', 'column', 'dimension', 'component', 'railing', 'stair', 'section', 'wall', 'grid', 'shaft', 'room', 'ceiling', 'floor', 'roof'];
    const els = this.project.elements.filter((e) => {
      if (!this.shown(e.kind)) return false;
      const lv = levelOf(this.project, e);
      return lv === undefined || lv === this.levelId;
    });
    return els.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }

  hitTest(p: Vec2): Id | null {
    const tol = this.px(5);
    for (const e of this.visibleElements()) {
      if (hitElement(this.project, e, p, tol)) return e.id;
    }
    return null;
  }

  /** Éléments entièrement contenus dans un rectangle (sélection par fenêtre). */
  elementsInRect(a: Vec2, b: Vec2, crossing: boolean): Id[] {
    const min = v(Math.min(a.x, b.x), Math.min(a.y, b.y));
    const max = v(Math.max(a.x, b.x), Math.max(a.y, b.y));
    const inside = (p: Vec2) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
    const ids: Id[] = [];
    for (const e of this.visibleElements()) {
      const pts = elementPoints(this.project, e);
      if (pts.length === 0) continue;
      const ok = crossing ? pts.some(inside) : pts.every(inside);
      if (ok) ids.push(e.id);
    }
    return ids;
  }

  // -------------------------------------------------------------------------
  // Rendu

  requestDraw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  /**
   * Enregistre le plan en vectoriel à l'échelle de la vue : 1 unité = 1 mm
   * sur papier. Retourne aussi la conversion vers les coordonnées réelles (mm).
   */
  recordVector(): { shapes: VShape[]; toWorldMM: (q: Vec2) => Vec2; textScale: number } {
    const rec = new RecordingContext(() => this.layer);
    const saved = { ctx: this.ctx, cam: { ...this.cam }, w: this.width, h: this.height, dpr: this.dpr };
    const k = 1000 / this.viewScale;
    const pts: Vec2[] = [];
    for (const e of this.visibleElements()) pts.push(...elementPoints(this.project, e));
    const b = pts.length ? bounds(pts) : { min: v(0, 0), max: v(10, 10) };
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const W = (b.max.x - b.min.x) * k + 60;
    const H = (b.max.y - b.min.y) * k + 60;
    try {
      this.ctx = rec as unknown as CanvasRenderingContext2D;
      this.cam = { cx, cy, scale: k };
      this.width = W;
      this.height = H;
      this.dpr = 1;
      this.exporting = true;
      this.drawModel();
    } finally {
      this.ctx = saved.ctx;
      this.cam = saved.cam;
      this.width = saved.w;
      this.height = saved.h;
      this.dpr = saved.dpr;
      this.exporting = false;
    }
    const toWorldMM = (q: Vec2): Vec2 => v(((q.x - W / 2) / k + cx) * 1000, ((H / 2 - q.y) / k + cy) * 1000);
    return { shapes: rec.shapes, toWorldMM, textScale: this.viewScale };
  }

  /** Rendu dans un canevas hors écran pour l'export PNG. */
  renderToDataURL(): string {
    this.draw(true);
    const url = this.canvas.toDataURL('image/png');
    this.draw();
    return url;
  }

  draw(clean = false): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!clean) this.drawBackgroundGrid();

    this.drawModel();

    const p = this.project;
    if (!clean) {
      const here = (e: Element) => {
        const lv = levelOf(p, e);
        return lv === undefined || lv === this.levelId;
      };
      if (this.hoverId && !this.app.selection.has(this.hoverId)) {
        const e = p.get(this.hoverId);
        if (e && here(e)) this.drawElement(e, { stroke: COLORS.hover, width: 2 });
      }
      for (const id of this.app.selection) {
        const e = p.get(id);
        if (e && here(e)) this.drawElement(e, { stroke: COLORS.select, width: 2.5, fill: 'rgba(26,115,232,0.12)' });
      }
      this.tool.draw?.(ctx);
      if (this.cursor && this.lastSnap && this.app.tool !== 'select') this.drawSnapMarker(this.lastSnap);
    }
  }

  /** Réglages d'affichage de la vue (catégories masquées, échelle, sous-couche). */
  get settings(): ViewSettings {
    return this.project.data.viewSettings?.[`plan:${this.levelId}`] ?? {};
  }

  shown(kind: ElementKind): boolean {
    return !this.settings.hidden?.includes(kind);
  }

  /** Dénominateur d'échelle de la vue (100 pour 1/100). */
  get viewScale(): number {
    return this.settings.scale ?? 100;
  }

  /** Dessine tout le contenu du modèle (utilisé aussi pour l'export vectoriel). */
  drawModel(): void {
    const p = this.project;
    const lvl = this.levelId;
    const below = p.levelBelow(lvl);
    const layer = <K extends ElementKind>(kind: K, name: string, fn: (e: ElementOf<K>) => void, levelId: Id | undefined = lvl) => {
      if (!this.shown(kind)) return;
      this.layer = name;
      for (const e of p.ofKind(kind, levelId)) fn(e);
    };
    if (below && this.settings.underlay !== false) layer('wall', 'SOUS-COUCHE', (w) => this.drawWallUnderlay(w), below.id);
    layer('floor', 'SOLS', (f) => this.drawFloor(f));
    layer('ceiling', 'PLAFONDS', (c) => this.drawCeiling(c));
    layer('room', 'PIECES', (r) => this.drawRoomFill(r));
    layer('shaft', 'TREMIES', (sh) => this.drawShaft(sh));
    layer('component', 'MOBILIER', (c) => this.drawComponent(c));
    layer('stair', 'ESCALIERS', (st) => this.drawStair(st));
    layer('railing', 'GARDE-CORPS', (r) => this.drawRailing(r));
    layer('wall', 'MURS', (w) => this.drawWall(w));
    layer('door', 'PORTES', (d) => this.drawDoor(d));
    layer('window', 'FENETRES', (w) => this.drawWindow(w));
    layer('opening', 'OUVERTURES', (o) => this.drawOpening(o));
    layer('column', 'POTEAUX', (c) => this.drawColumn(c));
    layer('roof', 'TOITS', (r) => this.drawRoof(r));
    if (this.shown('room')) {
      this.layer = 'ETIQUETTES';
      for (const r of p.ofKind('room', lvl)) this.drawRoomTag(r);
    }
    layer('dimension', 'COTES', (d) => this.drawDimension(d));
    layer('text', 'TEXTES', (t) => this.drawText(t));
    layer('grid', 'QUADRILLAGES', (g) => this.drawGrid(g), undefined);
    layer('section', 'COUPES', (sc) => this.drawSection(sc), undefined);
    this.layer = '0';
  }

  private drawBackgroundGrid(): void {
    const ctx = this.ctx;
    const tl = this.s2w(0, 0);
    const br = this.s2w(this.width, this.height);
    let step = 1;
    while (step * this.cam.scale < 12) step *= 5;
    while (step * this.cam.scale > 120) step /= 5;
    ctx.lineWidth = 1;
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const sx = Math.round(this.w2s(v(x, 0)).x) + 0.5;
      ctx.strokeStyle = Math.abs(Math.round(x / (step * 5)) * step * 5 - x) < 1e-6 ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.height);
      ctx.stroke();
    }
    for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
      const sy = Math.round(this.w2s(v(0, y)).y) + 0.5;
      ctx.strokeStyle = Math.abs(Math.round(y / (step * 5)) * step * 5 - y) < 1e-6 ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(this.width, sy);
      ctx.stroke();
    }
  }

  // Primitives -------------------------------------------------------------

  path(pts: Vec2[], close = true): void {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = this.w2s(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (close) ctx.closePath();
  }

  line(a: Vec2, b: Vec2, color: string, width = 1, dash: number[] = []): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    this.path([a, b], false);
    ctx.stroke();
    ctx.restore();
  }

  poly(pts: Vec2[], style: DrawStyle, dash: number[] = []): void {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    this.path(pts, true);
    if (style.fill) {
      ctx.fillStyle = style.fill;
      ctx.fill();
    }
    if (style.stroke) {
      ctx.setLineDash(dash);
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.width ?? 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  text(p: Vec2, str: string, opts: { size?: number; color?: string; align?: CanvasTextAlign; angle?: number; bold?: boolean; baseline?: CanvasTextBaseline; bg?: string } = {}): void {
    const ctx = this.ctx;
    const s = this.w2s(p);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (opts.angle) ctx.rotate(opts.angle);
    ctx.font = `${opts.bold ? '600 ' : ''}${opts.size ?? 12}px Inter, system-ui, sans-serif`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = opts.baseline ?? 'middle';
    if (opts.bg) {
      const m = ctx.measureText(str);
      const h = (opts.size ?? 12) + 4;
      const x0 = ctx.textAlign === 'center' ? -m.width / 2 : ctx.textAlign === 'right' ? -m.width : 0;
      ctx.fillStyle = opts.bg;
      ctx.fillRect(x0 - 3, -h / 2, m.width + 6, h);
    }
    ctx.fillStyle = opts.color ?? COLORS.annotation;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }

  /**
   * Taille de texte d'annotation en pixels. `base` est la hauteur en mètres à
   * l'échelle 1/100 (0,25 ≈ 2,5 mm sur papier) ; elle suit l'échelle de la vue.
   */
  annotationSize(base = 0.22): number {
    if (this.exporting) return base * (this.viewScale / 100) * this.cam.scale;
    return Math.max(8, Math.min(30, base * (this.viewScale / 100) * this.cam.scale));
  }

  // Éléments -----------------------------------------------------------------

  drawElement(e: Element, style: DrawStyle): void {
    switch (e.kind) {
      case 'wall':
        this.drawWall(e, style);
        break;
      case 'door':
        this.drawDoor(e, style);
        break;
      case 'window':
        this.drawWindow(e, style);
        break;
      case 'floor':
        this.poly(e.points, { stroke: style.stroke, width: style.width, fill: style.fill });
        break;
      case 'room':
        this.poly(e.points, { stroke: style.stroke, width: style.width, fill: style.fill });
        break;
      case 'roof':
        this.drawRoof(e, style);
        break;
      case 'column':
        this.drawColumn(e, style);
        break;
      case 'stair':
        this.drawStair(e, style);
        break;
      case 'dimension':
        this.drawDimension(e, style.stroke);
        break;
      case 'grid':
        this.drawGrid(e, style.stroke);
        break;
      case 'opening':
        this.drawOpening(e, style);
        break;
      case 'shaft':
        this.drawShaft(e, style);
        break;
      case 'ceiling':
        this.poly(e.points, { stroke: style.stroke, width: style.width, fill: style.fill });
        break;
      case 'railing':
        this.drawRailing(e, style);
        break;
      case 'component':
        this.drawComponent(e, style);
        break;
      case 'text':
        this.drawText(e, style.stroke);
        break;
      case 'section':
        this.drawSection(e, style.stroke);
        break;
    }
  }

  drawOpening(o: WallOpening, style?: DrawStyle): void {
    const fr = this.project.openingFrame(o);
    if (!fr) return;
    const t = this.project.thickness(fr.wall);
    const n = perp(fr.dir);
    const color = style?.stroke ?? COLORS.line;
    const j0 = add(fr.center, mul(fr.dir, -o.width / 2));
    const j1 = add(fr.center, mul(fr.dir, o.width / 2));
    const quad = [add(j0, mul(n, t / 2)), add(j1, mul(n, t / 2)), add(j1, mul(n, -t / 2)), add(j0, mul(n, -t / 2))];
    const cut = o.sill <= CUT_HEIGHT && o.sill + o.height > CUT_HEIGHT;
    if (!cut || style) this.poly(quad, { stroke: color, width: style?.width ?? 1, fill: style?.fill }, cut ? [] : [4, 3]);
    if (cut) {
      this.line(quad[0], quad[3], color, style?.width ?? 1);
      this.line(quad[1], quad[2], color, style?.width ?? 1);
      this.line(quad[0], quad[2], color, 0.6, [4, 3]);
    }
  }

  drawShaft(sh: Shaft, style?: DrawStyle): void {
    const color = style?.stroke ?? COLORS.line;
    this.poly(sh.points, { stroke: color, width: style?.width ?? 1.2, fill: style?.fill ?? 'rgba(255,255,255,0.9)' });
    if (sh.points.length === 4) {
      this.line(sh.points[0], sh.points[2], color, 0.8);
      this.line(sh.points[1], sh.points[3], color, 0.8);
    } else if (!style) {
      this.text(polygonCentroid(sh.points), 'TRÉMIE', { size: this.annotationSize(0.16), color });
    }
  }

  drawCeiling(c: Ceiling): void {
    this.poly(c.points, { stroke: '#b0b6bd', width: 0.8 }, [2, 3]);
  }

  drawRailing(r: Railing, style?: DrawStyle): void {
    const color = style?.stroke ?? COLORS.line;
    const w = style?.width ?? 1;
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      if (dist(a, b) < 1e-6) continue;
      const n = mul(perp(norm(sub(b, a))), 0.025);
      this.line(add(a, n), add(b, n), color, w);
      this.line(sub(a, n), sub(b, n), color, w);
    }
  }

  drawComponent(c: Component, style?: DrawStyle): void {
    const fam = componentFamily(c.family);
    const a = (c.rotation * Math.PI) / 180;
    const place = (x: number, y: number): Vec2 => {
      const lx = x * c.width;
      const ly = y * c.depth;
      return v(c.pos.x + lx * Math.cos(a) - ly * Math.sin(a), c.pos.y + lx * Math.sin(a) + ly * Math.cos(a));
    };
    const color = style?.stroke ?? '#3d4248';
    const w = style?.width ?? 0.9;
    for (const pr of fam.plan) {
      if (pr.t === 'line') {
        this.line(place(pr.x0, pr.y0), place(pr.x1, pr.y1), color, w * 0.8);
      } else if (pr.t === 'rect') {
        this.poly([place(pr.x0, pr.y0), place(pr.x1, pr.y0), place(pr.x1, pr.y1), place(pr.x0, pr.y1)], { stroke: color, width: w, fill: style?.fill ?? 'rgba(255,255,255,0.85)' });
      } else {
        const pts: Vec2[] = [];
        for (let i = 0; i < 28; i++) {
          const t = (i / 28) * Math.PI * 2;
          pts.push(place(pr.cx + pr.r * Math.cos(t), pr.cy + pr.r * Math.sin(t) * (c.width / c.depth)));
        }
        this.poly(pts, { stroke: color, width: w, fill: style?.fill ?? 'rgba(255,255,255,0.85)' });
      }
    }
  }

  drawText(t: TextNote, color: string = COLORS.annotation): void {
    // Taille papier (mm) × échelle → hauteur réelle (m).
    const size = this.annotationSize((t.size / 1000) * 100);
    this.text(t.pos, t.text, { size, color, align: 'left', angle: (-t.rotation * Math.PI) / 180, baseline: 'alphabetic' });
  }

  drawSection(sc: Section, color: string = '#1d1d1f'): void {
    if (dist(sc.a, sc.b) < 1e-6) return;
    const dir = norm(sub(sc.b, sc.a));
    const look = sectionLook(sc);
    this.line(sc.a, sc.b, color, 1.4, [16, 4, 3, 4]);
    const size = this.px(9);
    for (const end of [sc.a, sc.b]) {
      // Tête de coupe : cercle + flèche de visée.
      const s = this.w2s(end);
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9 * this.paperK, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
      const tip = add(end, mul(look, size * 2.2));
      this.poly([add(end, mul(perp(look), size)), tip, sub(end, mul(perp(look), size))], { fill: color });
      this.text(end, sc.name.replace(/^Coupe\s*/, '') || sc.name, { size: 10 * this.paperK, bold: true, color });
    }
    void dir;
  }

  private cutSpans(w: Wall) {
    return this.project.openingSpans(w).filter((o) => o.bottom <= CUT_HEIGHT && o.top > CUT_HEIGHT);
  }

  drawWall(w: Wall, style?: DrawStyle): void {
    const p = this.project;
    const t = p.wallType(w.typeId);
    if (t.family === 'curtain') {
      this.drawCurtainWall(w, style);
      return;
    }
    const outline = p.outline(w);
    const pieces = wallPieces(w, outline, t.thickness, this.cutSpans(w)).filter((pc) => pc.bottom <= CUT_HEIGHT && pc.top > CUT_HEIGHT);
    const ctx = this.ctx;
    const stroke = style?.stroke ?? COLORS.line;
    const lw = style?.width ?? (t.function === 'exterior' ? 1.6 : 1.2);
    for (const pc of pieces) {
      const [p0L, p1L, p1R, p0R] = pc.quad;
      this.poly(pc.quad, { fill: style?.fill ?? t.color });
      if (!style) this.hatchWall(pc.quad, t.function === 'exterior');
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      this.path([p0L, p1L], false);
      ctx.stroke();
      this.path([p0R, p1R], false);
      ctx.stroke();
      if (pc.capStart || style) {
        this.path([p0L, p0R], false);
        ctx.stroke();
      }
      if (pc.capEnd || style) {
        this.path([p1L, p1R], false);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (style && pieces.length === 0) this.line(w.a, w.b, stroke, lw);
  }

  private drawCurtainWall(w: Wall, style?: DrawStyle): void {
    const p = this.project;
    const t = p.wallType(w.typeId);
    const o = p.outline(w);
    const color = style?.stroke ?? COLORS.line;
    const lw = style?.width ?? 1;
    const dir = norm(sub(w.b, w.a));
    const n = perp(dir);
    const L = dist(w.a, w.b);
    // Vitrage (trait central) et meneaux.
    this.poly([o.aL, o.bL, o.bR, o.aR], { stroke: style ? color : '#9aa0a6', width: style ? lw : 0.6, fill: style?.fill });
    this.line(w.a, w.b, color, lw);
    const cols = Math.max(1, Math.round(L / Math.max(0.3, t.curtainSpacing ?? 1.5)));
    for (let i = 0; i <= cols; i++) {
      const c = add(w.a, mul(dir, (L * i) / cols));
      const h = t.thickness / 2;
      const m = 0.025;
      this.poly([add(add(c, mul(dir, -m)), mul(n, -h)), add(add(c, mul(dir, m)), mul(n, -h)), add(add(c, mul(dir, m)), mul(n, h)), add(add(c, mul(dir, -m)), mul(n, h))], { fill: color });
    }
  }

  private hatchWall(quad: Vec2[], dense: boolean): void {
    if (this.cam.scale < 25 || this.exporting) return;
    const ctx = this.ctx;
    ctx.save();
    this.path(quad, true);
    ctx.clip();
    const pts = quad.map((q) => this.w2s(q));
    const minX = Math.min(...pts.map((q) => q.x));
    const maxX = Math.max(...pts.map((q) => q.x));
    const minY = Math.min(...pts.map((q) => q.y));
    const maxY = Math.max(...pts.map((q) => q.y));
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 0.6;
    const gap = dense ? 6 : 9;
    ctx.beginPath();
    for (let x = minX - (maxY - minY); x < maxX; x += gap) {
      ctx.moveTo(x, maxY);
      ctx.lineTo(x + (maxY - minY), minY);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawWallUnderlay(w: Wall): void {
    const o = this.project.outline(w);
    this.poly([o.aL, o.bL, o.bR, o.aR], { stroke: COLORS.underlay, width: 1 });
  }

  drawDoor(d: Door, style?: DrawStyle): void {
    const p = this.project;
    const fr = p.openingFrame(d);
    if (!fr) return;
    const t = p.thickness(fr.wall);
    const n = perp(fr.dir);
    const w = fr.width;
    const color = style?.stroke ?? COLORS.line;
    const lw = style?.width ?? 1;
    const side = d.flipFacing ? 1 : -1;
    const leaves: { hinge: number; width: number }[] =
      w >= 1.2
        ? [
            { hinge: -w / 2, width: w / 2 },
            { hinge: w / 2, width: w / 2 },
          ]
        : [{ hinge: d.flipHand ? w / 2 : -w / 2, width: w }];
    // Ébrasement (seuil)
    const j0 = add(fr.center, mul(fr.dir, -w / 2));
    const j1 = add(fr.center, mul(fr.dir, w / 2));
    if (style) {
      this.poly([add(j0, mul(n, t / 2)), add(j1, mul(n, t / 2)), add(j1, mul(n, -t / 2)), add(j0, mul(n, -t / 2))], style);
    }
    this.line(add(j0, mul(n, t / 2)), add(j0, mul(n, -t / 2)), color, lw);
    this.line(add(j1, mul(n, t / 2)), add(j1, mul(n, -t / 2)), color, lw);
    for (const leaf of leaves) {
      const H = add(add(fr.center, mul(fr.dir, leaf.hinge)), mul(n, (side * t) / 2));
      const u1 = mul(n, side * leaf.width);
      const u2 = mul(fr.dir, -Math.sign(leaf.hinge) * leaf.width);
      this.line(H, add(H, u1), color, lw * 1.6);
      const arc: Vec2[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * (Math.PI / 2);
        arc.push(add(H, add(mul(u1, Math.cos(a)), mul(u2, Math.sin(a)))));
      }
      this.ctx.save();
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = lw * 0.8;
      this.path(arc, false);
      this.ctx.stroke();
      this.ctx.restore();
    }
    if (d.mark && !style && this.cam.scale > 30) {
      const tag = add(fr.center, mul(n, side * -(t / 2 + 0.35)));
      this.text(tag, d.mark, { size: this.annotationSize(0.16), color: '#555' });
    }
  }

  drawWindow(win: Window, style?: DrawStyle): void {
    const p = this.project;
    const fr = p.openingFrame(win);
    if (!fr) return;
    const wt = p.windowType(win.typeId);
    const cut = win.sill <= CUT_HEIGHT && win.sill + wt.height > CUT_HEIGHT;
    const t = p.thickness(fr.wall);
    const n = perp(fr.dir);
    const w = fr.width;
    const color = style?.stroke ?? COLORS.line;
    const lw = style?.width ?? 1;
    const j0 = add(fr.center, mul(fr.dir, -w / 2));
    const j1 = add(fr.center, mul(fr.dir, w / 2));
    const quad = [add(j0, mul(n, t / 2)), add(j1, mul(n, t / 2)), add(j1, mul(n, -t / 2)), add(j0, mul(n, -t / 2))];
    if (!cut) {
      // Fenêtre au-dessus du plan de coupe : tracé en pointillés.
      this.poly(quad, { stroke: color, width: lw }, [4, 3]);
      return;
    }
    this.poly(quad, { stroke: color, width: lw, fill: style?.fill ?? '#ffffff' });
    this.line(add(j0, mul(n, 0.02)), add(j1, mul(n, 0.02)), color, lw);
    this.line(add(j0, mul(n, -0.02)), add(j1, mul(n, -0.02)), color, lw);
    if (win.mark && !style && this.cam.scale > 30) {
      this.text(add(fr.center, mul(n, t / 2 + 0.3)), win.mark, { size: this.annotationSize(0.16), color: '#555' });
    }
  }

  private drawFloor(f: Floor): void {
    this.poly(f.points, { fill: COLORS.floor, stroke: '#9aa0a6', width: 0.8 });
  }

  private drawRoomFill(r: Room): void {
    this.poly(r.points, { fill: COLORS.room });
  }

  private drawRoomTag(r: Room): void {
    if (r.points.length < 3) return;
    const c = polygonCentroid(r.points);
    const size = this.annotationSize(0.25);
    const area = Math.abs(polygonArea(r.points));
    this.text(c, r.name, { size, bold: true, baseline: 'bottom' });
    this.text(v(c.x, c.y - this.px(size * 0.15)), `${r.number} · ${area.toFixed(2)} m²`, {
      size: size * 0.8,
      baseline: 'top',
      color: '#444',
    });
  }

  drawRoof(r: Roof, style?: DrawStyle): void {
    const color = style?.stroke ?? '#6b4f3a';
    this.poly(r.points, { stroke: color, width: style?.width ?? 1.2, fill: style?.fill }, [8, 4]);
    if (r.points.length < 3 || style) return;
    const slope = r.shape === 'flat' ? 0 : r.slope;
    // Faîtages et arêtiers : frontières entre pans qui ne sont pas sur le contour.
    const onOutline = (a: Vec2, b: Vec2) =>
      r.points.some((p, i) => {
        const q = r.points[(i + 1) % r.points.length];
        return projectOnSegment(a, p, q).dist < 1e-6 && projectOnSegment(b, p, q).dist < 1e-6;
      });
    for (const f of roofFacets(r.points, r.shape, slope)) {
      for (let i = 0; i < f.points.length; i++) {
        const a = f.points[i];
        const b = f.points[(i + 1) % f.points.length];
        if (dist(a, b) > 1e-4 && !onOutline(a, b)) this.line(a, b, color, 1);
      }
    }
    for (const e of roofSlopeEdges(r.points, r.shape, slope)) {
      const i = r.points.indexOf(e.a);
      const b = r.points[(i + 1) % r.points.length];
      const mid = mul(add(e.a, b), 0.5);
      const tip = add(mid, mul(e.inward, 1.2));
      this.line(mid, tip, color, 1);
      this.arrowHead(mid, tip, color);
      this.text(add(mid, mul(e.inward, 1.6)), `${slope}°`, { size: this.annotationSize(0.16), color, bg: 'rgba(255,255,255,0.8)' });
    }
  }

  private arrowHead(from: Vec2, to: Vec2, color: string): void {
    const d = norm(sub(to, from));
    const n = perp(d);
    const s = this.px(8);
    this.poly([to, add(sub(to, mul(d, s)), mul(n, s * 0.4)), sub(sub(to, mul(d, s)), mul(n, s * 0.4))], { fill: color });
  }

  drawColumn(c: Column, style?: DrawStyle): void {
    const s: DrawStyle = { fill: style?.fill ?? '#4a4a4a', stroke: style?.stroke ?? COLORS.line, width: style?.width ?? 1 };
    if (c.shape === 'round') {
      const ctx = this.ctx;
      const sp = this.w2s(c.pos);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, (c.width / 2) * this.cam.scale, 0, Math.PI * 2);
      ctx.fillStyle = s.fill!;
      ctx.fill();
      ctx.strokeStyle = s.stroke!;
      ctx.lineWidth = s.width!;
      ctx.stroke();
      ctx.restore();
    } else {
      this.poly(columnCorners(c), s);
    }
  }

  drawStair(st: Stair, style?: DrawStyle): void {
    const color = style?.stroke ?? COLORS.line;
    const steps = stairSteps(st.a, st.b, st.width, st.height, st.maxRiser);
    // Coupe du plan : on ne dessine en trait plein que les marches sous le plan de coupe.
    for (const s of steps) {
      const above = s.z1 > CUT_HEIGHT + 0.2;
      this.poly(s.quad, { stroke: above ? '#9aa0a6' : color, width: style?.width ?? 0.8, fill: style?.fill }, above ? [4, 3] : []);
    }
    this.line(st.a, st.b, color, 1);
    this.arrowHead(st.a, st.b, color);
    const cutIdx = steps.findIndex((s) => s.z1 > CUT_HEIGHT + 0.2);
    if (cutIdx > 0) {
      const q = steps[cutIdx].quad;
      const m0 = q[0];
      const m1 = q[3];
      const d = norm(sub(st.b, st.a));
      this.line(add(m0, mul(d, 0.1)), sub(m1, mul(d, 0.1)), color, 1.2);
    }
    if (!style) {
      const n = Math.max(1, steps.length);
      this.text(sub(st.a, mul(norm(sub(st.b, st.a)), 0.3)), `${n} CM`, { size: this.annotationSize(0.14), color: '#555' });
    }
  }

  drawDimension(d: Dimension, color: string = COLORS.annotation): void {
    const dir = norm(sub(d.b, d.a));
    if (dist(d.a, d.b) < 1e-6) return;
    const n = perp(dir);
    const a2 = add(d.a, mul(n, d.offset));
    const b2 = add(d.b, mul(n, d.offset));
    const gap = this.px(3) * Math.sign(d.offset || 1);
    const ext = this.px(6) * Math.sign(d.offset || 1);
    this.line(add(d.a, mul(n, gap)), add(a2, mul(n, ext)), color, 0.8);
    this.line(add(d.b, mul(n, gap)), add(b2, mul(n, ext)), color, 0.8);
    this.line(sub(a2, mul(dir, this.px(8))), add(b2, mul(dir, this.px(8))), color, 0.9);
    const tick = mul(norm(add(dir, n)), this.px(6));
    this.line(sub(a2, tick), add(a2, tick), color, 1.6);
    this.line(sub(b2, tick), add(b2, tick), color, 1.6);
    let angle = -Math.atan2(dir.y, dir.x);
    if (angle > Math.PI / 2 + 1e-6) angle -= Math.PI;
    if (angle < -Math.PI / 2 + 1e-6) angle += Math.PI;
    // Texte placé du côté « lisible » (au-dessus de la ligne de cote à l'écran).
    const up = v(Math.sin(angle), Math.cos(angle));
    const mid = mul(add(a2, b2), 0.5);
    const label = formatLength(dist(d.a, d.b), this.project.data.units);
    this.text(add(mid, mul(up, this.px(8))), label, { size: this.annotationSize(0.2), angle, color });
  }

  drawGrid(g: Grid, color: string = COLORS.gridLine): void {
    this.line(g.a, g.b, color, 1, [14, 4, 3, 4]);
    const r = 11 * this.paperK;
    const dir = norm(sub(g.b, g.a));
    for (const [end, sgn] of [
      [g.a, -1],
      [g.b, 1],
    ] as const) {
      const c = add(end, mul(dir, this.px(r) * sgn));
      const s = this.w2s(c);
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
      this.text(c, g.label, { size: 12 * this.paperK, bold: true, color });
    }
  }

  private drawSnapMarker(s: SnapResult): void {
    if (s.kind === 'increment') return;
    const ctx = this.ctx;
    const p = this.w2s(s.point);
    ctx.save();
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const r = 6;
    switch (s.kind) {
      case 'end':
      case 'vertex':
        ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        break;
      case 'mid':
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y + r);
        ctx.lineTo(p.x - r, p.y + r);
        ctx.closePath();
        break;
      case 'center':
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        break;
      case 'intersection':
        ctx.moveTo(p.x - r, p.y - r);
        ctx.lineTo(p.x + r, p.y + r);
        ctx.moveTo(p.x + r, p.y - r);
        ctx.lineTo(p.x - r, p.y + r);
        break;
      case 'nearest':
        ctx.moveTo(p.x - r, p.y - r);
        ctx.lineTo(p.x + r, p.y + r);
        ctx.lineTo(p.x - r, p.y + r);
        ctx.lineTo(p.x + r, p.y - r);
        break;
      case 'ortho':
        ctx.moveTo(p.x - r, p.y);
        ctx.lineTo(p.x + r, p.y);
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x, p.y + r);
        break;
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Petit carré de poignée. */
  drawGrip(p: Vec2, active = false): void {
    const s = this.w2s(p);
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = active ? COLORS.select : '#fff';
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 1.5;
    ctx.fillRect(s.x - 4.5, s.y - 4.5, 9, 9);
    ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
    ctx.restore();
  }

  /** Cote temporaire affichée pendant le tracé. */
  drawTempDimension(a: Vec2, b: Vec2, offsetPx = 18): void {
    if (dist(a, b) < 1e-4) return;
    const d: Dimension = { id: '_tmp', kind: 'dimension', levelId: this.levelId, a, b, offset: this.px(offsetPx) };
    this.drawDimension(d, COLORS.select);
  }

  get colors() {
    return COLORS;
  }
}

function len2(p: Vec2): number {
  return p.x * p.x + p.y * p.y;
}

export function columnCorners(c: Column): Vec2[] {
  const a = (c.rotation * Math.PI) / 180;
  const ux = v(Math.cos(a), Math.sin(a));
  const uy = perp(ux);
  const hx = mul(ux, c.width / 2);
  const hy = mul(uy, c.depth / 2);
  return [sub(sub(c.pos, hx), hy), sub(add(c.pos, hx), hy), add(add(c.pos, hx), hy), add(sub(c.pos, hx), hy)];
}

/** Points caractéristiques d'un élément (pour cadrage et sélection par fenêtre). */
export function elementPoints(p: Project, e: Element): Vec2[] {
  switch (e.kind) {
    case 'wall':
    case 'stair':
    case 'dimension':
    case 'grid':
      return [e.a, e.b];
    case 'door':
    case 'window': {
      const fr = p.openingFrame(e);
      return fr ? [add(fr.center, mul(fr.dir, -fr.width / 2)), add(fr.center, mul(fr.dir, fr.width / 2))] : [];
    }
    case 'floor':
    case 'room':
    case 'roof':
      return e.points;
    case 'column':
      return columnCorners(e);
    case 'opening': {
      const fr = p.openingFrame(e);
      return fr ? [add(fr.center, mul(fr.dir, -fr.width / 2)), add(fr.center, mul(fr.dir, fr.width / 2))] : [];
    }
    case 'shaft':
    case 'ceiling':
    case 'railing':
      return e.points;
    case 'component':
      return componentCorners(e);
    case 'text':
      return [e.pos];
    case 'section':
      return [e.a, e.b];
  }
}

export function componentCorners(c: Component): Vec2[] {
  const a = (c.rotation * Math.PI) / 180;
  return [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([x, y]) => {
    const lx = x * c.width;
    const ly = y * c.depth;
    return v(c.pos.x + lx * Math.cos(a) - ly * Math.sin(a), c.pos.y + lx * Math.sin(a) + ly * Math.cos(a));
  });
}

/** Direction de visée d'une coupe (à droite de a→b, ou à gauche si inversée). */
export function sectionLook(sc: Section): Vec2 {
  const d = norm(sub(sc.b, sc.a));
  return sc.flip ? perp(d) : mul(perp(d), -1);
}

export function hitElement(p: Project, e: Element, pt: Vec2, tol: number): boolean {
  switch (e.kind) {
    case 'wall': {
      const o = p.outline(e);
      if (pointInPolygon(pt, [o.aL, o.bL, o.bR, o.aR])) return true;
      return projectOnSegment(pt, e.a, e.b).dist < p.thickness(e) / 2 + tol;
    }
    case 'door':
    case 'window': {
      const fr = p.openingFrame(e);
      if (!fr) return false;
      const local = sub(pt, fr.center);
      const along = Math.abs(dot(local, fr.dir));
      const across = Math.abs(dot(local, perp(fr.dir)));
      const reach = e.kind === 'door' ? fr.width : p.thickness(fr.wall) / 2;
      return along < fr.width / 2 + tol && across < reach + tol;
    }
    case 'column':
      if (e.shape === 'round') return dist(pt, e.pos) < e.width / 2 + tol;
      return pointInPolygon(pt, columnCorners(e)) || dist(pt, e.pos) < tol * 2;
    case 'stair': {
      const pr = projectOnSegment(pt, e.a, e.b);
      return pr.dist < e.width / 2 + tol && pr.t > 0 && pr.t < 1;
    }
    case 'dimension': {
      const n = perp(norm(sub(e.b, e.a)));
      const a2 = add(e.a, mul(n, e.offset));
      const b2 = add(e.b, mul(n, e.offset));
      return projectOnSegment(pt, a2, b2).dist < tol * 1.5;
    }
    case 'grid':
      return projectOnSegment(pt, e.a, e.b).dist < tol;
    case 'room':
    case 'floor':
      return pointInPolygon(pt, e.points);
    case 'roof':
      return edgesNear(e.points, pt, tol * 1.5);
    case 'opening': {
      const fr = p.openingFrame(e);
      if (!fr) return false;
      const local = sub(pt, fr.center);
      return Math.abs(dot(local, fr.dir)) < fr.width / 2 + tol && Math.abs(dot(local, perp(fr.dir))) < p.thickness(fr.wall) / 2 + tol;
    }
    case 'shaft':
      return pointInPolygon(pt, e.points) || edgesNear(e.points, pt, tol);
    case 'ceiling':
      return edgesNear(e.points, pt, tol * 1.5);
    case 'railing':
      for (let i = 0; i < e.points.length - 1; i++) if (projectOnSegment(pt, e.points[i], e.points[i + 1]).dist < tol * 1.5) return true;
      return false;
    case 'component':
      return pointInPolygon(pt, componentCorners(e));
    case 'text':
      return dist(pt, e.pos) < tol * 4 || (pt.x > e.pos.x && pt.x < e.pos.x + e.text.length * e.size * 0.06 && Math.abs(pt.y - e.pos.y - e.size * 0.04) < e.size * 0.07);
    case 'section':
      return projectOnSegment(pt, e.a, e.b).dist < tol * 1.5;
  }
}

function edgesNear(pts: Vec2[], p: Vec2, tol: number): boolean {
  for (let i = 0; i < pts.length; i++) {
    if (projectOnSegment(p, pts[i], pts[(i + 1) % pts.length]).dist < tol) return true;
  }
  return false;
}

