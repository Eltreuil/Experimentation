import { viewKey, type App } from '../app';
import { KIND_LABELS, type ElementKind, type ViewSettings } from '../model/types';
import { addLevel, copyWallsToLevel, deleteLevel } from '../commands';
import { newId } from '../model/project';
import type { DoorType, WallType, WindowType } from '../model/types';
import { clear, h } from './dom';
import { colorField, lengthField, selectField, textField } from './fields';

export function modal(title: string, body: HTMLElement, opts: { wide?: boolean; onClose?: () => void } = {}): () => void {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const backdrop: HTMLDivElement = h(
    'div',
    { class: 'modal-backdrop', onmousedown: (e: Event) => e.target === backdrop && close() },
    h(
      'div',
      { class: `modal${opts.wide ? ' wide' : ''}`, role: 'dialog' },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'tab-close', onclick: close, title: 'Fermer' }, '×')),
      h('div', { class: 'modal-body' }, body),
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  return close;
}

export function confirmDialog(title: string, message: string, ok = 'Confirmer'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const body = h(
      'div',
      {},
      h('p', {}, message),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => finish(false) }, 'Annuler'),
        h('button', { class: 'btn primary', onclick: () => finish(true) }, ok),
      ),
    );
    const close = modal(title, body, { onClose: () => finish(false) });
  });
}

/** Demande une saisie de texte (remplace window.prompt, indisponible dans certaines intégrations). */
export function promptDialog(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { type: 'text', class: 'prop-input', value });
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(input.value.trim() || null);
    });
    const body = h(
      'div',
      {},
      h('label', { class: 'prompt-label' }, label),
      input,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => finish(null) }, 'Annuler'),
        h('button', { class: 'btn primary', onclick: () => finish(input.value.trim() || null) }, 'OK'),
      ),
    );
    const close = modal(title, body, { onClose: () => finish(null) });
    setTimeout(() => input.focus(), 0);
  });
}

/** Gestion des niveaux : nom, altitude, hauteur, ajout/suppression. */
export function levelsDialog(app: App): void {
  const body = h('div');
  const render = () => {
    clear(body);
    const p = app.project;
    const u = p.data.units;
    const table = h('table', { class: 'edit-table' });
    table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, `Altitude (${u})`), h('th', {}, `Hauteur (${u})`), h('th', {}, ''))));
    const tb = h('tbody');
    for (const l of [...p.sortedLevels()].reverse()) {
      tb.append(
        h(
          'tr',
          {},
          h('td', {}, textField(l.name, (v) => p.transact('Renommer le niveau', () => (l.name = v || l.name)))),
          h('td', {}, lengthField(l.elevation, u, (m) => { p.transact('Altitude', () => (l.elevation = m)); render(); })),
          h('td', {}, lengthField(l.height, u, (m) => p.transact('Hauteur', () => (l.height = m)), { min: 0.5 })),
          h(
            'td',
            {},
            h('button', {
              class: 'btn small danger',
              disabled: p.data.levels.length <= 1,
              onclick: async () => {
                const n = p.elements.filter((e) => 'levelId' in e && e.levelId === l.id).length;
                if (n && !(await confirmDialog('Supprimer le niveau', `Le niveau « ${l.name} » contient ${n} élément(s) qui seront supprimés.`, 'Supprimer'))) return;
                deleteLevel(app, l.id);
                render();
              },
            }, 'Supprimer'),
          ),
        ),
      );
    }
    table.append(tb);
    const levels = p.sortedLevels();
    const from = selectField(levels[0].id, levels.map((l) => ({ value: l.id, label: l.name })), () => {});
    const to = selectField(levels[levels.length - 1].id, levels.map((l) => ({ value: l.id, label: l.name })), () => {});
    body.append(
      table,
      h('div', { class: 'modal-actions left' }, h('button', { class: 'btn primary', onclick: () => { addLevel(app); render(); } }, '+ Ajouter un niveau')),
      h('h4', {}, 'Copier les murs extérieurs vers un autre niveau'),
      h('div', { class: 'inline-form' },
        h('span', {}, 'De'), from, h('span', {}, 'vers'), to,
        h('button', {
          class: 'btn',
          onclick: () => {
            if (from.value === to.value) return;
            const n = copyWallsToLevel(app, from.value, to.value);
            app.status(`${n} mur(s) copié(s).`);
          },
        }, 'Copier'),
      ),
    );
  };
  render();
  modal('Niveaux', body, { wide: true });
}

/** Éditeur de types (familles système) : murs, portes, fenêtres. */
export function typesDialog(app: App, initial: 'wall' | 'door' | 'window' = 'wall'): void {
  let tab = initial;
  const body = h('div');
  const render = () => {
    clear(body);
    const p = app.project;
    const u = p.data.units;
    const tabs = h(
      'div',
      { class: 'modal-tabs' },
      ...(['wall', 'door', 'window'] as const).map((k) =>
        h('button', { class: `modal-tab${tab === k ? ' active' : ''}`, onclick: () => { tab = k; render(); } }, { wall: 'Murs', door: 'Portes', window: 'Fenêtres' }[k]),
      ),
    );
    const table = h('table', { class: 'edit-table' });
    const tb = h('tbody');
    const used = (id: string) => p.elements.some((e) => 'typeId' in e && e.typeId === id);
    const actions = (id: string, dup: () => void, del: () => void) =>
      h('td', { class: 'nowrap' },
        h('button', { class: 'btn small', onclick: () => { dup(); render(); } }, 'Dupliquer'),
        ' ',
        h('button', { class: 'btn small danger', disabled: used(id), title: used(id) ? 'Type utilisé dans le projet' : '', onclick: () => { del(); render(); } }, 'Supprimer'),
      );
    if (tab === 'wall') {
      table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Épaisseur'), h('th', {}, 'Fonction'), h('th', {}, 'Couleur'), h('th', {}, ''))));
      for (const t of p.data.wallTypes) {
        tb.append(h('tr', {},
          h('td', {}, textField(t.name, (v) => p.transact('Type', () => (t.name = v || t.name)))),
          h('td', {}, lengthField(t.thickness, u, (m) => p.transact('Type', () => (t.thickness = m)), { min: 0.01 })),
          h('td', {}, selectField(t.function, [{ value: 'exterior', label: 'Extérieur' }, { value: 'interior', label: 'Intérieur' }], (v) => p.transact('Type', () => (t.function = v)))),
          h('td', {}, colorField(t.color, (v) => p.transact('Type', () => (t.color = v)))),
          actions(t.id,
            () => p.transact('Dupliquer le type', (d) => d.wallTypes.push({ ...t, id: newId('wt'), name: `${t.name} (2)` } as WallType)),
            () => p.transact('Supprimer le type', (d) => (d.wallTypes = d.wallTypes.filter((x) => x.id !== t.id)))),
        ));
      }
    } else if (tab === 'door') {
      table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Largeur'), h('th', {}, 'Hauteur'), h('th', {}, 'Couleur'), h('th', {}, ''))));
      for (const t of p.data.doorTypes) {
        tb.append(h('tr', {},
          h('td', {}, textField(t.name, (v) => p.transact('Type', () => (t.name = v || t.name)))),
          h('td', {}, lengthField(t.width, u, (m) => p.transact('Type', () => (t.width = m)), { min: 0.3 })),
          h('td', {}, lengthField(t.height, u, (m) => p.transact('Type', () => (t.height = m)), { min: 0.5 })),
          h('td', {}, colorField(t.color, (v) => p.transact('Type', () => (t.color = v)))),
          actions(t.id,
            () => p.transact('Dupliquer le type', (d) => d.doorTypes.push({ ...t, id: newId('dt'), name: `${t.name} (2)` } as DoorType)),
            () => p.transact('Supprimer le type', (d) => (d.doorTypes = d.doorTypes.filter((x) => x.id !== t.id)))),
        ));
      }
    } else {
      table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Largeur'), h('th', {}, 'Hauteur'), h('th', {}, 'Allège'), h('th', {}, 'Cadre'), h('th', {}, ''))));
      for (const t of p.data.windowTypes) {
        tb.append(h('tr', {},
          h('td', {}, textField(t.name, (v) => p.transact('Type', () => (t.name = v || t.name)))),
          h('td', {}, lengthField(t.width, u, (m) => p.transact('Type', () => (t.width = m)), { min: 0.2 })),
          h('td', {}, lengthField(t.height, u, (m) => p.transact('Type', () => (t.height = m)), { min: 0.2 })),
          h('td', {}, lengthField(t.sill, u, (m) => p.transact('Type', () => (t.sill = m)), { min: 0 })),
          h('td', {}, colorField(t.color, (v) => p.transact('Type', () => (t.color = v)))),
          actions(t.id,
            () => p.transact('Dupliquer le type', (d) => d.windowTypes.push({ ...t, id: newId('wn'), name: `${t.name} (2)` } as WindowType)),
            () => p.transact('Supprimer le type', (d) => (d.windowTypes = d.windowTypes.filter((x) => x.id !== t.id)))),
        ));
      }
    }
    table.append(tb);
    body.append(tabs, table, h('p', { class: 'muted' }, 'Les modifications de type s’appliquent à toutes les occurrences du projet. Un type utilisé ne peut pas être supprimé.'));
  };
  render();
  modal('Types de familles', body, { wide: true });
}

/** Visibilité/Graphismes (VG) : catégories affichées, échelle et sous-couche de la vue active. */
export function visibilityDialog(app: App): void {
  const key = viewKey(app.view);
  if (app.view.kind === 'schedule') {
    app.status('Les nomenclatures n’ont pas de réglages de visibilité.');
    return;
  }
  const p = app.project;
  const isPlan = app.view.kind === 'plan';
  const body = h('div');
  const settings = (): ViewSettings => p.data.viewSettings?.[key] ?? {};
  const update = (patch: Partial<ViewSettings>) =>
    p.transact('Visibilité/Graphismes', (d) => {
      d.viewSettings = d.viewSettings ?? {};
      d.viewSettings[key] = { ...(d.viewSettings[key] ?? {}), ...patch };
    });
  const render = () => {
    clear(body);
    const hidden = new Set(settings().hidden ?? []);
    const kinds = (Object.keys(KIND_LABELS) as ElementKind[]).filter((k) => isPlan || !['dimension', 'grid', 'room', 'text', 'section'].includes(k));
    const grid = h('div', { class: 'vg-grid' });
    for (const k of kinds) {
      const c = h('input', { type: 'checkbox', checked: !hidden.has(k) });
      c.addEventListener('change', () => {
        const next = new Set(settings().hidden ?? []);
        if (c.checked) next.delete(k);
        else next.add(k);
        update({ hidden: [...next] });
      });
      grid.append(h('label', { class: 'vg-item' }, c, KIND_LABELS[k]));
    }
    body.append(
      h('h4', { style: 'margin-top:0' }, 'Catégories de modèle et d’annotation'),
      grid,
      h('div', { class: 'modal-actions left' },
        h('button', { class: 'btn small', onclick: () => { update({ hidden: [] }); render(); } }, 'Tout afficher'),
        h('button', { class: 'btn small', onclick: () => { update({ hidden: [...kinds] }); render(); } }, 'Tout masquer'),
      ),
    );
    if (isPlan) {
      const scales = [20, 50, 100, 200, 500].map((n) => ({ value: String(n), label: `1/${n}` }));
      const und = h('input', { type: 'checkbox', checked: settings().underlay !== false });
      und.addEventListener('change', () => update({ underlay: und.checked }));
      body.append(
        h('h4', {}, 'Vue'),
        h('div', { class: 'inline-form' },
          h('span', {}, 'Échelle'),
          selectField(String(settings().scale ?? 100), scales, (v) => update({ scale: parseInt(v, 10) })),
          h('label', { class: 'vg-item' }, und, 'Afficher le niveau inférieur en grisé'),
        ),
      );
    }
  };
  render();
  modal(`Visibilité/Graphismes — ${viewKeyLabel(app)}`, body, { wide: true });
}

function viewKeyLabel(app: App): string {
  const v = app.view;
  if (v.kind === 'plan') return `Plan : ${app.project.level(v.levelId)?.name ?? ''}`;
  if (v.kind === '3d') return 'Vue 3D';
  if (v.kind === 'elevation') return 'Élévation';
  if (v.kind === 'section') return app.project.get<'section'>(v.sectionId)?.name ?? 'Coupe';
  return '';
}

/** Informations du projet reprises dans le cartouche des feuilles. */
export function projectInfoDialog(app: App): void {
  const p = app.project;
  const info = () => p.data.info ?? {};
  const set = (k: keyof NonNullable<typeof p.data.info>, v: string) =>
    p.transact('Informations du projet', (d) => {
      d.info = { ...(d.info ?? {}), [k]: v || undefined };
    });
  const body = h(
    'div',
    {},
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Nom du projet'), textField(p.data.name, (v) => p.transact('Nom du projet', (d) => (d.name = v || d.name)))),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Maître d’ouvrage'), textField(info().client ?? '', (v) => set('client', v))),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Adresse'), textField(info().address ?? '', (v) => set('address', v))),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Auteur'), textField(info().author ?? '', (v) => set('author', v))),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Numéro de projet'), textField(info().number ?? '', (v) => set('number', v))),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Phase'), textField(info().phase ?? '', (v) => set('phase', v))),
    h('p', { class: 'muted' }, 'Ces informations apparaissent dans le cartouche des feuilles imprimées et exportées.'),
  );
  modal('Informations du projet', body);
}

export function helpDialog(): void {
  const shortcuts: [string, string][] = [
    ['MU / PO / FE', 'Mur / Porte / Fenêtre'],
    ['OU / TR', 'Ouverture dans un mur / Trémie'],
    ['CP / PT', 'Composant (mobilier, sanitaires) / Poteau'],
    ['SO / TO / FP', 'Sol / Toit / Faux-plafond'],
    ['ES / GC', 'Escalier / Garde-corps'],
    ['PI / QU', 'Pièce / Quadrillage'],
    ['CO / CM', 'Cote alignée / Cotes en chaîne d’un mur'],
    ['TX / CE', 'Texte / Coupe'],
    ['ME', 'Mesurer'],
    ['AL / DE', 'Aligner / Décaler'],
    ['AJ / PR / SC', 'Ajuster en angle / Prolonger / Scinder'],
    ['DP / CC / RO', 'Déplacer / Copier / Rotation (sur la sélection)'],
    ['SY / RS', 'Symétrie / Réseau (sur la sélection)'],
    ['AH', 'Attacher le haut des murs sélectionnés au toit'],
    ['VG / ZE', 'Visibilité-graphismes / Zoom étendu'],
    ['MO', 'Modifier (sélection)'],
    ['Ctrl+Z / Ctrl+Y', 'Annuler / Rétablir'],
    ['Ctrl+C / Ctrl+V / Ctrl+A', 'Copier / Coller / Tout sélectionner'],
    ['Ctrl+S / Ctrl+O', 'Enregistrer / Ouvrir'],
    ['Suppr', 'Supprimer la sélection'],
    ['Échap / clic droit', 'Terminer la saisie, puis revenir à la sélection'],
    ['Maj (pendant un tracé)', 'Forcer l’orthogonalité'],
    ['Alt (pendant un tracé)', 'Désactiver l’accrochage'],
    ['Chiffres + Entrée', 'Saisir une longueur (ou un angle en rotation)'],
    ['Espace', 'Pivoter un composant/poteau ; placer le centre de rotation'],
    ['Molette / clic milieu', 'Zoom / panoramique'],
  ];
  const body = h(
    'div',
    {},
    h('p', {}, 'OpenBIM Studio est un modeleur BIM inspiré de Revit : dessinez en plan, le modèle 3D, les élévations et les nomenclatures se mettent à jour automatiquement.'),
    h('table', { class: 'edit-table' }, h('tbody', {}, ...shortcuts.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))))),
  );
  modal('Aide et raccourcis', body);
}
