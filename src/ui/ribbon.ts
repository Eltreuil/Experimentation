import type { App, ToolName } from '../app';
import { attachSelectedWalls, copySelection, detachSelectedWalls, floorFromWalls, paste, roofFromWalls } from '../commands';
import { familyEditor } from './familyEditor';
import type { RoofShape } from '../model/types';
import type { ViewHost } from '../views/viewHost';
import { clear, h, perFrame } from './dom';
import { lengthField, numberField, selectField } from './fields';
import { ICONS } from './icons';
import { helpDialog, levelsDialog, projectInfoDialog, typesDialog, visibilityDialog } from './dialogs';

export interface FileActions {
  printSheet(): void;
  exportSheet(): void;
  exportDXF(): void;
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

export const TOOL_LABELS: Record<ToolName, string> = {
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
  wallDimension: 'Modifier | Coter un mur',
  grid: 'Modifier | Placer Quadrillage',
  opening: 'Modifier | Placer Ouverture',
  shaft: 'Modifier | Créer Trémie',
  ceiling: 'Modifier | Placer Faux-plafond',
  railing: 'Modifier | Créer Garde-corps',
  component: 'Modifier | Placer Composant',
  text: 'Modifier | Placer Texte',
  section: 'Modifier | Créer Coupe',
  measure: 'Mesurer',
  align: 'Modifier | Aligner',
  offset: 'Modifier | Décaler',
  trim: 'Modifier | Ajuster/prolonger pour former un angle',
  extend: 'Modifier | Ajuster/prolonger un élément',
  split: 'Modifier | Scinder',
  move: 'Modifier | Déplacer',
  copy: 'Modifier | Copier',
  rotate: 'Modifier | Rotation',
  mirror: 'Modifier | Symétrie',
  array: 'Modifier | Réseau',
};

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
    const wallsSel = () => [...app.selection].some((id) => app.project.get(id)?.kind === 'wall');
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
              { label: 'Composant', icon: 'component', tool: 'component', shortcut: 'CP', title: 'Familles paramétriques : mobilier, sanitaires, équipements' },
              { label: 'Poteau', icon: 'column', tool: 'column', shortcut: 'PT' },
              { label: 'Toit', icon: 'roof', tool: 'roof', shortcut: 'TO' },
              { label: 'Plafond', icon: 'ceiling', tool: 'ceiling', shortcut: 'FP', title: 'Faux-plafond' },
              { label: 'Sol', icon: 'floor', tool: 'floor', shortcut: 'SO' },
            ],
          },
          {
            title: 'Création rapide',
            buttons: [
              { label: 'Sol par murs', icon: 'floorFromWalls', action: () => floorFromWalls(app), title: 'Crée un sol sur l’emprise extérieure des murs du niveau' },
              { label: 'Toit par murs', icon: 'roofFromWalls', action: () => roofFromWalls(app), title: 'Crée un toit avec débord au-dessus des murs du niveau' },
            ],
          },
          {
            title: 'Circulation',
            buttons: [
              { label: 'Escalier', icon: 'stair', tool: 'stair', shortcut: 'ES' },
              { label: 'Garde-corps', icon: 'railing', tool: 'railing', shortcut: 'GC' },
            ],
          },
          {
            title: 'Ouverture',
            buttons: [
              { label: 'Ouverture', icon: 'opening', tool: 'opening', shortcut: 'OU', title: 'Ouverture rectangulaire dans un mur' },
              { label: 'Trémie', icon: 'shaft', tool: 'shaft', shortcut: 'TR', title: 'Trémie verticale à travers les sols' },
            ],
          },
          { title: 'Pièce et surface', buttons: [{ label: 'Pièce', icon: 'room', tool: 'room', shortcut: 'PI' }] },
          {
            title: 'Référence',
            buttons: [
              { label: 'Quadrillage', icon: 'grid', tool: 'grid', shortcut: 'QU' },
              { label: 'Niveaux', icon: 'level', action: () => levelsDialog(app) },
            ],
          },
        ];
      case 'annotate':
        return [
          {
            title: 'Cotation',
            buttons: [
              { label: 'Cote alignée', icon: 'dimension', tool: 'dimension', shortcut: 'CO' },
              { label: 'Cotes de mur', icon: 'wallDimension', tool: 'wallDimension', shortcut: 'CM', title: 'Cotes en chaîne d’un mur et de ses ouvertures' },
            ],
          },
          { title: 'Texte', buttons: [{ label: 'Texte', icon: 'text', tool: 'text', shortcut: 'TX' }] },
          { title: 'Pièces', buttons: [{ label: 'Pièce', icon: 'room', tool: 'room', shortcut: 'PI' }] },
          { title: 'Référence', buttons: [{ label: 'Quadrillage', icon: 'grid', tool: 'grid', shortcut: 'QU' }] },
          { title: 'Mesure', buttons: [{ label: 'Mesurer', icon: 'measure', tool: 'measure', shortcut: 'ME' }] },
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
              { label: 'Aligner', icon: 'align', tool: 'align', shortcut: 'AL' },
              { label: 'Décaler', icon: 'offset', tool: 'offset', shortcut: 'DE' },
              { label: 'Symétrie', icon: 'mirror', tool: 'mirror', shortcut: 'SY', enabled: hasSel },
              { label: 'Déplacer', icon: 'move', tool: 'move', shortcut: 'DP', enabled: hasSel },
              { label: 'Copier', icon: 'copy', tool: 'copy', shortcut: 'CC', enabled: hasSel },
              { label: 'Rotation', icon: 'rotate', tool: 'rotate', shortcut: 'RO', enabled: hasSel },
              { label: 'Réseau', icon: 'array', tool: 'array', shortcut: 'RS', enabled: hasSel },
              { label: 'Angle', icon: 'trim', tool: 'trim', shortcut: 'AJ', title: 'Ajuster/prolonger pour former un angle' },
              { label: 'Prolonger', icon: 'extend', tool: 'extend', shortcut: 'PR', title: 'Ajuster/prolonger jusqu’à une limite' },
              { label: 'Scinder', icon: 'split', tool: 'split', shortcut: 'SC' },
              { label: 'Supprimer', icon: 'delete', action: () => app.deleteSelection(), shortcut: 'Suppr', enabled: hasSel },
            ],
          },
          {
            title: 'Murs',
            buttons: [
              { label: 'Attacher haut', icon: 'attach', action: () => attachSelectedWalls(app), shortcut: 'AH', enabled: wallsSel, title: 'Attacher le haut des murs sélectionnés au toit' },
              { label: 'Détacher', icon: 'detach', action: () => detachSelectedWalls(app), enabled: wallsSel, title: 'Détacher le haut des murs' },
            ],
          },
          { title: 'Mesure', buttons: [{ label: 'Mesurer', icon: 'measure', tool: 'measure', shortcut: 'ME' }] },
        ];
      case 'view':
        return [
          {
            title: 'Graphismes',
            buttons: [{ label: 'Visibilité', icon: 'visibility', action: () => visibilityDialog(app), shortcut: 'VG', title: 'Visibilité / graphismes de la vue' }],
          },
          {
            title: 'Créer',
            buttons: [
              { label: 'Vue 3D', icon: 'cube', action: () => app.setView({ kind: '3d' }) },
              { label: 'Plan', icon: 'plan', action: () => app.setView({ kind: 'plan', levelId: app.activeLevelId }) },
              { label: 'Coupe', icon: 'section', tool: 'section', shortcut: 'CE' },
              { label: 'Élévation sud', icon: 'elevation', action: () => app.setView({ kind: 'elevation', dir: 'S' }) },
              { label: 'Nomenclature', icon: 'schedule', action: () => app.setView({ kind: 'schedule', category: 'wall' }) },
            ],
          },
          { title: 'Navigation', buttons: [{ label: 'Zoom étendu', icon: 'zoom', action: () => this.host.zoomExtents(), shortcut: 'ZE' }] },
          {
            title: 'Feuilles et exports',
            buttons: [
              { label: 'Imprimer', icon: 'print', action: () => this.files.printSheet(), title: 'Feuille A3 avec cartouche (impression ou PDF)' },
              { label: 'Feuille SVG', icon: 'svgFile', action: () => this.files.exportSheet(), title: 'Feuille A3 vectorielle avec cartouche' },
              { label: 'DXF', icon: 'dxf', action: () => this.files.exportDXF(), title: 'Plan au format AutoCAD DXF (calques par catégorie)' },
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
              { label: 'Familles', icon: 'component', action: () => familyEditor(app), shortcut: 'FA', title: 'Éditeur de familles paramétriques' },
              { label: 'Infos projet', icon: 'info', action: () => projectInfoDialog(app), title: 'Informations du cartouche' },
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
    const check = (value: boolean, fn: (v: boolean) => void) => {
      const c = h('input', { type: 'checkbox', checked: value });
      c.addEventListener('change', () => fn(c.checked));
      return c;
    };
    const hint = (t: string) => h('span', { class: 'opt-hint' }, t);
    el.append(h('span', { class: 'opt-title' }, TOOL_LABELS[app.tool]));
    switch (app.tool) {
      case 'wall':
        el.append(
          item('Type', selectField(o.wallTypeId, p.data.wallTypes.map((t) => ({ value: t.id, label: t.name })), (v) => app.setOptions({ wallTypeId: v }))),
          item('Forme', selectField(o.wallShape, [{ value: 'line', label: 'Ligne' }, { value: 'rect', label: 'Rectangle' }], (v) => { app.setOptions({ wallShape: v }); app.setTool('wall'); })),
          item('Ligne de justification', selectField(o.wallLocation, [
            { value: 'center', label: 'Axe du mur' },
            { value: 'left', label: 'Nu (côté gauche)' },
            { value: 'right', label: 'Nu (côté droit)' },
          ], (v) => app.setOptions({ wallLocation: v }))),
          item('Hauteur', o.wallHeight === null
            ? h('button', { class: 'btn small', title: 'La hauteur suit le niveau supérieur', onclick: () => app.setOptions({ wallHeight: p.level(app.activeLevelId)?.height ?? 2.7 }) }, 'Niveau supérieur')
            : h('span', { class: 'opt-inline' },
                lengthField(o.wallHeight, u, (m) => app.setOptions({ wallHeight: m }), { min: 0.1 }),
                h('button', { class: 'mini-btn', title: 'Contrainte au niveau supérieur', onclick: () => app.setOptions({ wallHeight: null }) }, '↥'))),
          item('Chaîne', check(o.chain, (v) => app.setOptions({ chain: v }))),
        );
        break;
      case 'door':
        el.append(item('Type', selectField(o.doorTypeId, p.data.doorTypes.map((t) => ({ value: t.id, label: t.name })), (v) => app.setOptions({ doorTypeId: v }))));
        break;
      case 'window':
        el.append(item('Type', selectField(o.windowTypeId, p.data.windowTypes.map((t) => ({ value: t.id, label: t.name })), (v) => app.setOptions({ windowTypeId: v }))));
        break;
      case 'opening':
        el.append(
          item('Largeur', lengthField(o.openingWidth, u, (m) => app.setOptions({ openingWidth: m }), { min: 0.1 })),
          item('Hauteur', lengthField(o.openingHeight, u, (m) => app.setOptions({ openingHeight: m }), { min: 0.1 })),
          item('Allège', lengthField(o.openingSill, u, (m) => app.setOptions({ openingSill: m }), { min: 0 })),
        );
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
          hint('1 pan / 2 pans : la pente part de la première arête dessinée.'),
        );
        break;
      case 'ceiling':
        el.append(
          item('Mode', selectField(o.roomMode, [{ value: 'auto', label: 'Clic dans une pièce' }, { value: 'sketch', label: 'Esquisse du contour' }], (v) => { app.setOptions({ roomMode: v }); app.setTool('ceiling'); })),
          item('Hauteur', lengthField(o.ceilingHeight, u, (m) => app.setOptions({ ceilingHeight: m }), { min: 0.5 })),
        );
        break;
      case 'shaft':
        el.append(item('Hauteur', lengthField(o.shaftHeight, u, (m) => app.setOptions({ shaftHeight: m }), { min: 0 })), hint('Perce les sols du niveau courant jusqu’à cette hauteur.'));
        break;
      case 'railing':
        el.append(item('Hauteur', lengthField(o.railingHeight, u, (m) => app.setOptions({ railingHeight: m }), { min: 0.3 })));
        break;
      case 'component': {
        const fam = p.family(o.componentFamily) ?? p.families[0];
        const families = [...p.families].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        el.append(
          item('Famille', selectField(fam?.id ?? '', families.map((f) => ({ value: f.id, label: `${f.category} — ${f.name}` })), (v) => app.setOptions({ componentFamily: v, componentTypeId: '' }))),
          fam ? item('Type', selectField(fam.types.find((t) => t.id === o.componentTypeId)?.id ?? fam.types[0]?.id ?? '', fam.types.map((t) => ({ value: t.id, label: t.name })), (v) => app.setOptions({ componentTypeId: v }))) : hint(''),
          h('button', { class: 'btn small', onclick: () => familyEditor(app, fam?.id) }, 'Modifier la famille…'),
          hint('Espace : rotation de 90°.'),
        );
        break;
      }
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
      case 'text':
        el.append(item('Taille (mm papier)', numberField(o.textSize, (v) => app.setOptions({ textSize: v }), { min: 1, max: 20, step: 0.5, suffix: 'mm' })));
        break;
      case 'offset':
        el.append(
          item('Distance', lengthField(o.offsetDistance, u, (m) => app.setOptions({ offsetDistance: m }), { min: 0.001 })),
          item('Copier', check(o.offsetCopy, (v) => app.setOptions({ offsetCopy: v }))),
        );
        break;
      case 'mirror':
        el.append(item('Copier', check(o.mirrorCopy, (v) => app.setOptions({ mirrorCopy: v }))));
        break;
      case 'copy':
        el.append(item('Multiple', check(o.multipleCopy, (v) => app.setOptions({ multipleCopy: v }))));
        break;
      case 'array':
        el.append(item('Nombre d’exemplaires', numberField(o.arrayCount, (v) => app.setOptions({ arrayCount: Math.round(v) }), { min: 2, max: 200, step: 1 })));
        break;
      case 'select': {
        const n = app.selection.size;
        el.append(hint(n ? `${n} élément(s) sélectionné(s) — DP déplacer, CC copier, RO rotation, SY symétrie, Suppr supprimer` : 'Cliquez un élément ou faites une sélection par fenêtre.'));
        break;
      }
      default:
        break;
    }
  }
}
