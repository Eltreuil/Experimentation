import { viewKey, type App, type ViewDef } from '../app';
import { addLevel } from '../commands';
import { formatLength } from '../model/project';
import { clear, h, perFrame } from './dom';
import { ICONS } from './icons';

/** Arborescence du projet : vues, nomenclatures, niveaux et types. */
export class ProjectBrowser {
  private collapsed = new Set<string>();

  constructor(
    private app: App,
    private root: HTMLElement,
  ) {
    app.on('view', () => this.render());
    app.on('options', () => this.render());
    app.project.onChange(perFrame(() => this.render()));
    this.render();
  }

  private node(label: string, view: ViewDef, icon: string): HTMLElement {
    const active = viewKey(this.app.view) === viewKey(view);
    return h(
      'div',
      {
        class: `tree-item${active ? ' active' : ''}`,
        onclick: () => this.app.setView(view),
        title: 'Ouvrir la vue',
      },
      h('span', { class: 'tree-icon', html: ICONS[icon] }),
      h('span', { class: 'tree-label' }, label),
    );
  }

  private group(key: string, title: string, children: HTMLElement[], action?: HTMLElement): HTMLElement {
    const closed = this.collapsed.has(key);
    return h(
      'div',
      { class: 'tree-group' },
      h(
        'div',
        {
          class: 'tree-head',
          onclick: () => {
            if (closed) this.collapsed.delete(key);
            else this.collapsed.add(key);
            this.render();
          },
        },
        h('span', { class: `chev${closed ? '' : ' open'}` }, '▸'),
        h('span', {}, title),
        action ?? null,
      ),
      closed ? null : h('div', { class: 'tree-children' }, ...children),
    );
  }

  render(): void {
    const p = this.app.project;
    const root = this.root;
    clear(root);
    root.append(h('div', { class: 'panel-title' }, 'Arborescence du projet'));
    const levels = p.sortedLevels();
    const addBtn = h('button', {
      class: 'mini-btn',
      title: 'Ajouter un niveau',
      onclick: (e: Event) => {
        e.stopPropagation();
        const l = addLevel(this.app);
        this.app.setView({ kind: 'plan', levelId: l.id });
      },
    }, '+');
    root.append(
      this.group('plans', 'Plans d’étage', [...levels].reverse().map((l) => this.node(l.name, { kind: 'plan', levelId: l.id }, 'plan')), addBtn),
      this.group('3d', 'Vues 3D', [this.node('{3D}', { kind: '3d' }, 'cube')]),
      this.group('elev', 'Élévations', [
        this.node('Nord', { kind: 'elevation', dir: 'N' }, 'elevation'),
        this.node('Sud', { kind: 'elevation', dir: 'S' }, 'elevation'),
        this.node('Est', { kind: 'elevation', dir: 'E' }, 'elevation'),
        this.node('Ouest', { kind: 'elevation', dir: 'W' }, 'elevation'),
      ]),
      this.group('sched', 'Nomenclatures / Quantités', [
        this.node('Murs', { kind: 'schedule', category: 'wall' }, 'schedule'),
        this.node('Portes', { kind: 'schedule', category: 'door' }, 'schedule'),
        this.node('Fenêtres', { kind: 'schedule', category: 'window' }, 'schedule'),
        this.node('Pièces', { kind: 'schedule', category: 'room' }, 'schedule'),
        this.node('Sols', { kind: 'schedule', category: 'floor' }, 'schedule'),
      ]),
      this.group(
        'levels',
        'Niveaux',
        [...levels].reverse().map((l) =>
          h(
            'div',
            { class: 'tree-item static' },
            h('span', { class: 'tree-icon', html: ICONS.level }),
            h('span', { class: 'tree-label' }, l.name),
            h('span', { class: 'tree-meta' }, `${l.elevation >= 0 ? '+' : ''}${formatLength(l.elevation, 'm')} m`),
          ),
        ),
      ),
      this.group('families', 'Familles', [
        ...this.typeList('Murs', p.data.wallTypes, this.app.options.wallTypeId, (id) => this.app.setOptions({ wallTypeId: id })),
        ...this.typeList('Portes', p.data.doorTypes, this.app.options.doorTypeId, (id) => this.app.setOptions({ doorTypeId: id })),
        ...this.typeList('Fenêtres', p.data.windowTypes, this.app.options.windowTypeId, (id) => this.app.setOptions({ windowTypeId: id })),
      ]),
    );
  }

  private typeList(title: string, types: { id: string; name: string }[], current: string, pick: (id: string) => void): HTMLElement[] {
    return [
      h('div', { class: 'tree-sub' }, title),
      ...types.map((t) =>
        h(
          'div',
          { class: `tree-item type${t.id === current ? ' current' : ''}`, onclick: () => pick(t.id), title: 'Définir comme type courant' },
          h('span', { class: 'tree-dot' }),
          h('span', { class: 'tree-label' }, t.name),
        ),
      ),
    ];
  }
}
