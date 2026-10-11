import { wallDir, wallLength, wallOutline, wallTypeThickness, add, mul, type OpeningSpan, type WallOutline } from './geometry';
import type {
  Door,
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
  Window,
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
    for (const fn of this.listeners) fn();
  }

  load(data: ProjectData): void {
    this.data = normalize(data);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit();
  }

  /** Exécute une modification annulable. */
  transact<T>(label: string, fn: (d: ProjectData) => T): T {
    const snapshot = JSON.stringify(this.data);
    const result = fn(this.data);
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

  thickness(w: Wall): number {
    return this.wallType(w.typeId).thickness;
  }

  outline(w: Wall): WallOutline {
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

  hosted(wallId: Id): (Door | Window)[] {
    return this.elements.filter(
      (e): e is Door | Window => (e.kind === 'door' || e.kind === 'window') && e.hostId === wallId,
    );
  }

  openingSpans(w: Wall): OpeningSpan[] {
    return this.hosted(w.id).map((o) => {
      const t = o.kind === 'door' ? this.doorType(o.typeId) : this.windowType(o.typeId);
      const bottom = o.kind === 'door' ? 0 : o.sill;
      return { id: o.id, start: o.offset - t.width / 2, end: o.offset + t.width / 2, bottom, top: bottom + t.height };
    });
  }

  /** Position du centre et direction d'une ouverture en plan. */
  openingFrame(o: Door | Window): { center: Vec2; dir: Vec2; width: number; wall: Wall } | null {
    const w = this.get<'wall'>(o.hostId);
    if (!w) return null;
    const dir = wallDir(w);
    const t = o.kind === 'door' ? this.doorType(o.typeId) : this.windowType(o.typeId);
    return { center: add(w.a, mul(dir, o.offset)), dir, width: t.width, wall: w };
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
      if ((e.kind === 'door' || e.kind === 'window') && set.has(e.hostId)) set.add(e.id);
    }
    for (const id of set) delete this.data.elements[id];
  }

  /** Recale les ouvertures dans les limites de leur mur hôte. */
  clampOpenings(): void {
    for (const e of this.elements) {
      if (e.kind !== 'door' && e.kind !== 'window') continue;
      const w = this.get<'wall'>(e.hostId);
      if (!w) {
        delete this.data.elements[e.id];
        continue;
      }
      const t = e.kind === 'door' ? this.doorType(e.typeId) : this.windowType(e.typeId);
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

export function levelOf(project: Project, e: Element): Id | undefined {
  if (e.kind === 'grid') return undefined;
  if (e.kind === 'door' || e.kind === 'window') return project.get<'wall'>(e.hostId)?.levelId;
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
    elements: data.elements ?? {},
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
