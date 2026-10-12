import type { App } from '../app';
import { copySelection, paste } from '../commands';
import { duplicate } from '../model/edit';
import { isHosted, levelOf } from '../model/project';
import type { Element, Id } from '../model/types';
import { modal, visibilityDialog } from './dialogs';
import { clear, h } from './dom';

export interface MenuItem {
  label: string;
  hint?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}

let current: HTMLElement | null = null;

export function closeMenu(): void {
  current?.remove();
  current = null;
}

/** Affiche un menu contextuel à la position de l'écran donnée. */
export function showMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' });
  for (const it of items) {
    if (it.separator) {
      menu.append(h('div', { class: 'ctx-sep' }));
      continue;
    }
    menu.append(
      h(
        'button',
        {
          class: `ctx-item${it.danger ? ' danger' : ''}`,
          disabled: !!it.disabled,
          onclick: () => {
            closeMenu();
            it.action?.();
          },
        },
        h('span', {}, it.label),
        it.hint ? h('span', { class: 'ctx-hint' }, it.hint) : null,
      ),
    );
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  current = menu;
  const off = (e: Event) => {
    if (current && e.target instanceof Node && current.contains(e.target)) return;
    closeMenu();
    window.removeEventListener('pointerdown', off, true);
    window.removeEventListener('keydown', esc, true);
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      off(e);
    }
  };
  setTimeout(() => {
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('keydown', esc, true);
  }, 0);
}

/** Clé « même type » : catégorie + type ou famille/type. */
export function typeKey(app: App, e: Element): string {
  switch (e.kind) {
    case 'wall':
    case 'door':
    case 'window':
      return `${e.kind}:${e.typeId}`;
    case 'component': {
      const fam = app.project.family(e.family);
      return `component:${e.family}:${e.typeId ?? fam?.types[0]?.id}`;
    }
    default:
      return e.kind;
  }
}

/** Sélectionne toutes les occurrences du même type que l'élément (dans la vue ou le projet). */
export function selectAllInstances(app: App, id: Id, scope: 'view' | 'project'): number {
  const p = app.project;
  const ref = p.get(id);
  if (!ref) return 0;
  const key = typeKey(app, ref);
  const levelId = app.view.kind === 'plan' ? app.view.levelId : undefined;
  const ids = p.elements
    .filter((e) => typeKey(app, e) === key)
    .filter((e) => {
      if (scope === 'project' || !levelId) return true;
      const lv = levelOf(p, e);
      return lv === undefined || lv === levelId;
    })
    .map((e) => e.id);
  app.select(ids);
  app.status(`${ids.length} occurrence(s) sélectionnée(s)${scope === 'project' ? ' dans le projet' : ' dans la vue'}.`);
  return ids.length;
}

/** Copie la sélection vers d'autres niveaux (à la même position). */
export function copyToLevelsDialog(app: App): void {
  const p = app.project;
  const ids = [...app.selection].filter((id) => {
    const e = p.get(id);
    return e && !isHosted(e) && 'levelId' in e;
  });
  if (!ids.length) {
    app.status('Sélectionnez des éléments liés à un niveau.');
    return;
  }
  const from = levelOf(p, p.get(ids[0])!);
  const chosen = new Set<Id>();
  const body = h('div');
  const list = h('div', { class: 'vg-grid' });
  for (const l of [...p.sortedLevels()].reverse()) {
    const c = h('input', { type: 'checkbox', disabled: l.id === from });
    c.addEventListener('change', () => (c.checked ? chosen.add(l.id) : chosen.delete(l.id)));
    list.append(h('label', { class: 'vg-item' }, c, `${l.name}${l.id === from ? ' (niveau d’origine)' : ''}`));
  }
  clear(body);
  body.append(
    h('p', {}, `${ids.length} élément(s) seront copiés à la même position sur les niveaux cochés (portes et fenêtres incluses).`),
    list,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          if (!chosen.size) return;
          const created = p.transact('Copier vers les niveaux', () => [...chosen].flatMap((lv) => duplicate(p, ids, (q) => ({ ...q }), { levelId: lv })));
          close();
          app.status(`${created.length} élément(s) créés sur ${chosen.size} niveau(x).`);
        },
      }, 'Copier'),
    ),
  );
  const close = modal('Copier vers les niveaux', body);
}

/** Menu contextuel de la vue en plan. */
export function planContextMenu(app: App, x: number, y: number, hitId: Id | null, zoomExtents: () => void): void {
  const p = app.project;
  if (hitId && !app.selection.has(hitId)) app.select([hitId]);
  const sel = [...app.selection];
  const first = sel.length ? p.get(sel[0]) : undefined;
  showMenu(x, y, [
    { label: 'Annuler', hint: p.undoLabel ? `${p.undoLabel}` : 'Ctrl+Z', disabled: !p.canUndo, action: () => p.undo() },
    { label: 'Rétablir', hint: p.redoLabel ? `${p.redoLabel}` : 'Ctrl+Y', disabled: !p.canRedo, action: () => p.redo() },
    { label: '', separator: true },
    { label: 'Sélectionner toutes les occurrences — dans la vue', disabled: !first, action: () => first && selectAllInstances(app, first.id, 'view') },
    { label: 'Sélectionner toutes les occurrences — dans le projet', disabled: !first, action: () => first && selectAllInstances(app, first.id, 'project') },
    { label: '', separator: true },
    { label: 'Copier', hint: 'Ctrl+C', disabled: !sel.length, action: () => copySelection(app) },
    { label: 'Coller', hint: 'Ctrl+V', action: () => paste(app) },
    { label: 'Copier vers les niveaux…', disabled: !sel.length, action: () => copyToLevelsDialog(app) },
    { label: 'Déplacer', hint: 'DP', disabled: !sel.length, action: () => app.setTool('move') },
    { label: 'Rotation', hint: 'RO', disabled: !sel.length, action: () => app.setTool('rotate') },
    { label: '', separator: true },
    { label: 'Zoom étendu', hint: 'ZE', action: zoomExtents },
    { label: 'Visibilité/Graphismes…', hint: 'VG', action: () => visibilityDialog(app) },
    { label: '', separator: true },
    { label: 'Supprimer', hint: 'Suppr', danger: true, disabled: !sel.length, action: () => app.deleteSelection() },
  ]);
}
