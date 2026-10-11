import type { App, ToolName } from '../app';
import { copySelection, floorFromWalls, mirrorSelection, paste, roofFromWalls, rotateSelection } from '../commands';
import type { RoofShape } from '../model/types';
import type { ViewHost } from '../views/viewHost';
import { clear, h, perFrame } from './dom';
import { lengthField, numberField, selectField } from './fields';
import { ICONS } from './icons';
import { helpDialog, levelsDialog, typesDialog } from './dialogs';

export interface FileActions {
  newProject(): void;
  open(): void;
  save(): void;
  exportIFC(): void;
  exportGLTF(): void;
  exportImage(): void;
  loadSample(): void;
}

export const ROOF_SHAPES: { value: RoofShape; label: string }[] = [
  { value: 'hip', label: '4 pans (croupe)' },
  { value: 'gable', label: '2 pans' },
  { value: 'mono', label: '1 pan' },
  { value: 'flat', label: 'Toit plat' },
];

type TabId = 'architecture' | 'annotate' | 'modify' | 'view' | 'manage';

interface Btn {
  label: string;
  icon: string;
  tool?: ToolName;
  action?: () => void;
  shortcut?: string;
  title?: string;
  enabled?: () => boolean;
}

/** Ruban à onglets, barre d'accès rapide et barre des options contextuelle. */
export class Ribbon {
  private tab: TabId = 'architecture';
  private tabsEl: HTMLElement;
  private panelEl: HTMLElement;
  private optionsEl: HTMLElement;

  constructor(
    private app: App,
    root: HTMLElement,
    quickAccess: HTMLElement,
    private host: ViewHost,
    private files: FileActions,
  ) {
    this.tabsEl = h('div', { class: 'ribbon-tabs' });
    this.panelEl = h('div', { class: 'ribbon-panel' });
    this.optionsEl = h('div', { class: 'options-bar' });
    root.append(this.tabsEl, this.panelEl, this.optionsEl);
    this.buildQuickAccess(quickAccess);
    app.on('tool', () => this.render());
    app.on('selection', () => this.render());
    app.on('options', () => this.renderOptions());
    app.on('view', () => this.render());
    app.project.onChange(perFrame(() => this.render()));
    this.render();
  }

  private buildQuickAccess(el: HTMLElement): void {
    const b = (icon: string, title: string, fn: () => void) =>
      h('button', { class: 'qa-btn', title, onclick: fn, html: ICONS[icon] });
    el.append(
      b('new', 'Nouveau projet', () => this.files.newProject()),
      b('open', 'Ouvrir… (Ctrl+O)', () => this.files.open()),
      b('save', 'Enregistrer (Ctrl+S)', () => this.files.save()),
      h('span', { class: 'qa-sep' }),
      b('undo', 'Annuler (Ctrl+Z)', () => this.app.project.undo()),
      b('redo', 'Rétablir (Ctrl+Y)', () => this.app.project.redo()),
      h('span', { class: 'qa-sep' }),
      b('ifc', 'Exporter en IFC', () => this.files.exportIFC()),
      b('cube', 'Vue 3D par défaut', () => this.app.setView({ kind: '3d' })),
    );
  }

  private groups(): { title: string; buttons: Btn[] }[] {
    const app = this.app;
    const hasSel = () => app.selection.size > 0;
    switch (this.tab) {
      case 'architecture':
        return [
          { title: 'Sélectionner', buttons: [{ label: 'Modifier', icon: 'select', tool: 'select', shortcut: 'MO' }] },
          {
            title: 'Construire',
            buttons: [
              { label: 'Mur', icon: 'wall', tool: 'wall', shortcut: 'MU' },
              { label: 'Porte', icon: 'door', tool: 'door', shortcut: 'PO' },
              { label: 'Fenêtre', icon: 'window', tool: 'window', shortcut: 'FE' },
              { label: 'Poteau', icon: 'column', tool: 'column', shortcut: 'PT' },
              { label: 'Sol', icon: 'floor', tool: 'floor', shortcut: 'SO' },
              { label: 'Toit', icon: 'roof', tool: 'roof', shortcut: 'TO' },
            ],
          },
          {
            title: 'Création rapide',
            buttons: [
              { label: 'Sol par murs', icon: 'floorFromWalls', action: () => floorFromWalls(app), title: 'Crée un sol sur l’emprise extérieure des murs du niveau' },
              { label: 'Toit par murs', icon: 'roofFromWalls', action: () => roofFromWalls(app), title: 'Crée un toit avec débord au-dessus des murs du niveau' },
            ],
          },
          { title: 'Circulation', buttons: [{ label: 'Escalier', icon: 'stair', tool: 'stair', shortcut: 'ES' }] },
          { title: 'Pièce et surface', buttons: [{ label: 'Pièce', icon: 'room', tool: 'room', shortcut: 'PI' }] },
          { title: 'Référence', buttons: [{ label: 'Quadrillage', icon: 'grid', tool: 'grid', shortcut: 'QU' }] },
        ];
      case 'annotate':
        return [
          { title: 'Cotation', buttons: [{ label: 'Cote alignée', icon: 'dimension', tool: 'dimension', shortcut: 'CO' }] },
          { title: 'Référence', buttons: [{ label: 'Quadrillage', icon: 'grid', tool: 'grid', shortcut: 'QU' }] },
          { title: 'Pièces', buttons: [{ label: 'Pièce', icon: 'room', tool: 'room', shortcut: 'PI' }] },
        ];
      case 'modify':
        return [
          { title: 'Sélectionner', buttons: [{ label: 'Modifier', icon: 'select', tool: 'select', shortcut: 'MO' }] },
          {
            title: 'Presse-papiers',
            buttons: [
              { label: 'Copier', icon: 'copy', action: () => copySelection(app), shortcut: 'Ctrl+C', enabled: hasSel },
              { label: 'Coller', icon: 'paste', action: () => paste(app), shortcut: 'Ctrl+V' },
            ],
          },
          {
            title: 'Modifier',
            buttons: [
              { label: 'Rotation 90°', icon: 'rotate', action: () => rotateSelection(app, 90), shortcut: 'RO', enabled: hasSel },
              { label: 'Symétrie ↔', icon: 'mirror', action: () => mirrorSelection(app, 'x'), enabled: hasSel },
              { label: 'Symétrie ↕', icon: 'mirror', action: () => mirrorSelection(app, 'y'), enabled: hasSel },
              { label: 'Supprimer', icon: 'delete', action: () => app.deleteSelection(), shortcut: 'Suppr', enabled: hasSel },
            ],
          },
        ];
      case 'view':
        return [
          {
            title: 'Créer',
            buttons: [
              { label: 'Vue 3D', icon: 'cube', action: () => app.setView({ kind: '3d' }) },
              { label: 'Plan', icon: 'plan', action: () => app.setView({ kind: 'plan', levelId: app.activeLevelId }) },
              { label: 'Élévation sud', icon: 'elevation', action: () => app.setView({ kind: 'elevation', dir: 'S' }) },
              { label: 'Nomenclature', icon: 'schedule', action: () => app.setView({ kind: 'schedule', category: 'wall' }) },
            ],
          },
          {
            title: 'Navigation',
            buttons: [{ label: 'Zoom étendu', icon: 'zoom', action: () => this.host.zoomExtents(), shortcut: 'ZE' }],
          },
          {
            title: 'Exporter',
            buttons: [
              { label: 'Image PNG', icon: 'image', action: () => this.files.exportImage() },
              { label: 'IFC', icon: 'ifc', action: () => this.files.exportIFC() },
              { label: 'glTF 3D', icon: 'gltf', action: () => this.files.exportGLTF() },
            ],
          },
        ];
      case 'manage':
        return [
          {
            title: 'Paramètres',
            buttons: [
              { label: 'Niveaux', icon: 'level', action: () => levelsDialog(app) },
              { label: 'Types', icon: 'types', action: () => typesDialog(app) },
            ],
          },
          {
            title: 'Projet',
            buttons: [
              { label: 'Exemple', icon: 'copyLevel', action: () => this.files.loadSample(), title: 'Charger la maison de démonstration' },
              { label: 'Aide', icon: 'help', action: () => helpDialog() },
            ],
          },
        ];
    }
  }

  render(): void {
    clear(this.tabsEl);
    const tabs: [TabId, string][] = [
      ['architecture', 'Architecture'],
      ['annotate', 'Annoter'],
      ['modify', 'Modifier'],
      ['view', 'Vue'],
      ['manage', 'Gérer'],
    ];
    for (const [id, label] of tabs) {
      this.tabsEl.append(
        h('button', { class: `ribbon-tab${this.tab === id ? ' active' : ''}`, onclick: () => { this.tab = id; this.render(); } }, label),
      );
    }
    clear(this.panelEl);
    for (const g of this.groups()) {
      const buttons = g.buttons.map((b) => {
        const active = b.tool !== undefined && this.app.tool === b.tool;
        const enabled = b.enabled ? b.enabled() : true;
        return h(
          'button',
          {
            class: `ribbon-btn${active ? ' active' : ''}`,
            disabled: !enabled,
            title: `${b.title ?? b.label}${b.shortcut ? ` (${b.shortcut})` : ''}`,
            onclick: () => {
              if (b.tool) this.app.setTool(b.tool);
              else b.action?.();
            },
          },
          h('span', { class: 'ribbon-icon', html: ICONS[b.icon] }),
          h('span', { class: 'ribbon-label' }, b.label),
        );
      });
      this.panelEl.append(h('div', { class: 'ribbon-group' }, h('div', { class: 'ribbon-buttons' }, ...buttons), h('div', { class: 'ribbon-group-title' }, g.title)));
    }
    this.renderOptions();
  }

  /** Barre des options : paramètres de l'outil actif (comme la barre d'options de Revit). */
  private renderOptions(): void {
    const el = this.optionsEl;
    clear(el);
    const app = this.app;
    const p = app.project;
    const o = app.options;
    const u = p.data.units;
    const item = (label: string, control: HTMLElement) => h('label', { class: 'opt' }, h('span', {}, label), control);
    const toolLabels: Record<ToolName, string> = {
      select: 'Modifier',
      wall: 'Modifier | Placer Mur',
      door: 'Modifier | Placer Porte',
      window: 'Modifier | Placer Fenêtre',
      floor: 'Modifier | Créer la limite du sol',
      roof: 'Modifier | Créer l’empreinte du toit',
      column: 'Modifier | Placer Poteau',
      room: 'Modifier | Placer Pièce',
      stair: 'Modifier | Créer Escalier',
      dimension: 'Modifier | Placer Cote',
      grid: 'Modifier | Placer Quadrillage',
    };
    el.append(h('span', { class: 'opt-title' }, toolLabels[app.tool]));
    switch (app.tool) {
      case 'wall': {
        el.append(
          item('Type', selectField(o.wallTypeId, p.data.wallTypes.map((t) => ({ value: t.id, label: t.name })), (v) => app.setOptions({ wallTypeId: v }))),
          item('Forme', selectField(o.wallShape, [{ value: 'line', label: 'Ligne' }, { value: 'rect', label: 'Rectangle' }], (v) => { app.setOptions({ wallShape: v }); app.setTool('wall'); })),
          item('Ligne de justification', selectField(o.wallLocation, [
            { value: 'center', label: 'Axe du mur' },
            { value: 'left', label: 'Nu (côté gauche)' },
            { value: 'right', label: 'Nu (côté droit)' },
          ], (v) => app.setOptions({ wallLocation: v }))),
          item('Hauteur', o.wallHeight === null
            ? h('button', { class: 'btn small', onclick: () => app.setOptions({ wallHeight: p.level(app.activeLevelId)?.height ?? 2.7 }) }, 'Niveau supérieur')
            : h('span', { class: 'opt-inline' },
                lengthField(o.wallHeight, u, (m) => app.setOptions({ wallHeight: m }), { min: 0.1 }),
                h('button', { class: 'mini-btn', title: 'Contrainte au niveau supérieur', onclick: () => app.setOptions({ wallHeight: null }) }, '↥'))),
          item('Chaîne', (() => {
            const c = h('input', { type: 'checkbox', checked: o.chain });
            c.addEventListener('change', () => app.setOptions({ chain: c.checked }));
            return c;
          })()),
        );
        break;
      }
      case 'door':
        el.append(item('Type', selectField(o.doorTypeId, p.data.doorTypes.map((t) => ({ value: t.id, label: t.name })), (v) => app.setOptions({ doorTypeId: v }))));
        break;
      case 'window':
        el.append(item('Type', selectField(o.windowTypeId, p.data.windowTypes.map((t) => ({ value: t.id, label: t.name })), (v) => app.setOptions({ windowTypeId: v }))));
        break;
      case 'floor':
        el.append(item('Épaisseur', lengthField(o.floorThickness, u, (m) => app.setOptions({ floorThickness: m }), { min: 0.01 })));
        break;
      case 'roof':
        el.append(
          item('Forme', selectField(o.roofShape, ROOF_SHAPES, (v) => app.setOptions({ roofShape: v }))),
          item('Pente', numberField(o.roofSlope, (v) => app.setOptions({ roofSlope: v }), { min: 0, max: 75, suffix: '°' })),
          item('Épaisseur', lengthField(o.roofThickness, u, (m) => app.setOptions({ roofThickness: m }), { min: 0.01 })),
          item('Débord (toit par murs)', lengthField(o.roofOverhang, u, (m) => app.setOptions({ roofOverhang: m }), { min: 0 })),
          h('span', { class: 'opt-hint' }, '1 pan / 2 pans : la pente part de la première arête dessinée.'),
        );
        break;
      case 'column':
        el.append(
          item('Section', lengthField(o.columnSize, u, (m) => app.setOptions({ columnSize: m }), { min: 0.05 })),
          item('Forme', selectField(o.columnShape, [{ value: 'rect', label: 'Rectangulaire' }, { value: 'round', label: 'Circulaire' }], (v) => app.setOptions({ columnShape: v }))),
        );
        break;
      case 'stair':
        el.append(item('Largeur', lengthField(o.stairWidth, u, (m) => app.setOptions({ stairWidth: m }), { min: 0.5 })));
        break;
      case 'room':
        el.append(
          item('Mode', selectField(o.roomMode, [{ value: 'auto', label: 'Détection automatique' }, { value: 'sketch', label: 'Esquisse du contour' }], (v) => { app.setOptions({ roomMode: v }); app.setTool('room'); })),
        );
        break;
      case 'select': {
        const n = app.selection.size;
        el.append(h('span', { class: 'opt-hint' }, n ? `${n} élément(s) sélectionné(s)` : 'Cliquez un élément ou faites une sélection par fenêtre.'));
        break;
      }
      default:
        break;
    }
  }
}
