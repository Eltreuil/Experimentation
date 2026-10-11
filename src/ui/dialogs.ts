import type { App } from '../app';
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

export function helpDialog(): void {
  const shortcuts: [string, string][] = [
    ['MU', 'Mur'],
    ['PO', 'Porte'],
    ['FE', 'Fenêtre'],
    ['PT', 'Poteau'],
    ['SO', 'Sol'],
    ['TO', 'Toit'],
    ['ES', 'Escalier'],
    ['PI', 'Pièce'],
    ['CO', 'Cote'],
    ['QU', 'Quadrillage'],
    ['MO', 'Modifier (sélection)'],
    ['ZE', 'Zoom étendu'],
    ['RO', 'Rotation de 90° de la sélection'],
    ['Ctrl+Z / Ctrl+Y', 'Annuler / Rétablir'],
    ['Ctrl+C / Ctrl+V', 'Copier / Coller'],
    ['Ctrl+S', 'Enregistrer le projet'],
    ['Suppr', 'Supprimer la sélection'],
    ['Échap / clic droit', 'Terminer la saisie, puis revenir à la sélection'],
    ['Maj (pendant un tracé)', 'Forcer l’orthogonalité'],
    ['Alt (pendant un tracé)', 'Désactiver l’accrochage'],
    ['Chiffres + Entrée', 'Saisir une longueur pendant un tracé'],
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
