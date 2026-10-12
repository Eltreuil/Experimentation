import type { ScheduleCategory } from '../app';
import { polygonArea, polygonPerimeter, wallLength } from './geometry';
import { meshVolume, elementMeshes } from './mesh';
import { formatLength, type Project } from './project';
import type { Id } from './types';

export interface ScheduleColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Colonne numérique totalisée en pied de tableau. */
  total?: (values: number[]) => string;
}

export interface ScheduleRow {
  id: Id;
  cells: Record<string, string>;
  values: Record<string, number>;
}

export interface Schedule {
  title: string;
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
  totals: Record<string, string>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function buildSchedule(p: Project, category: ScheduleCategory): Schedule {
  const u = p.data.units;
  const lvlName = (id: Id | undefined) => (id ? p.level(id)?.name ?? '?' : '');
  const lvlOrder = (id: Id | undefined) => (id ? p.level(id)?.elevation ?? 0 : 0);
  let title = '';
  let columns: ScheduleColumn[] = [];
  let rows: ScheduleRow[] = [];

  switch (category) {
    case 'wall': {
      title = 'Nomenclature des murs';
      const L = (xs: number[]) => formatLength(sum(xs), u, true);
      columns = [
        { key: 'type', label: 'Type' },
        { key: 'level', label: 'Niveau' },
        { key: 'thickness', label: 'Épaisseur', align: 'right' },
        { key: 'length', label: 'Longueur', align: 'right', total: L },
        { key: 'height', label: 'Hauteur', align: 'right' },
        { key: 'area', label: 'Surface', align: 'right', total: (xs) => `${sum(xs).toFixed(2)} m²` },
        { key: 'volume', label: 'Volume', align: 'right', total: (xs) => `${sum(xs).toFixed(2)} m³` },
      ];
      rows = p
        .ofKind('wall')
        .sort((a, b) => lvlOrder(a.levelId) - lvlOrder(b.levelId) || p.wallType(a.typeId).name.localeCompare(p.wallType(b.typeId).name))
        .map((w) => {
          const t = p.wallType(w.typeId);
          const length = wallLength(w);
          const openings = p.openingSpans(w).reduce((acc, o) => acc + (o.end - o.start) * (Math.min(o.top, w.height) - o.bottom), 0);
          const area = Math.max(0, length * w.height - openings);
          const mesh = elementMeshes(p, w);
          const volume = mesh ? sum(mesh.solids.map((s) => meshVolume(s.positions))) : 0;
          return {
            id: w.id,
            cells: {
              type: t.name,
              level: lvlName(w.levelId),
              thickness: formatLength(t.thickness, u, true),
              length: formatLength(length, u, true),
              height: formatLength(w.height, u, true),
              area: `${area.toFixed(2)} m²`,
              volume: `${volume.toFixed(2)} m³`,
            },
            values: { length, area, volume },
          };
        });
      break;
    }
    case 'door':
    case 'window': {
      const isDoor = category === 'door';
      title = isDoor ? 'Nomenclature des portes' : 'Nomenclature des fenêtres';
      columns = [
        { key: 'mark', label: 'Repère' },
        { key: 'type', label: 'Type' },
        { key: 'width', label: 'Largeur', align: 'right' },
        { key: 'height', label: 'Hauteur', align: 'right' },
        ...(isDoor ? [] : [{ key: 'sill', label: 'Allège', align: 'right' as const }]),
        { key: 'level', label: 'Niveau' },
        { key: 'host', label: 'Mur hôte' },
        { key: 'count', label: 'Nombre', align: 'right', total: (xs) => String(sum(xs)) },
      ];
      const items = isDoor ? p.ofKind('door') : p.ofKind('window');
      rows = items
        .map((o) => {
          const t = o.kind === 'door' ? p.doorType(o.typeId) : p.windowType(o.typeId);
          const host = p.get<'wall'>(o.hostId);
          return {
            id: o.id,
            cells: {
              mark: o.mark ?? '',
              type: t.name,
              width: formatLength(t.width, u, true),
              height: formatLength(t.height, u, true),
              sill: o.kind === 'window' ? formatLength(o.sill, u, true) : '',
              level: lvlName(host?.levelId),
              host: host ? p.wallType(host.typeId).name : '',
              count: '1',
            },
            values: { count: 1 },
          };
        })
        .sort((a, b) => a.cells.mark.localeCompare(b.cells.mark, 'fr', { numeric: true }));
      break;
    }
    case 'room': {
      title = 'Nomenclature des pièces';
      columns = [
        { key: 'number', label: 'Numéro' },
        { key: 'name', label: 'Nom' },
        { key: 'level', label: 'Niveau' },
        { key: 'area', label: 'Surface', align: 'right', total: (xs) => `${sum(xs).toFixed(2)} m²` },
        { key: 'perimeter', label: 'Périmètre', align: 'right' },
      ];
      rows = p
        .ofKind('room')
        .map((r) => {
          const area = Math.abs(polygonArea(r.points));
          return {
            id: r.id,
            cells: {
              number: r.number,
              name: r.name,
              level: lvlName(r.levelId),
              area: `${area.toFixed(2)} m²`,
              perimeter: formatLength(polygonPerimeter(r.points), u, true),
            },
            values: { area },
          };
        })
        .sort((a, b) => a.cells.number.localeCompare(b.cells.number, 'fr', { numeric: true }));
      break;
    }
    case 'floor': {
      title = 'Nomenclature des sols';
      columns = [
        { key: 'level', label: 'Niveau' },
        { key: 'thickness', label: 'Épaisseur', align: 'right' },
        { key: 'area', label: 'Surface', align: 'right', total: (xs) => `${sum(xs).toFixed(2)} m²` },
        { key: 'volume', label: 'Volume', align: 'right', total: (xs) => `${sum(xs).toFixed(2)} m³` },
      ];
      rows = p
        .ofKind('floor')
        .sort((a, b) => lvlOrder(a.levelId) - lvlOrder(b.levelId))
        .map((f) => {
          const area = Math.abs(polygonArea(f.points));
          const volume = area * f.thickness;
          return {
            id: f.id,
            cells: {
              level: lvlName(f.levelId),
              thickness: formatLength(f.thickness, u, true),
              area: `${area.toFixed(2)} m²`,
              volume: `${volume.toFixed(2)} m³`,
            },
            values: { area, volume },
          };
        });
      break;
    }
    case 'component': {
      title = 'Nomenclature des composants';
      columns = [
        { key: 'category', label: 'Catégorie' },
        { key: 'family', label: 'Famille' },
        { key: 'type', label: 'Type' },
        { key: 'level', label: 'Niveau' },
        { key: 'size', label: 'Encombrement' },
        { key: 'count', label: 'Nombre', align: 'right', total: (xs) => String(sum(xs)) },
      ];
      // Regroupement par famille, type, niveau et encombrement (nomenclature non détaillée).
      const groups = new Map<string, { id: Id; cells: Record<string, string>; values: Record<string, number> }>();
      for (const c of p.ofKind('component')) {
        const fam = p.family(c.family);
        const type = fam?.types.find((t) => t.id === c.typeId) ?? fam?.types[0];
        const b = p.componentGeometry(c).bounds;
        const size = `${formatLength(b.x1 - b.x0, u)} × ${formatLength(b.y1 - b.y0, u)} ${u}`;
        const key = `${c.family}|${type?.id}|${c.levelId}|${size}`;
        const g = groups.get(key);
        if (g) {
          g.values.count++;
          g.cells.count = String(g.values.count);
          continue;
        }
        groups.set(key, {
          id: c.id,
          cells: { category: fam?.category ?? '?', family: fam?.name ?? `Famille manquante (${c.family})`, type: type?.name ?? '', level: lvlName(c.levelId), size, count: '1' },
          values: { count: 1 },
        });
      }
      rows = [...groups.values()].sort((a, b) => a.cells.category.localeCompare(b.cells.category) || a.cells.family.localeCompare(b.cells.family) || a.cells.type.localeCompare(b.cells.type));
      break;
    }
  }

  const totals: Record<string, string> = {};
  for (const c of columns) {
    if (c.total) totals[c.key] = c.total(rows.map((r) => r.values[c.key] ?? 0));
  }
  return { title, columns, rows, totals };
}

export function scheduleToCSV(s: Schedule): string {
  const esc = (x: string) => (/[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  const lines = [s.columns.map((c) => esc(c.label)).join(';')];
  for (const r of s.rows) lines.push(s.columns.map((c) => esc(r.cells[c.key] ?? '')).join(';'));
  if (Object.keys(s.totals).length) lines.push(s.columns.map((c, i) => esc(s.totals[c.key] ?? (i === 0 ? 'Total' : ''))).join(';'));
  // BOM pour une ouverture correcte des accents dans Excel.
  return '﻿' + lines.join('\r\n');
}
