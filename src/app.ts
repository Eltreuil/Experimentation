import { Project } from './model/project';
import type { ElementKind, Id, ProjectData, RoofShape } from './model/types';

export type ToolName =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'floor'
  | 'roof'
  | 'column'
  | 'room'
  | 'stair'
  | 'dimension'
  | 'grid';

export type ScheduleCategory = 'wall' | 'door' | 'window' | 'room' | 'floor';
export type ElevationDir = 'N' | 'S' | 'E' | 'W';

export type ViewDef =
  | { kind: 'plan'; levelId: Id }
  | { kind: '3d' }
  | { kind: 'elevation'; dir: ElevationDir }
  | { kind: 'schedule'; category: ScheduleCategory };

export function viewKey(v: ViewDef): string {
  switch (v.kind) {
    case 'plan':
      return `plan:${v.levelId}`;
    case '3d':
      return '3d';
    case 'elevation':
      return `elev:${v.dir}`;
    case 'schedule':
      return `sched:${v.category}`;
  }
}

export interface ToolOptions {
  wallTypeId: Id;
  /** Hauteur des nouveaux murs ; null = hauteur du niveau. */
  wallHeight: number | null;
  /** Ligne de justification du mur dessiné. */
  wallLocation: 'center' | 'left' | 'right';
  wallShape: 'line' | 'rect';
  roomMode: 'auto' | 'sketch';
  doorTypeId: Id;
  windowTypeId: Id;
  floorThickness: number;
  roofSlope: number;
  roofShape: RoofShape;
  roofThickness: number;
  roofOverhang: number;
  columnSize: number;
  columnShape: 'rect' | 'round';
  stairWidth: number;
  chain: boolean;
}

type AppEvent = 'selection' | 'view' | 'tool' | 'status' | 'options' | 'views';

export const TOOL_KINDS: Partial<Record<ToolName, ElementKind>> = {
  wall: 'wall',
  door: 'door',
  window: 'window',
  floor: 'floor',
  roof: 'roof',
  column: 'column',
  room: 'room',
  stair: 'stair',
  dimension: 'dimension',
  grid: 'grid',
};

export class App {
  project: Project;
  selection = new Set<Id>();
  view: ViewDef;
  openViews: ViewDef[] = [];
  tool: ToolName = 'select';
  statusText = '';
  options: ToolOptions;
  private listeners = new Map<AppEvent, Set<() => void>>();

  constructor(data: ProjectData) {
    this.project = new Project(data);
    const lvl = this.project.sortedLevels()[0];
    this.view = { kind: 'plan', levelId: lvl.id };
    this.openViews = [this.view];
    this.options = this.defaultOptions();
    this.project.onChange(() => {
      let changed = false;
      for (const id of [...this.selection]) {
        if (!this.project.data.elements[id]) {
          this.selection.delete(id);
          changed = true;
        }
      }
      if (changed) this.emit('selection');
      // Le niveau d'une vue en plan a pu être supprimé.
      const removed = (v: ViewDef) => v.kind === 'plan' && !this.project.level(v.levelId);
      if (this.openViews.some(removed)) {
        this.openViews = this.openViews.filter((v) => !removed(v));
        this.emit('views');
      }
      if (removed(this.view)) this.setView({ kind: 'plan', levelId: this.project.sortedLevels()[0].id });
    });
  }

  private defaultOptions(): ToolOptions {
    const d = this.project.data;
    return {
      wallTypeId: d.wallTypes[0]?.id ?? '',
      wallHeight: null,
      wallLocation: 'center',
      wallShape: 'line',
      roomMode: 'auto',
      doorTypeId: d.doorTypes[0]?.id ?? '',
      windowTypeId: d.windowTypes[0]?.id ?? '',
      floorThickness: 0.25,
      roofSlope: 30,
      roofShape: 'hip',
      roofThickness: 0.3,
      roofOverhang: 0.5,
      columnSize: 0.3,
      columnShape: 'rect',
      stairWidth: 1.0,
      chain: true,
    };
  }

  load(data: ProjectData): void {
    this.selection.clear();
    this.project.load(data);
    this.options = this.defaultOptions();
    const lvl = this.project.sortedLevels()[0];
    this.openViews = [];
    this.setView({ kind: 'plan', levelId: lvl.id });
    this.emit('selection');
    this.emit('options');
  }

  on(evt: AppEvent, fn: () => void): () => void {
    let set = this.listeners.get(evt);
    if (!set) this.listeners.set(evt, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(evt: AppEvent): void {
    for (const fn of this.listeners.get(evt) ?? []) fn();
  }

  setView(v: ViewDef): void {
    this.view = v;
    if (!this.openViews.some((o) => viewKey(o) === viewKey(v))) this.openViews.push(v);
    if (v.kind !== 'plan' && this.tool !== 'select') this.setTool('select');
    this.emit('views');
    this.emit('view');
  }

  closeView(v: ViewDef): void {
    const key = viewKey(v);
    this.openViews = this.openViews.filter((o) => viewKey(o) !== key);
    if (viewKey(this.view) === key) {
      const next = this.openViews[this.openViews.length - 1] ?? { kind: 'plan', levelId: this.project.sortedLevels()[0].id };
      this.setView(next);
    } else {
      this.emit('views');
    }
  }

  /** Niveau de travail : celui de la vue en plan active, sinon le premier. */
  get activeLevelId(): Id {
    if (this.view.kind === 'plan') return this.view.levelId;
    return this.project.sortedLevels()[0].id;
  }

  setTool(t: ToolName): void {
    if (t !== 'select' && this.view.kind !== 'plan') {
      const lvl = this.activeLevelId;
      this.view = { kind: 'plan', levelId: lvl };
      if (!this.openViews.some((o) => viewKey(o) === viewKey(this.view))) this.openViews.push(this.view);
      this.emit('views');
      this.emit('view');
    }
    this.tool = t;
    if (t !== 'select') this.clearSelection();
    this.emit('tool');
  }

  setOptions(patch: Partial<ToolOptions>): void {
    Object.assign(this.options, patch);
    this.emit('options');
  }

  select(ids: Id[], additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.emit('selection');
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.emit('selection');
  }

  status(text: string): void {
    this.statusText = text;
    this.emit('status');
  }

  deleteSelection(): void {
    if (this.selection.size === 0) return;
    const ids = [...this.selection];
    this.project.transact('Supprimer', () => this.project.remove(ids));
    this.clearSelection();
  }
}
