import type { App, ScheduleCategory } from '../app';
import { download, safeName } from '../io/files';
import { levelOf } from '../model/project';
import { buildSchedule, scheduleToCSV } from '../model/schedules';
import { clear, h } from '../ui/dom';

export class ScheduleView {
  private root: HTMLElement;
  private disposers: (() => void)[] = [];

  constructor(
    private app: App,
    container: HTMLElement,
    private category: ScheduleCategory,
  ) {
    this.root = h('div', { class: 'schedule' });
    container.appendChild(this.root);
    this.disposers.push(app.project.onChange(() => this.render()));
    this.disposers.push(app.on('selection', () => this.render()));
    this.render();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.root.remove();
  }

  render(): void {
    const s = buildSchedule(this.app.project, this.category);
    clear(this.root);
    const exportCsv = () => download(`${safeName(this.app.project.data.name)}_${safeName(s.title)}.csv`, scheduleToCSV(s), 'text/csv;charset=utf-8');
    this.root.append(
      h('div', { class: 'schedule-head' },
        h('h2', {}, s.title),
        h('span', { class: 'schedule-count' }, `${s.rows.length} élément(s)`),
        h('button', { class: 'btn', onclick: exportCsv }, 'Exporter en CSV'),
      ),
    );
    const table = h('table', { class: 'schedule-table' });
    table.append(h('thead', {}, h('tr', {}, ...s.columns.map((c) => h('th', { class: c.align === 'right' ? 'right' : '' }, c.label)))));
    const body = h('tbody');
    for (const r of s.rows) {
      const tr = h(
        'tr',
        {
          class: this.app.selection.has(r.id) ? 'selected' : '',
          title: 'Clic : sélectionner — Double-clic : afficher en plan',
          onclick: (e: Event) => this.app.select([r.id], (e as MouseEvent).shiftKey || (e as MouseEvent).ctrlKey),
          ondblclick: () => {
            const el = this.app.project.get(r.id);
            const lvl = el && levelOf(this.app.project, el);
            if (lvl) this.app.setView({ kind: 'plan', levelId: lvl });
            this.app.select([r.id]);
          },
        },
        ...s.columns.map((c) => h('td', { class: c.align === 'right' ? 'right' : '' }, r.cells[c.key] ?? '')),
      );
      body.append(tr);
    }
    if (!s.rows.length) body.append(h('tr', {}, h('td', { colspan: String(s.columns.length), class: 'empty' }, 'Aucun élément dans cette catégorie.')));
    table.append(body);
    if (Object.keys(s.totals).length) {
      table.append(
        h('tfoot', {}, h('tr', {}, ...s.columns.map((c, i) => h('td', { class: c.align === 'right' ? 'right' : '' }, s.totals[c.key] ?? (i === 0 ? 'Total' : ''))))),
      );
    }
    this.root.append(h('div', { class: 'schedule-scroll' }, table));
  }
}
