import { viewKey, type App, type ViewDef } from '../app';
import { clear, h } from '../ui/dom';
import { PlanView } from './planView';
import { ScheduleView } from './scheduleView';
import { View3D, type VisualStyle } from './view3d';

type ActiveView = PlanView | View3D | ScheduleView;

export function viewTitle(app: App, v: ViewDef): string {
  switch (v.kind) {
    case 'plan':
      return `Plan : ${app.project.level(v.levelId)?.name ?? '?'}`;
    case '3d':
      return '{3D}';
    case 'elevation':
      return `Élévation : ${{ N: 'Nord', S: 'Sud', E: 'Est', W: 'Ouest' }[v.dir]}`;
    case 'schedule':
      return `Nomenclature : ${{ wall: 'Murs', door: 'Portes', window: 'Fenêtres', room: 'Pièces', floor: 'Sols', component: 'Composants', material: 'Matériaux' }[v.category]}`;
    case 'section':
      return `Coupe : ${app.project.get<'section'>(v.sectionId)?.name ?? '?'}`;
  }
}

/** Zone centrale : onglets des vues ouvertes et vue active. */
export class ViewHost {
  current: ActiveView | null = null;
  private tabs: HTMLElement;
  private content: HTMLElement;
  private overlay: HTMLElement;
  private planCams = new Map<string, PlanView['cam']>();
  private style3d: VisualStyle = 'consistent';
  private edges3d = true;

  constructor(
    private app: App,
    root: HTMLElement,
  ) {
    this.tabs = h('div', { class: 'view-tabs' });
    this.content = h('div', { class: 'view-content' });
    this.overlay = h('div', { class: 'view-overlay' });
    root.append(this.tabs, this.content);
    app.on('view', () => this.mount());
    app.on('views', () => this.renderTabs());
    app.project.onChange(() => this.renderTabs());
    this.mount();
    this.renderTabs();
  }

  get plan(): PlanView | null {
    return this.current instanceof PlanView ? this.current : null;
  }

  get view3d(): View3D | null {
    return this.current instanceof View3D ? this.current : null;
  }

  private renderTabs(): void {
    clear(this.tabs);
    for (const v of this.app.openViews) {
      const active = viewKey(v) === viewKey(this.app.view);
      this.tabs.append(
        h(
          'div',
          { class: `view-tab${active ? ' active' : ''}`, onclick: () => this.app.setView(v) },
          h('span', {}, viewTitle(this.app, v)),
          h('button', {
            class: 'tab-close',
            title: 'Fermer la vue',
            onclick: (e: Event) => {
              e.stopPropagation();
              this.app.closeView(v);
            },
          }, '×'),
        ),
      );
    }
  }

  private mount(): void {
    if (this.current instanceof PlanView) this.planCams.set(this.current.levelId, { ...this.current.cam });
    this.current?.dispose();
    this.current = null;
    clear(this.content);
    clear(this.overlay);
    const v = this.app.view;
    switch (v.kind) {
      case 'plan': {
        const pv = new PlanView(this.app, this.content, v.levelId);
        const cam = this.planCams.get(v.levelId) ?? [...this.planCams.values()].pop();
        if (cam) {
          pv.cam = { ...cam };
          pv.requestDraw();
        }
        this.current = pv;
        this.content.append(this.overlay);
        this.overlay.append(
          h('button', { class: 'overlay-btn', title: 'Zoom étendu (ZE)', onclick: () => pv.zoomExtents() }, '⤢'),
          h('button', { class: 'overlay-btn', title: 'Zoom avant', onclick: () => pv.zoomBy(1.25) }, '+'),
          h('button', { class: 'overlay-btn', title: 'Zoom arrière', onclick: () => pv.zoomBy(0.8) }, '−'),
        );
        this.content.append(h('div', { class: 'north-arrow', title: 'Nord' }, h('span', {}, 'N'), h('div', { class: 'arrow' })));
        break;
      }
      case '3d':
      case 'elevation':
      case 'section': {
        const v3 = new View3D(this.app, this.content, v.kind === 'elevation' ? { elevation: v.dir } : v.kind === 'section' ? { sectionId: v.sectionId } : {});
        v3.setStyle(this.style3d);
        v3.setEdges(this.edges3d);
        this.current = v3;
        this.content.append(this.overlay);
        this.build3DToolbar(v3, v.kind === '3d');
        break;
      }
      case 'schedule':
        this.current = new ScheduleView(this.app, this.content, v.category);
        break;
    }
  }

  private build3DToolbar(v3: View3D, perspective: boolean): void {
    const styleSel = h(
      'select',
      { class: 'overlay-select', title: 'Style visuel' },
      h('option', { value: 'consistent', selected: this.style3d === 'consistent' }, 'Couleurs homogènes'),
      h('option', { value: 'shaded', selected: this.style3d === 'shaded' }, 'Ombré réaliste'),
      h('option', { value: 'wireframe', selected: this.style3d === 'wireframe' }, 'Filaire'),
    );
    styleSel.addEventListener('change', () => {
      this.style3d = styleSel.value as VisualStyle;
      v3.setStyle(this.style3d);
    });
    const edges = h('input', { type: 'checkbox', checked: this.edges3d });
    edges.addEventListener('change', () => {
      this.edges3d = edges.checked;
      v3.setEdges(edges.checked);
    });
    this.overlay.append(
      h('button', { class: 'overlay-btn', title: 'Zoom étendu', onclick: () => v3.zoomExtents() }, '⤢'),
      styleSel,
      h('label', { class: 'overlay-check' }, edges, 'Arêtes'),
    );
    if (perspective) {
      const levels = this.app.project.sortedLevels();
      const top = Math.max(...levels.map((l) => l.elevation + l.height)) + 3;
      const clip = h('input', { type: 'range', min: '0', max: String(Math.ceil(top * 10)), value: String(Math.ceil(top * 10)), class: 'overlay-range' });
      const label = h('span', { class: 'overlay-label' }, 'Coupe : aucune');
      clip.addEventListener('input', () => {
        const val = parseInt(clip.value, 10) / 10;
        const off = val >= top;
        v3.setClip(off ? null : val);
        label.textContent = off ? 'Coupe : aucune' : `Coupe : ${val.toFixed(1)} m`;
      });
      this.overlay.append(
        h('button', { class: 'overlay-btn', title: 'Vue isométrique', onclick: () => v3.setOrientation('iso') }, 'Iso'),
        h('button', { class: 'overlay-btn', title: 'Vue de dessus', onclick: () => v3.setOrientation('top') }, 'Haut'),
        h('button', { class: 'overlay-btn', title: 'Vue de face (sud)', onclick: () => v3.setOrientation('front') }, 'Face'),
        h('button', { class: 'overlay-btn', title: 'Vue de droite (est)', onclick: () => v3.setOrientation('right') }, 'Droite'),
        h('span', { class: 'overlay-sep' }),
        label,
        clip,
      );
    }
  }

  zoomExtents(): void {
    if (this.plan) this.plan.zoomExtents();
    else this.view3d?.zoomExtents();
  }

  snapshot(): string | null {
    if (this.plan) return this.plan.renderToDataURL();
    if (this.view3d) return this.view3d.snapshot();
    return null;
  }

  /** Accès au modèle 3D pour l'export glTF (crée une vue hors écran si besoin). */
  withModel<T>(fn: (v: View3D) => T): T {
    if (this.view3d) return fn(this.view3d);
    const host = h('div', { style: 'position:absolute;left:-9999px;width:64px;height:64px' });
    document.body.append(host);
    const v = new View3D(this.app, host);
    try {
      v.ensureBuilt();
      return fn(v);
    } finally {
      v.dispose();
      host.remove();
    }
  }
}
