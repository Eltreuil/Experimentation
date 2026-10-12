import type { App } from '../app';
import { pickFile } from '../io/files';
import { parseDXF } from '../io/dxfImport';
import { newId } from '../model/project';
import type { CadImport } from '../model/types';
import { modal } from './dialogs';
import { h } from './dom';
import { selectField, textField } from './fields';

const MAX_SEGMENTS = 400_000;

/** Importer CAO : fond de plan DXF sur le niveau actif (comme « Importer CAO » de Revit). */
export async function importDxf(app: App, center: () => { x: number; y: number }): Promise<void> {
  const file = await pickFile('.dxf');
  if (!file) return;
  let data;
  try {
    data = parseDXF(await file.text());
  } catch (e) {
    app.status(`DXF illisible : ${(e as Error).message}`);
    return;
  }
  if (!data.lines.length && !data.texts.length) {
    app.status('Aucune géométrie 2D exploitable dans ce fichier DXF.');
    return;
  }
  const detected = data.unitToMeters;
  const b = data.bounds;
  // Sans unité déclarée, on devine : un plan de bâtiment mesure de 5 à 500 m.
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const guess = detected ?? (span > 5000 ? 0.001 : span > 500 ? 0.01 : 1);
  let unit = String(guess);
  let placement = 'origin';
  let name = file.name.replace(/\.dxf$/i, '');
  const body = h(
    'div',
    {},
    h('p', {}, `${(data.lines.length / 4).toLocaleString('fr-FR')} segments, ${data.texts.length} textes, ${data.layers.length} calque(s). ${detected ? 'Unités déclarées dans le fichier.' : 'Unités non déclarées : vérifiez-les.'}`),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Nom'), textField(name, (v) => (name = v || name))),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Unités du fichier'),
      selectField(unit, [
        { value: '0.001', label: 'Millimètres' },
        { value: '0.01', label: 'Centimètres' },
        { value: '1', label: 'Mètres' },
        { value: '0.0254', label: 'Pouces' },
        { value: '0.3048', label: 'Pieds' },
      ], (v) => (unit = v)),
    ),
    h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Positionnement'),
      selectField(placement, [
        { value: 'origin', label: 'Origine sur origine' },
        { value: 'center', label: 'Centré dans la vue' },
      ], (v) => (placement = v)),
    ),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const k = parseFloat(unit);
          const lines = data.lines.slice(0, MAX_SEGMENTS * 4).map((x) => Math.round(x * k * 1e5) / 1e5);
          const texts = data.texts.map((t) => ({ ...t, x: t.x * k, y: t.y * k, h: t.h * k }));
          let pos = { x: 0, y: 0 };
          if (placement === 'center') {
            const c = center();
            pos = { x: c.x - ((b.x0 + b.x1) / 2) * k, y: c.y - ((b.y0 + b.y1) / 2) * k };
          }
          const el: CadImport = { id: newId('cad'), kind: 'cad', levelId: app.activeLevelId, name, pos, rotation: 0, lines, texts, color: '#8a6d3b' };
          app.project.transact('Importer CAO', () => app.project.add(el));
          app.select([el.id]);
          close();
          app.status(`Fond de plan « ${name} » importé${data.lines.length > MAX_SEGMENTS * 4 ? ' (tronqué)' : ''}. Les extrémités des segments sont accrochables pour redessiner.`);
        },
      }, 'Importer'),
    ),
  );
  const close = modal('Importer un fichier CAO (DXF)', body);
}
