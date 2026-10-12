import './styles.css';
import { App, type ToolName } from './app';
import { attachSelectedWalls, copySelection, paste } from './commands';
import { autosave, download, downloadDataURL, loadAutosave, pickFile, readProjectFile, safeName } from './io/files';
import { exportIFC } from './io/ifc';
import { emptyProject, sampleProject } from './model/defaults';
import { formatLength } from './model/project';
import { ProjectBrowser } from './ui/browser';
import { confirmDialog, visibilityDialog } from './ui/dialogs';
import { h } from './ui/dom';
import { PropertiesPanel } from './ui/properties';
import { familyEditor } from './ui/familyEditor';
import { Ribbon, type FileActions } from './ui/ribbon';
import { ViewHost, viewTitle } from './views/viewHost';
import { printSVG, shapesToDXF, sheetSVG } from './io/vector';

const app = new App(loadAutosave() ?? sampleProject());

// --- Mise en page -----------------------------------------------------------
const quickAccess = h('div', { class: 'quick-access' });
const titleEl = h('div', { class: 'app-title' });
const topbar = h('header', { class: 'topbar' }, h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, 'B'), 'OpenBIM Studio'), quickAccess, titleEl);
const ribbonEl = h('div', { class: 'ribbon' });
const browserEl = h('aside', { class: 'panel browser' });
const viewEl = h('main', { class: 'view-area' });
const propsEl = h('aside', { class: 'panel properties' }, h('div', { class: 'panel-title' }, 'Propriétés'));
const propsBody = h('div', { class: 'props-body' });
propsEl.append(propsBody);
const statusEl = h('footer', { class: 'statusbar' });
const statusText = h('span', { class: 'status-text' });
const statusCoords = h('span', { class: 'status-coords' });
const statusLevel = h('span', { class: 'status-level' });
statusEl.append(statusText, statusLevel, statusCoords);

document.getElementById('app')!.append(topbar, ribbonEl, h('div', { class: 'workspace' }, browserEl, viewEl, propsEl), statusEl);

const host = new ViewHost(app, viewEl);

// Point d'accès pour l'automatisation (tests, scripts, extensions) depuis la console.
(window as unknown as { openbim: unknown }).openbim = { app, host };

// --- Fichiers ----------------------------------------------------------------
/** Feuille A3 (SVG) de la vue en plan active, avec cartouche. */
function currentSheet(): string | null {
  const plan = host.plan;
  if (!plan) {
    app.status('Ouvrez une vue en plan pour produire une feuille.');
    return null;
  }
  const { shapes } = plan.recordVector();
  const info = app.project.data.info ?? {};
  const level = app.project.level(plan.levelId);
  return sheetSVG(shapes, {
    project: app.project.data.name,
    view: `Plan ${level?.name ?? ''}`,
    scale: plan.viewScale,
    date: new Date().toLocaleDateString('fr-FR'),
    ...info,
  });
}

const files: FileActions = {
  printSheet() {
    const svg = currentSheet();
    if (svg) printSVG(svg);
  },
  exportSheet() {
    const svg = currentSheet();
    if (svg) download(`${safeName(app.project.data.name)}_${safeName(viewTitle(app, app.view))}.svg`, svg, 'image/svg+xml');
  },
  exportDXF() {
    const plan = host.plan;
    if (!plan) {
      app.status('Ouvrez une vue en plan pour l’exporter en DXF.');
      return;
    }
    const { shapes, toWorldMM, textScale } = plan.recordVector();
    download(`${safeName(app.project.data.name)}_${safeName(viewTitle(app, app.view))}.dxf`, shapesToDXF(shapes, toWorldMM, textScale), 'application/dxf');
    app.status('Export DXF terminé (unités : mm, un calque par catégorie).');
  },
  async newProject() {
    if (app.project.dirty && !(await confirmDialog('Nouveau projet', 'Les modifications non enregistrées seront perdues.', 'Continuer'))) return;
    app.load(emptyProject());
  },
  async open() {
    const f = await pickFile('.json,.obim,application/json');
    if (!f) return;
    try {
      app.load(await readProjectFile(f));
      app.status(`Projet « ${app.project.data.name} » ouvert.`);
    } catch (err) {
      app.status(`Erreur à l'ouverture : ${(err as Error).message}`);
    }
  },
  save() {
    download(`${safeName(app.project.data.name)}.obim.json`, JSON.stringify(app.project.data, null, 2), 'application/json');
    app.project.dirty = false;
    updateTitle();
    app.status('Projet enregistré.');
  },
  exportIFC() {
    download(`${safeName(app.project.data.name)}.ifc`, exportIFC(app.project), 'application/x-step');
    app.status('Export IFC4 terminé.');
  },
  async exportGLTF() {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    host.withModel((v) => {
      exporter.parse(
        v.model,
        (result) => {
          download(`${safeName(app.project.data.name)}.glb`, result as ArrayBuffer, 'model/gltf-binary');
          app.status('Export glTF terminé.');
        },
        (err) => app.status(`Erreur glTF : ${String(err)}`),
        { binary: true },
      );
    });
  },
  exportImage() {
    const url = host.snapshot();
    if (url) downloadDataURL(`${safeName(app.project.data.name)}.png`, url);
    else app.status('Cette vue ne peut pas être exportée en image.');
  },
  async loadSample() {
    if (app.project.dirty && !(await confirmDialog('Projet exemple', 'Remplacer le projet courant par la maison de démonstration ?', 'Charger'))) return;
    app.load(sampleProject());
  },
};

new Ribbon(app, ribbonEl, quickAccess, host, files);
new ProjectBrowser(app, browserEl);
new PropertiesPanel(app, propsBody);

// --- Barre d'état et titre ----------------------------------------------------
function updateTitle(): void {
  titleEl.textContent = `${app.project.data.name}${app.project.dirty ? ' •' : ''}`;
  document.title = `${app.project.data.name} — OpenBIM Studio`;
}

function updateStatus(): void {
  statusText.textContent = app.statusText;
  const plan = host.plan;
  const lvl = app.project.level(app.activeLevelId);
  statusLevel.textContent = lvl ? `${lvl.name} (${formatLength(lvl.elevation, 'm')} m)` : '';
  if (plan?.cursor) {
    const u = app.project.data.units;
    const snap = plan.lastSnap && plan.lastSnap.kind !== 'increment' ? ` · ${SNAP_LABELS[plan.lastSnap.kind]}` : '';
    statusCoords.textContent = `X ${formatLength(plan.cursor.x, u)}  Y ${formatLength(plan.cursor.y, u)} ${u}${snap}`;
  } else {
    statusCoords.textContent = '';
  }
}

const SNAP_LABELS: Record<string, string> = {
  end: 'Extrémité',
  mid: 'Milieu',
  vertex: 'Sommet',
  center: 'Centre',
  intersection: 'Intersection',
  nearest: 'Proche',
  ortho: 'Orthogonal',
};

app.on('status', updateStatus);
app.on('view', updateStatus);
app.project.onChange(() => {
  updateTitle();
  scheduleAutosave();
});
updateTitle();
updateStatus();

let autosaveTimer = 0;
function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => autosave(app.project.data), 800);
}

window.addEventListener('beforeunload', () => autosave(app.project.data));

// --- Clavier ----------------------------------------------------------------
const SHORTCUTS: Record<string, ToolName | (() => void)> = {
  MU: 'wall',
  PO: 'door',
  FE: 'window',
  PT: 'column',
  SO: 'floor',
  TO: 'roof',
  ES: 'stair',
  PI: 'room',
  CO: 'dimension',
  CM: 'wallDimension',
  QU: 'grid',
  MO: 'select',
  OU: 'opening',
  TR: 'shaft',
  FP: 'ceiling',
  GC: 'railing',
  CP: 'component',
  TX: 'text',
  CE: 'section',
  ME: 'measure',
  AL: 'align',
  DE: 'offset',
  AJ: 'trim',
  PR: 'extend',
  SC: 'split',
  DP: 'move',
  CC: 'copy',
  RO: 'rotate',
  SY: 'mirror',
  RS: 'array',
  ZE: () => host.zoomExtents(),
  VG: () => visibilityDialog(app),
  AH: () => attachSelectedWalls(app),
  FA: () => familyEditor(app),
};
let keyBuffer = '';
let keyTimer = 0;

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, select, textarea') || document.querySelector('.modal-backdrop')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) app.project.undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) app.project.redo();
    else if (k === 's') files.save();
    else if (k === 'o') files.open();
    else if (k === 'c') copySelection(app);
    else if (k === 'v') paste(app);
    else if (k === 'a' && host.plan) app.select(host.plan.visibleElements().map((x) => x.id));
    else return;
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    keyBuffer = '';
    if (host.plan) host.plan.escape();
    else if (app.tool !== 'select') app.setTool('select');
    else app.clearSelection();
    return;
  }
  // L'outil actif est prioritaire (saisie de longueur, Entrée, barre d'espace).
  if (host.plan?.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    app.deleteSelection();
    e.preventDefault();
    return;
  }
  if (/^[a-z]$/i.test(e.key) && !e.altKey) {
    keyBuffer = (keyBuffer + e.key.toUpperCase()).slice(-2);
    clearTimeout(keyTimer);
    keyTimer = window.setTimeout(() => (keyBuffer = ''), 1200);
    const cmd = SHORTCUTS[keyBuffer];
    if (cmd) {
      keyBuffer = '';
      if (typeof cmd === 'function') cmd();
      else app.setTool(cmd);
    }
  }
});

// Application installable et utilisable hors ligne (hors application de bureau).
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
