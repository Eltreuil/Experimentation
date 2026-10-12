// Éditeur de familles paramétriques : paramètres (avec formules), types,
// volumes 3D, symboles 2D, aperçu en direct, import/export.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { App } from '../app';
import { download, pickFile, safeName } from '../io/files';
import { tryEval } from '../model/expr';
import { checkFormula, evaluateFamily, renameParam, type FamilyResult } from '../model/family';
import { blankFamily } from '../model/familyLibrary';
import { formatLength, newId } from '../model/project';
import type { Expr, FamilyDef, FamilySolid, FamilySymbol, ParamKind, ParamValue, Units } from '../model/types';
import { confirmDialog, modal, promptDialog } from './dialogs';
import { clear, h } from './dom';
import { checkField, colorField, lengthField, numberField, selectField, textField } from './fields';

export const PARAM_KINDS: { value: ParamKind; label: string }[] = [
  { value: 'length', label: 'Longueur' },
  { value: 'number', label: 'Nombre' },
  { value: 'integer', label: 'Entier' },
  { value: 'angle', label: 'Angle' },
  { value: 'boolean', label: 'Oui/Non' },
  { value: 'material', label: 'Matériau' },
  { value: 'text', label: 'Texte' },
];

/** Champ de saisie adapté au type de paramètre. Les angles sont stockés en radians, affichés en degrés. */
export function paramField(kind: ParamKind, value: ParamValue, units: Units, onCommit: (v: ParamValue) => void): HTMLElement {
  switch (kind) {
    case 'length':
      return lengthField(Number(value) || 0, units, (m) => onCommit(m));
    case 'angle':
      return numberField(Math.round(((Number(value) || 0) * 180) / Math.PI * 100) / 100, (d) => onCommit((d * Math.PI) / 180), { step: 5, suffix: '°' });
    case 'integer':
      return numberField(Math.round(Number(value) || 0), (n) => onCommit(Math.round(n)), { step: 1 });
    case 'number':
      return numberField(Number(value) || 0, (n) => onCommit(n), { step: 0.1 });
    case 'boolean':
      return checkField(value === true || value === 1 || value === 'true', (b) => onCommit(b));
    case 'material':
      return colorField(/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#b9bec4', (c) => onCommit(c));
    case 'text':
      return textField(String(value ?? ''), (t) => onCommit(t));
  }
}

/** Valeur affichée d'un paramètre (lecture seule). */
export function formatParam(kind: ParamKind, value: unknown, units: Units): string {
  if (value === undefined || value === null) return '—';
  switch (kind) {
    case 'length':
      return formatLength(Number(value), units, true);
    case 'angle':
      return `${((Number(value) * 180) / Math.PI).toFixed(1)}°`;
    case 'boolean':
      return value ? 'Oui' : 'Non';
    case 'integer':
      return String(Math.round(Number(value)));
    case 'number':
      return String(Math.round(Number(value) * 1000) / 1000);
    default:
      return String(value);
  }
}

const exprText = (e: Expr | undefined): string => (e === undefined ? '' : typeof e === 'number' ? String(e) : e);
const parseExpr = (s: string): Expr => {
  const t = s.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
};

type Tab = 'params' | 'types' | 'solids' | 'symbols';

/**
 * Éditeur de famille. Les modifications sont appliquées au projet (annulables)
 * et toutes les occurrences se mettent à jour.
 */
export function familyEditor(app: App, familyId?: string): void {
  const p = app.project;
  let famId = familyId ?? p.families[0]?.id;
  let tab: Tab = 'params';
  let typeId: string | undefined;

  const fam = (): FamilyDef | undefined => p.family(famId ?? '');
  const edit = (label: string, fn: (f: FamilyDef) => void) => {
    const f = fam();
    if (!f) return;
    p.transact(label, () => fn(f));
    render();
  };

  const root = h('div', { class: 'fe' });
  const sidebar = h('div', { class: 'fe-side' });
  const main = h('div', { class: 'fe-main' });
  const preview = h('div', { class: 'fe-preview' });
  root.append(sidebar, main, preview);
  const pv = new FamilyPreview(preview);

  const renderSidebar = () => {
    clear(sidebar);
    const cats = new Map<string, FamilyDef[]>();
    for (const f of p.families) {
      const l = cats.get(f.category) ?? [];
      l.push(f);
      cats.set(f.category, l);
    }
    sidebar.append(
      h('div', { class: 'fe-side-actions' },
        h('button', { class: 'btn small primary', onclick: () => createFamily() }, '+ Nouvelle'),
        h('button', { class: 'btn small', onclick: () => importFamily() }, 'Importer…'),
      ),
    );
    for (const [cat, list] of [...cats].sort((a, b) => a[0].localeCompare(b[0]))) {
      sidebar.append(h('div', { class: 'tree-sub' }, cat));
      for (const f of list.sort((a, b) => a.name.localeCompare(b.name))) {
        const n = p.familyUsage(f.id);
        sidebar.append(
          h('div', { class: `tree-item${f.id === famId ? ' active' : ''}`, onclick: () => { famId = f.id; typeId = undefined; render(); } },
            h('span', { class: 'tree-label' }, f.name),
            n ? h('span', { class: 'tree-meta' }, String(n)) : null,
          ),
        );
      }
    }
  };

  const createFamily = async () => {
    const name = await promptDialog('Nouvelle famille', 'Nom de la famille :', 'Nouvelle famille');
    if (!name) return;
    const f = blankFamily(newId('fam'), name);
    p.transact('Nouvelle famille', (d) => (d.families = [...(d.families ?? []), f]));
    famId = f.id;
    render();
  };

  const importFamily = async () => {
    const file = await pickFile('.json,.ofam');
    if (!file) return;
    try {
      const f = JSON.parse(await file.text()) as FamilyDef;
      if (!f || !Array.isArray(f.params) || !Array.isArray(f.solids) || !Array.isArray(f.types)) throw new Error('Fichier de famille invalide');
      f.symbols = f.symbols ?? [];
      if (p.family(f.id)) f.id = newId('fam');
      p.transact('Importer une famille', (d) => (d.families = [...(d.families ?? []), f]));
      famId = f.id;
      render();
    } catch (e) {
      app.status(`Import impossible : ${(e as Error).message}`);
    }
  };

  const renderMain = () => {
    clear(main);
    const f = fam();
    if (!f) {
      main.append(h('p', { class: 'muted' }, 'Aucune famille. Créez-en une.'));
      return;
    }
    const type = f.types.find((t) => t.id === typeId) ?? f.types[0];
    typeId = type?.id;
    const result = evaluateFamily(f, typeId);
    pv.show(result);

    const used = p.familyUsage(f.id);
    main.append(
      h('div', { class: 'fe-head' },
        textField(f.name, (v) => edit('Renommer la famille', (x) => (x.name = v || x.name))),
        h('span', { class: 'muted' }, 'Catégorie'),
        selectField(f.category, ['Mobilier', 'Sanitaire', 'Cuisine', 'Équipement', 'Extérieur', 'Modèle générique'].map((c) => ({ value: c, label: c })), (v) => edit('Catégorie', (x) => (x.category = v))),
      ),
      h('div', { class: 'fe-actions' },
        h('button', { class: 'btn small primary', onclick: () => { app.setOptions({ componentFamily: f.id, componentTypeId: typeId ?? '' }); app.setTool('component'); closeDialog(); } }, 'Placer dans le projet'),
        h('button', { class: 'btn small', onclick: () => duplicateFamily(f) }, 'Dupliquer'),
        h('button', { class: 'btn small', onclick: () => download(`${safeName(f.name)}.ofam.json`, JSON.stringify(f, null, 2), 'application/json') }, 'Exporter'),
        h('button', {
          class: 'btn small danger',
          disabled: used > 0,
          title: used ? `${used} occurrence(s) dans le projet` : '',
          onclick: async () => {
            if (!(await confirmDialog('Supprimer la famille', `Supprimer « ${f.name} » du projet ?`, 'Supprimer'))) return;
            p.transact('Supprimer la famille', (d) => (d.families = (d.families ?? []).filter((x) => x.id !== f.id)));
            famId = p.families[0]?.id;
            render();
          },
        }, 'Supprimer'),
        used ? h('span', { class: 'muted' }, `${used} occurrence(s) dans le projet`) : null,
      ),
      h('div', { class: 'fe-type-bar' },
        h('span', { class: 'muted' }, 'Type courant'),
        selectField(typeId ?? '', f.types.map((t) => ({ value: t.id, label: t.name })), (v) => { typeId = v; render(); }),
      ),
      h('div', { class: 'modal-tabs' },
        ...([['params', 'Paramètres'], ['types', 'Types'], ['solids', 'Volumes 3D'], ['symbols', 'Symboles 2D']] as [Tab, string][]).map(([k, label]) =>
          h('button', { class: `modal-tab${tab === k ? ' active' : ''}`, onclick: () => { tab = k; render(); } }, label),
        ),
      ),
    );
    if (result.errors.length) main.append(h('div', { class: 'fe-errors' }, ...result.errors.slice(0, 6).map((e) => h('div', {}, `⚠ ${e}`))));
    if (tab === 'params') main.append(paramsTab(f, type?.id, result));
    else if (tab === 'types') main.append(typesTab(f));
    else if (tab === 'solids') main.append(solidsTab(f));
    else main.append(symbolsTab(f));
  };

  const duplicateFamily = (f: FamilyDef) => {
    const copy = { ...structuredClone(f), id: newId('fam'), name: `${f.name} (copie)` };
    p.transact('Dupliquer la famille', (d) => (d.families = [...(d.families ?? []), copy]));
    famId = copy.id;
    render();
  };

  // --- Paramètres --------------------------------------------------------
  const paramsTab = (f: FamilyDef, tId: string | undefined, result: FamilyResult): HTMLElement => {
    const u = p.data.units;
    const table = h('table', { class: 'edit-table fe-table' });
    table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Type de donnée'), h('th', {}, 'Portée'), h('th', {}, 'Valeur (type courant)'), h('th', {}, 'Formule'), h('th', {}, ''))));
    const tb = h('tbody');
    f.params.forEach((prm, idx) => {
      const formulaInput = textField(prm.formula ?? '', (v) =>
        edit('Formule', (x) => {
          const q = x.params[idx];
          q.formula = v.trim() || undefined;
        }),
      );
      formulaInput.placeholder = 'ex. Longueur / 2';
      const err = prm.formula ? checkFormula(f, prm.formula) : null;
      if (err) formulaInput.classList.add('invalid');
      formulaInput.title = err ?? '';
      const valueCell = prm.formula
        ? h('span', { class: 'prop-readonly' }, `= ${formatParam(prm.kind, result.values[prm.name], u)}`)
        : paramField(prm.kind, prm.scope === 'type' && tId ? f.types.find((t) => t.id === tId)?.values[prm.name] ?? prm.value : prm.value, u, (v) =>
            edit('Valeur du paramètre', (x) => {
              const q = x.params[idx];
              if (q.scope === 'type') {
                const t = x.types.find((tt) => tt.id === tId);
                if (t) t.values[q.name] = v;
                else q.value = v;
              } else {
                q.value = v;
              }
            }),
          );
      tb.append(
        h('tr', {},
          h('td', {}, textField(prm.name, (v) => {
            const name = v.trim();
            if (!name || name === prm.name || f.params.some((q) => q.name === name)) return render();
            edit('Renommer le paramètre', (x) => renameParam(x, prm.name, name));
          })),
          h('td', {}, selectField(prm.kind, PARAM_KINDS, (v) => edit('Type de paramètre', (x) => { x.params[idx].kind = v; x.params[idx].value = defaultFor(v); }))),
          h('td', {}, selectField(prm.scope, [{ value: 'type', label: 'Type' }, { value: 'instance', label: 'Occurrence' }], (v) => edit('Portée', (x) => (x.params[idx].scope = v)))),
          h('td', {}, valueCell),
          h('td', {}, formulaInput),
          h('td', { class: 'nowrap' },
            h('button', { class: 'mini-btn', title: 'Monter', disabled: idx === 0, onclick: () => edit('Ordre', (x) => x.params.splice(idx - 1, 0, x.params.splice(idx, 1)[0])) }, '↑'),
            h('button', { class: 'mini-btn', title: 'Supprimer', onclick: () => edit('Supprimer le paramètre', (x) => x.params.splice(idx, 1)) }, '×'),
          ),
        ),
      );
    });
    table.append(tb);
    const add = (kind: ParamKind) =>
      edit('Ajouter un paramètre', (x) => {
        let i = x.params.length + 1;
        while (x.params.some((q) => q.name === `Paramètre ${i}`)) i++;
        x.params.push({ name: `Paramètre ${i}`, kind, scope: 'type', value: defaultFor(kind) });
      });
    return h('div', {},
      table,
      h('div', { class: 'modal-actions left' },
        h('span', { class: 'muted' }, 'Ajouter :'),
        ...PARAM_KINDS.map((k) => h('button', { class: 'btn small', onclick: () => add(k.value) }, k.label)),
      ),
      h('p', { class: 'muted' }, 'Formules : + − × / ^, comparaisons, et/ou/non, if(condition ; si vrai ; si faux), min, max, round, rounddown, roundup, sqrt, sin, cos… Unités acceptées : mm, cm, m, °. Noms avec espaces entre crochets : [Hauteur assise].'),
    );
  };

  // --- Types -------------------------------------------------------------
  const typesTab = (f: FamilyDef): HTMLElement => {
    const u = p.data.units;
    const typeParams = f.params.filter((q) => q.scope === 'type' && !q.formula);
    const table = h('table', { class: 'edit-table fe-table' });
    table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Type'), ...typeParams.map((q) => h('th', {}, q.name)), h('th', {}, 'Occ.'), h('th', {}, ''))));
    const tb = h('tbody');
    f.types.forEach((t, ti) => {
      tb.append(
        h('tr', {},
          h('td', {}, textField(t.name, (v) => edit('Renommer le type', (x) => (x.types[ti].name = v || x.types[ti].name)))),
          ...typeParams.map((q) => h('td', {}, paramField(q.kind, t.values[q.name] ?? q.value, u, (v) => edit('Valeur de type', (x) => (x.types[ti].values[q.name] = v))))),
          h('td', {}, String(p.familyUsage(f.id, t.id))),
          h('td', { class: 'nowrap' },
            h('button', { class: 'btn small', onclick: () => edit('Dupliquer le type', (x) => x.types.push({ id: newId('t'), name: `${t.name} (2)`, values: { ...t.values } })) }, 'Dupliquer'),
            ' ',
            h('button', {
              class: 'btn small danger',
              disabled: f.types.length <= 1 || p.familyUsage(f.id, t.id) > 0,
              onclick: () => edit('Supprimer le type', (x) => x.types.splice(ti, 1)),
            }, 'Supprimer'),
          ),
        ),
      );
    });
    table.append(tb);
    return h('div', {}, h('div', { class: 'fe-scroll' }, table), h('p', { class: 'muted' }, 'Chaque type fixe les valeurs des paramètres de type ; les occurrences d’un même type partagent ces valeurs.'));
  };

  // --- Volumes ---------------------------------------------------------------
  const exprInput = (f: FamilyDef, value: Expr | undefined, onCommit: (e: Expr | undefined) => void, placeholder = '', optional = false): HTMLInputElement => {
    const input = textField(exprText(value), (v) => onCommit(v.trim() === '' && optional ? undefined : parseExpr(v === '' ? '0' : v)));
    input.placeholder = placeholder;
    input.classList.add('fe-expr');
    const src = exprText(value);
    if (src && typeof value === 'string') {
      const err = checkFormula(f, src, true);
      if (err) {
        input.classList.add('invalid');
        input.title = err;
      } else {
        const r = tryEval(src, (n) => (n === 'i' ? 0 : evaluateFamily(f, typeId).values[n]));
        input.title = r.error ?? `= ${typeof r.value === 'number' ? Math.round(r.value * 1000) / 1000 : r.value}`;
      }
    }
    return input;
  };

  const solidsTab = (f: FamilyDef): HTMLElement => {
    const mats = f.params.filter((q) => q.kind === 'material').map((q) => ({ value: q.name, label: `Param. ${q.name}` }));
    const list = h('div', { class: 'fe-cards' });
    f.solids.forEach((s, si) => {
      const set = (label: string, fn: (x: FamilySolid) => void) => edit(label, (x) => fn(x.solids[si]));
      const matIsColor = /^#/.test(s.material);
      list.append(
        h('div', { class: 'fe-card' },
          h('div', { class: 'fe-card-head' },
            textField(s.name ?? `Volume ${si + 1}`, (v) => set('Nom du volume', (x) => (x.name = v))),
            selectField(s.shape, [{ value: 'box', label: 'Boîte' }, { value: 'cylinder', label: 'Cylindre' }], (v) => set('Forme', (x) => (x.shape = v))),
            h('label', { class: 'vg-item' }, checkField(!!s.glass, (v) => set('Vitrage', (x) => (x.glass = v))), 'Vitré'),
            h('button', { class: 'mini-btn', title: 'Dupliquer', onclick: () => edit('Dupliquer le volume', (x) => x.solids.splice(si + 1, 0, { ...structuredClone(s), id: newId('s') })) }, '⧉'),
            h('button', { class: 'mini-btn', title: 'Supprimer', onclick: () => edit('Supprimer le volume', (x) => x.solids.splice(si, 1)) }, '×'),
          ),
          h('div', { class: 'fe-grid' },
            ...(['x0', 'x1', 'y0', 'y1', 'z0', 'z1'] as const).flatMap((k) => [
              h('span', { class: 'fe-lbl' }, { x0: 'X min', x1: 'X max', y0: 'Y min', y1: 'Y max', z0: 'Z bas', z1: 'Z haut' }[k]),
              exprInput(f, s[k], (v) => set('Géométrie', (x) => (x[k] = v ?? 0))),
            ]),
            h('span', { class: 'fe-lbl' }, 'Matériau'),
            h('span', { class: 'opt-inline' },
              selectField(matIsColor ? '#' : s.material, [{ value: '#', label: 'Couleur fixe' }, ...mats], (v) => set('Matériau', (x) => (x.material = v === '#' ? '#b9bec4' : v))),
              matIsColor ? colorField(s.material, (c) => set('Couleur', (x) => (x.material = c))) : null,
            ),
            h('span', { class: 'fe-lbl' }, 'Visible si'),
            exprInput(f, s.visible, (v) => set('Visibilité', (x) => (x.visible = v)), 'toujours', true),
            h('span', { class: 'fe-lbl' }, 'Répétition'),
            exprInput(f, s.count, (v) => set('Répétition', (x) => (x.count = v)), '1', true),
            h('span', { class: 'fe-lbl' }, 'Pas X / Y / Z'),
            h('span', { class: 'fe-triple' },
              exprInput(f, s.dx, (v) => set('Pas', (x) => (x.dx = v)), '0', true),
              exprInput(f, s.dy, (v) => set('Pas', (x) => (x.dy = v)), '0', true),
              exprInput(f, s.dz, (v) => set('Pas', (x) => (x.dz = v)), '0', true),
            ),
          ),
        ),
      );
    });
    return h('div', {},
      list,
      h('div', { class: 'modal-actions left' },
        h('button', {
          class: 'btn small primary',
          onclick: () => edit('Ajouter un volume', (x) => x.solids.push({ id: newId('s'), name: `Volume ${x.solids.length + 1}`, shape: 'box', x0: -0.25, x1: 0.25, y0: -0.25, y1: 0.25, z0: 0, z1: 0.5, material: '#b9bec4' })),
        }, '+ Volume'),
      ),
      h('p', { class: 'muted' }, 'Coordonnées locales en mètres (origine = point d’insertion, Y vers l’arrière). Chaque valeur accepte une formule ; « i » vaut l’indice de l’exemplaire dans une répétition.'),
    );
  };

  // --- Symboles 2D --------------------------------------------------------
  const symbolsTab = (f: FamilyDef): HTMLElement => {
    const list = h('div', { class: 'fe-cards' });
    f.symbols.forEach((s, si) => {
      const set = (label: string, fn: (x: FamilySymbol) => void) => edit(label, (x) => fn(x.symbols[si]));
      const labels = s.shape === 'circle' ? ['Centre X', 'Centre Y', 'Rayon', '—'] : s.shape === 'line' ? ['X début', 'Y début', 'X fin', 'Y fin'] : ['X coin 1', 'Y coin 1', 'X coin 2', 'Y coin 2'];
      list.append(
        h('div', { class: 'fe-card' },
          h('div', { class: 'fe-card-head' },
            selectField(s.shape, [{ value: 'line', label: 'Ligne' }, { value: 'rect', label: 'Rectangle' }, { value: 'circle', label: 'Cercle' }], (v) => set('Forme', (x) => (x.shape = v))),
            h('button', { class: 'mini-btn', title: 'Supprimer', onclick: () => edit('Supprimer le symbole', (x) => x.symbols.splice(si, 1)) }, '×'),
          ),
          h('div', { class: 'fe-grid' },
            ...(['x0', 'y0', 'x1', 'y1'] as const).flatMap((k, i) =>
              s.shape === 'circle' && k === 'y1' ? [] : [h('span', { class: 'fe-lbl' }, labels[i]), exprInput(f, s[k], (v) => set('Symbole', (x) => (x[k] = v ?? 0)))],
            ),
            h('span', { class: 'fe-lbl' }, 'Visible si'),
            exprInput(f, s.visible, (v) => set('Visibilité', (x) => (x.visible = v)), 'toujours', true),
            h('span', { class: 'fe-lbl' }, 'Répétition / pas X / Y'),
            h('span', { class: 'fe-triple' },
              exprInput(f, s.count, (v) => set('Répétition', (x) => (x.count = v)), '1', true),
              exprInput(f, s.dx, (v) => set('Pas', (x) => (x.dx = v)), '0', true),
              exprInput(f, s.dy, (v) => set('Pas', (x) => (x.dy = v)), '0', true),
            ),
          ),
        ),
      );
    });
    return h('div', {},
      h('label', { class: 'vg-item' }, checkField(f.autoSymbol, (v) => edit('Symbole automatique', (x) => (x.autoSymbol = v))), 'Ajouter automatiquement le contour des volumes (vue de dessus)'),
      list,
      h('div', { class: 'modal-actions left' },
        h('button', { class: 'btn small primary', onclick: () => edit('Ajouter un symbole', (x) => x.symbols.push({ id: newId('p'), shape: 'rect', x0: -0.25, y0: -0.25, x1: 0.25, y1: 0.25 })) }, '+ Symbole'),
      ),
    );
  };

  const render = () => {
    renderSidebar();
    renderMain();
  };

  render();
  const closeDialog = modal('Éditeur de familles', root, { wide: true, onClose: () => pv.dispose() });
  root.closest('.modal')?.classList.add('xwide');
}

function defaultFor(kind: ParamKind): ParamValue {
  switch (kind) {
    case 'boolean':
      return true;
    case 'material':
      return '#b9bec4';
    case 'text':
      return '';
    case 'integer':
      return 1;
    case 'length':
      return 0.5;
    default:
      return 0;
  }
}

/** Aperçu de la famille : symbole en plan (2D) et volumes (3D en orbite). */
class FamilyPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  private controls: OrbitControls | null = null;
  private group = new THREE.Group();
  private plan: HTMLCanvasElement;
  private frame = 0;

  constructor(root: HTMLElement) {
    this.plan = h('canvas', { class: 'fe-plan', width: 300, height: 220 });
    const view3d = h('div', { class: 'fe-3d' });
    root.append(h('div', { class: 'fe-pv-title' }, 'Plan'), this.plan, h('div', { class: 'fe-pv-title' }, '3D'), view3d);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setSize(300, 260);
      this.renderer.setPixelRatio(window.devicePixelRatio || 1);
      view3d.append(this.renderer.domElement);
      this.scene.background = new THREE.Color('#eef2f6');
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888877, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.2);
      sun.position.set(3, 5, 2);
      this.scene.add(sun, this.group);
      const grid = new THREE.GridHelper(6, 12, 0xc0c6cc, 0xdde2e6);
      this.scene.add(grid);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.addEventListener('change', () => this.render());
    } catch {
      view3d.append(h('p', { class: 'muted' }, 'Aperçu 3D indisponible (WebGL).'));
    }
  }

  show(r: FamilyResult): void {
    this.drawPlan(r);
    this.build3D(r);
  }

  private drawPlan(r: FamilyResult): void {
    const c = this.plan;
    const dpr = window.devicePixelRatio || 1;
    c.width = 300 * dpr;
    c.height = 220 * dpr;
    c.style.width = '300px';
    c.style.height = '220px';
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 300, 220);
    const b = r.bounds;
    const w = Math.max(0.1, b.x1 - b.x0);
    const d = Math.max(0.1, b.y1 - b.y0);
    const s = Math.min(260 / w, 180 / d);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const X = (x: number) => 150 + (x - cx) * s;
    const Y = (y: number) => 110 - (y - cy) * s;
    ctx.strokeStyle = '#d0d5da';
    ctx.beginPath();
    ctx.moveTo(X(0) - 8, Y(0));
    ctx.lineTo(X(0) + 8, Y(0));
    ctx.moveTo(X(0), Y(0) - 8);
    ctx.lineTo(X(0), Y(0) + 8);
    ctx.stroke();
    ctx.strokeStyle = '#2b2f33';
    ctx.lineWidth = 1;
    for (const p of r.prims) {
      ctx.beginPath();
      if (p.t === 'line') {
        ctx.moveTo(X(p.x0), Y(p.y0));
        ctx.lineTo(X(p.x1), Y(p.y1));
      } else if (p.t === 'rect') {
        ctx.rect(Math.min(X(p.x0), X(p.x1)), Math.min(Y(p.y0), Y(p.y1)), Math.abs(X(p.x1) - X(p.x0)), Math.abs(Y(p.y1) - Y(p.y0)));
      } else {
        ctx.arc(X(p.cx), Y(p.cy), p.r * s, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#687078';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${Math.round(w * 100)} × ${Math.round(d * 100)} cm`, 8, 212);
  }

  private build3D(r: FamilyResult): void {
    if (!this.renderer) return;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.group.clear();
    for (const b of r.boxes) {
      const geo =
        b.shape === 'cylinder'
          ? new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
          : new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshLambertMaterial({ color: b.color, transparent: b.glass, opacity: b.glass ? 0.4 : 1 });
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0);
      m.position.set((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, -(b.y0 + b.y1) / 2);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x33373b, transparent: true, opacity: 0.5 }));
      m.add(edges);
      this.group.add(m);
    }
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    if (this.controls) {
      this.controls.target.copy(center);
      this.camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(size * 1.4 + 0.5));
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
    this.render();
  }

  private render(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.renderer?.render(this.scene, this.camera));
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}

