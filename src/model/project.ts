import { wallDir, wallLength, wallOutline, wallTypeThickness, add, mul, type OpeningSpan, type WallOutline } from './geometry';
import { evaluateFamily, type FamilyResult } from './family';
import { defaultFamilies } from './familyLibrary';
import type {
  Component,
  FamilyDef,
  Hosted,
  DoorType,
  Element,
  ElementKind,
  ElementOf,
  Id,
  Level,
  ProjectData,
  Units,
  Vec2,
  Wall,
  WallType,
  WindowType,
} from './types';

let idCounter = 0;
export function newId(prefix = 'e'): Id {
  idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const MAX_HISTORY = 200;

interface HistoryEntry {
  label: string;
  snapshot: string;
}

/**
 * Conteneur du projet : données, historique annuler/rétablir et notifications.
 * Toute modification passe par transact() pour être annulable.
 */
export class Project {
  data: ProjectData;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private outlineCache: Map<Id, WallOutline> | null = null;
  private familyCache = new Map<string, FamilyResult>();
  dirty = false;

  constructor(data: ProjectData) {
    this.data = data;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    this.outlineCache = null;
    this.familyCache.clear();
    for (const fn of this.listeners) fn();
  }

  load(data: ProjectData): void {
    this.data = normalize(data);
    this.syncConstraints();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit();
  }

  /** Exécute une modification annulable. */
  transact<T>(label: string, fn: (d: ProjectData) => T): T {
    const snapshot = JSON.stringify(this.data);
    const result = fn(this.data);
    this.syncConstraints();
    this.pushHistory(label, snapshot);
    this.emit();
    return result;
  }

  /** Pour les modifications interactives (glisser) : capture l'état initial. */
  snapshot(): string {
    return JSON.stringify(this.data);
  }

  /** Valide une modification interactive commencée avec snapshot(). */
  commit(label: string, before: string): void {
    this.syncConstraints();
    if (before === JSON.stringify(this.data)) return;
    this.pushHistory(label, before);
    this.emit();
  }

  /** Annule une modification interactive. */
  revert(before: string): void {
    this.data = JSON.parse(before);
    this.emit();
  }

  /** Notifie un changement temporaire (aperçu pendant un glisser), sans historique. */
  touch(): void {
    this.emit();
  }

  private pushHistory(label: string, snapshot: string): void {
    this.undoStack.push({ label, snapshot });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  undo(): void {
    const e = this.undoStack.pop();
    if (!e) return;
    this.redoStack.push({ label: e.label, snapshot: JSON.stringify(this.data) });
    this.data = JSON.parse(e.snapshot);
    this.dirty = true;
    this.emit();
  }

  redo(): void {
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push({ label: e.label, snapshot: JSON.stringify(this.data) });
    this.data = JSON.parse(e.snapshot);
    this.dirty = true;
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Accès

  get elements(): Element[] {
    return Object.values(this.data.elements);
  }

  get<K extends ElementKind = ElementKind>(id: Id): ElementOf<K> | undefined {
    return this.data.elements[id] as ElementOf<K> | undefined;
  }

  ofKind<K extends ElementKind>(kind: K, levelId?: Id): ElementOf<K>[] {
    return this.elements.filter(
      (e): e is ElementOf<K> => e.kind === kind && (levelId === undefined || levelOf(this, e) === levelId),
    );
  }

  level(id: Id): Level | undefined {
    return this.data.levels.find((l) => l.id === id);
  }

  sortedLevels(): Level[] {
    return [...this.data.levels].sort((a, b) => a.elevation - b.elevation);
  }

  levelBelow(id: Id): Level | undefined {
    const ls = this.sortedLevels();
    const i = ls.findIndex((l) => l.id === id);
    return i > 0 ? ls[i - 1] : undefined;
  }

  levelAbove(id: Id): Level | undefined {
    const ls = this.sortedLevels();
    const i = ls.findIndex((l) => l.id === id);
    return i >= 0 && i < ls.length - 1 ? ls[i + 1] : undefined;
  }

  wallType(id: Id): WallType {
    return this.data.wallTypes.find((t) => t.id === id) ?? this.data.wallTypes[0];
  }
  doorType(id: Id): DoorType {
    return this.data.doorTypes.find((t) => t.id === id) ?? this.data.doorTypes[0];
  }
  windowType(id: Id): WindowType {
    return this.data.windowTypes.find((t) => t.id === id) ?? this.data.windowTypes[0];
  }

  get families(): FamilyDef[] {
    return this.data.families ?? (this.data.families = []);
  }

  family(id: Id): FamilyDef | undefined {
    return this.families.find((f) => f.id === id);
  }

  /** Géométrie évaluée d'une occurrence de famille (mise en cache jusqu'à la prochaine modification). */
  componentGeometry(c: Component): FamilyResult {
    const fam = this.family(c.family);
    if (!fam) return MISSING_FAMILY;
    const key = `${c.family}|${c.typeId ?? ''}|${c.params ? JSON.stringify(c.params) : ''}`;
    let r = this.familyCache.get(key);
    if (!r) {
      r = evaluateFamily(fam, c.typeId, c.params);
      this.familyCache.set(key, r);
    }
    return r;
  }

  /** Nombre d'occurrences d'une famille (ou d'un de ses types). */
  familyUsage(familyId: Id, typeId?: Id): number {
    return this.ofKind('component').filter((c) => c.family === familyId && (typeId === undefined || (c.typeId ?? this.family(familyId)?.types[0]?.id) === typeId)).length;
  }

  thickness(w: Wall): number {
    return this.wallType(w.typeId).thickness;
  }

  outline(w: Wall): WallOutline {
    // Les éléments temporaires (aperçus, id commençant par « _ ») ne sont pas mis en cache.
    if (w.id.startsWith('_')) return wallOutline(w, this.ofKind('wall', w.levelId), wallTypeThickness(this.data.wallTypes));
    if (!this.outlineCache) this.outlineCache = new Map();
    let o = this.outlineCache.get(w.id);
    if (!o) {
      o = wallOutline(w, this.ofKind('wall', w.levelId), wallTypeThickness(this.data.wallTypes));
      this.outlineCache.set(w.id, o);
    }
    return o;
  }

  invalidate(): void {
    this.outlineCache = null;
  }

  hosted(wallId: Id): Hosted[] {
    return this.elements.filter((e): e is Hosted => isHosted(e) && e.hostId === wallId);
  }

  /** Largeur, hauteur et allège d'un élément hébergé. */
  openingSize(o: Hosted): { width: number; height: number; bottom: number } {
    if (o.kind === 'door') {
      const t = this.doorType(o.typeId);
      return { width: t.width, height: t.height, bottom: 0 };
    }
    if (o.kind === 'window') {
      const t = this.windowType(o.typeId);
      return { width: t.width, height: t.height, bottom: o.sill };
    }
    return { width: o.width, height: o.height, bottom: o.sill };
  }

  openingSpans(w: Wall): OpeningSpan[] {
    return this.hosted(w.id).map((o) => {
      const { width, height, bottom } = this.openingSize(o);
      return { id: o.id, start: o.offset - width / 2, end: o.offset + width / 2, bottom, top: bottom + height };
    });
  }

  /** Position du centre et direction d'une ouverture en plan. */
  openingFrame(o: Hosted): { center: Vec2; dir: Vec2; width: number; wall: Wall } | null {
    const w = this.get<'wall'>(o.hostId);
    if (!w) return null;
    const dir = wallDir(w);
    return { center: add(w.a, mul(dir, o.offset)), dir, width: this.openingSize(o).width, wall: w };
  }

  /**
   * Met à jour les hauteurs pilotées par des contraintes (murs contraints à un
   * niveau supérieur). Appelé après chaque modification.
   */
  syncConstraints(): void {
    for (const e of this.elements) {
      if (e.kind !== 'wall' || !e.topLevelId) continue;
      const top = this.level(e.topLevelId);
      const base = this.level(e.levelId);
      if (!top || !base) {
        e.topLevelId = null;
        continue;
      }
      e.height = Math.max(0.1, top.elevation + (e.topOffset ?? 0) - (base.elevation + e.baseOffset));
    }
    for (const e of this.elements) {
      if (e.kind === 'wall' && e.attachRoofId && !this.data.elements[e.attachRoofId]) e.attachRoofId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Mutations (à appeler dans transact)

  add<T extends Element>(el: T): T {
    this.data.elements[el.id] = el;
    return el;
  }

  remove(ids: Iterable<Id>): void {
    const set = new Set(ids);
    for (const e of this.elements) {
      if (isHosted(e) && set.has(e.hostId)) set.add(e.id);
    }
    for (const id of set) delete this.data.elements[id];
  }

  /** Recale les ouvertures dans les limites de leur mur hôte. */
  clampOpenings(): void {
    for (const e of this.elements) {
      if (!isHosted(e)) continue;
      const w = this.get<'wall'>(e.hostId);
      if (!w) {
        delete this.data.elements[e.id];
        continue;
      }
      const t = this.openingSize(e);
      const L = wallLength(w);
      e.offset = Math.min(Math.max(e.offset, Math.min(t.width / 2, L / 2)), Math.max(L - t.width / 2, L / 2));
    }
  }

  nextMark(kind: ElementKind): string {
    const prefix: Partial<Record<ElementKind, string>> = { door: 'P', window: 'F', column: 'C', stair: 'E' };
    const p = prefix[kind] ?? '';
    let max = 0;
    for (const e of this.elements) {
      if (e.kind !== kind || !e.mark) continue;
      const m = /(\d+)$/.exec(e.mark);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${p}${max + 1}`;
  }

  nextRoomNumber(): string {
    let max = 0;
    for (const r of this.ofKind('room')) {
      const n = parseInt(r.number, 10);
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
    return String(max + 1).padStart(3, '0');
  }

  nextGridLabel(): string {
    const used = new Set(this.ofKind('grid').map((g) => g.label));
    for (let i = 1; i < 100; i++) if (!used.has(String(i))) return String(i);
    return '?';
  }
}

const MISSING_FAMILY: FamilyResult = {
  values: {},
  boxes: [{ shape: 'box', x0: -0.25, x1: 0.25, y0: -0.25, y1: 0.25, z0: 0, z1: 0.5, color: '#d93025', glass: false }],
  prims: [{ t: 'rect', x0: -0.25, y0: -0.25, x1: 0.25, y1: 0.25 }, { t: 'line', x0: -0.25, y0: -0.25, x1: 0.25, y1: 0.25 }],
  bounds: { x0: -0.25, y0: -0.25, x1: 0.25, y1: 0.25 },
  errors: ['Famille introuvable'],
};

/** Mise à niveau des anciens fichiers (composants à dimensions fixes). */
function migrateElements(els: Record<Id, Element>): Record<Id, Element> {
  for (const e of Object.values(els)) {
    if (e.kind !== 'component') continue;
    const legacy = e as Component & { width?: number; depth?: number; height?: number };
    delete legacy.width;
    delete legacy.depth;
    delete legacy.height;
  }
  return els;
}

export function isHosted(e: Element): e is Hosted {
  return e.kind === 'door' || e.kind === 'window' || e.kind === 'opening';
}

/** Niveau d'un élément ; undefined pour les éléments visibles sur tous les plans (quadrillages, coupes). */
export function levelOf(project: Project, e: Element): Id | undefined {
  if (e.kind === 'grid' || e.kind === 'section') return undefined;
  if (isHosted(e)) return project.get<'wall'>(e.hostId)?.levelId;
  return e.levelId;
}

/** Complète un fichier chargé avec les champs éventuellement manquants. */
export function normalize(data: ProjectData): ProjectData {
  if (!data || typeof data !== 'object' || !Array.isArray(data.levels)) {
    throw new Error('Fichier projet invalide');
  }
  return {
    version: 1,
    name: data.name ?? 'Projet',
    units: data.units ?? 'cm',
    levels: data.levels,
    wallTypes: data.wallTypes ?? [],
    doorTypes: data.doorTypes ?? [],
    windowTypes: data.windowTypes ?? [],
    elements: migrateElements(data.elements ?? {}),
    families: data.families ?? defaultFamilies(),
    viewSettings: data.viewSettings ?? {},
    info: data.info ?? {},
  };
}

// ---------------------------------------------------------------------------
// Unités

const UNIT_FACTOR: Record<Units, number> = { mm: 1000, cm: 100, m: 1 };
const UNIT_DECIMALS: Record<Units, number> = { mm: 0, cm: 1, m: 3 };

export function formatLength(m: number, units: Units, withUnit = false): string {
  const val = m * UNIT_FACTOR[units];
  const dec = UNIT_DECIMALS[units];
  let s = val.toFixed(dec);
  if (dec > 0) s = s.replace(/\.?0+$/, '');
  return withUnit ? `${s} ${units}` : s;
}

/** Interprète une saisie (« 450 », « 4.5m », « 120cm », « 3500 mm ») en mètres. */
export function parseLength(input: string, units: Units): number | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i.exec(input);
  if (!m) return null;
  const value = parseFloat(m[1].replace(',', '.'));
  const u = (m[2]?.toLowerCase() as Units | undefined) ?? units;
  return value / UNIT_FACTOR[u];
}

export const formatArea = (m2: number): string => `${m2.toFixed(2)} m²`;
export const formatVolume = (m3: number): string => `${m3.toFixed(2)} m³`;
