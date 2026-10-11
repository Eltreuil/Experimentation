import { describe, expect, it } from 'vitest';
import { emptyProject, sampleProject } from '../src/model/defaults';
import { polygonArea, roofFacets, roofHeightAt, stairRisers, wallOutline, wallPieces, wallTypeThickness } from '../src/model/geometry';
import { elementMeshes, meshVolume, triangulate } from '../src/model/mesh';
import { Project, formatLength, newId, parseLength } from '../src/model/project';
import { buildingFootprint, detectRoom, offsetPolygon } from '../src/model/rooms';
import { buildSchedule, scheduleToCSV } from '../src/model/schedules';
import { exportIFC, ifcGuid } from '../src/io/ifc';
import type { Wall } from '../src/model/types';

const wall = (a: [number, number], b: [number, number], typeId = 'wt-ext', levelId = 'lvl-0'): Wall => ({
  id: newId('w'),
  kind: 'wall',
  levelId,
  typeId,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  height: 3,
  baseOffset: 0,
});

/** Boîte fermée de 4 murs de 30 cm d'épaisseur. */
function boxProject(w = 6, d = 4): Project {
  const p = new Project(emptyProject());
  const pts: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ];
  p.transact('murs', () => pts.forEach((q, i) => p.add(wall(q, pts[(i + 1) % 4]))));
  return p;
}

describe('unités', () => {
  it('formate et interprète les longueurs', () => {
    expect(formatLength(4.5, 'cm')).toBe('450');
    expect(formatLength(4.5, 'mm')).toBe('4500');
    expect(formatLength(4.5, 'm', true)).toBe('4.5 m');
    expect(parseLength('450', 'cm')).toBeCloseTo(4.5);
    expect(parseLength('3,2m', 'cm')).toBeCloseTo(3.2);
    expect(parseLength('1200 mm', 'cm')).toBeCloseTo(1.2);
    expect(parseLength('abc', 'cm')).toBeNull();
  });
});

describe('raccords de murs', () => {
  it('calcule un angle en onglet aux coins', () => {
    const p = boxProject();
    const walls = p.ofKind('wall');
    const thick = wallTypeThickness(p.data.wallTypes);
    const south = walls.find((w) => w.a.x === 0 && w.a.y === 0)!;
    const o = wallOutline(south, walls, thick);
    // Mur sud (a→b vers l'est) : gauche = intérieur (nord), droite = extérieur.
    expect(o.aL.x).toBeCloseTo(0.15);
    expect(o.aL.y).toBeCloseTo(0.15);
    expect(o.aR.x).toBeCloseTo(-0.15);
    expect(o.aR.y).toBeCloseTo(-0.15);
    expect(o.aJoined && o.bJoined).toBe(true);
  });

  it('arrête un mur en T sur la face du mur porteur', () => {
    const p = boxProject();
    const inner = wall([3, 0], [3, 4], 'wt-int');
    p.transact('t', () => p.add(inner));
    const o = p.outline(p.get<'wall'>(inner.id)!);
    expect(o.aL.y).toBeCloseTo(0.15);
    expect(o.bL.y).toBeCloseTo(3.85);
    expect(o.aJoined && o.bJoined).toBe(true);
  });

  it('découpe un mur autour de ses ouvertures', () => {
    const p = boxProject();
    const w = p.ofKind('wall')[0];
    const pieces = wallPieces(w, p.outline(w), 0.3, [{ id: 'x', start: 2, end: 3, bottom: 0.9, top: 2.1 }]);
    // gauche, allège, linteau, droite
    expect(pieces).toHaveLength(4);
    expect(pieces.filter((pc) => pc.top === 3 && pc.bottom === 0)).toHaveLength(2);
  });
});

describe('historique', () => {
  it('annule et rétablit', () => {
    const p = boxProject();
    expect(p.ofKind('wall')).toHaveLength(4);
    p.transact('suppr', () => p.remove([p.ofKind('wall')[0].id]));
    expect(p.ofKind('wall')).toHaveLength(3);
    p.undo();
    expect(p.ofKind('wall')).toHaveLength(4);
    p.redo();
    expect(p.ofKind('wall')).toHaveLength(3);
  });

  it('supprime les ouvertures avec leur mur hôte', () => {
    const p = boxProject();
    const w = p.ofKind('wall')[0];
    p.transact('porte', () => p.add({ id: 'd1', kind: 'door', hostId: w.id, typeId: 'dt-83', offset: 2, flipHand: false, flipFacing: false }));
    p.transact('suppr', () => p.remove([w.id]));
    expect(p.get('d1')).toBeUndefined();
  });
});

describe('pièces', () => {
  it('détecte le contour intérieur d’un espace fermé', () => {
    const p = boxProject(6, 4);
    const pts = detectRoom(p, 'lvl-0', { x: 3, y: 2 })!;
    expect(pts).not.toBeNull();
    expect(pts).toHaveLength(4);
    // Intérieur : (6 - 0,3) × (4 - 0,3)
    expect(Math.abs(polygonArea(pts))).toBeCloseTo(5.7 * 3.7, 2);
  });

  it('refuse un espace ouvert', () => {
    const p = boxProject();
    p.transact('ouvrir', () => p.remove([p.ofKind('wall')[0].id]));
    expect(detectRoom(p, 'lvl-0', { x: 3, y: 2 })).toBeNull();
  });

  it('trouve l’emprise extérieure et la décale', () => {
    const p = boxProject(6, 4);
    const pts = buildingFootprint(p, 'lvl-0')!;
    expect(Math.abs(polygonArea(pts))).toBeCloseTo(6.3 * 4.3, 2);
    expect(Math.abs(polygonArea(offsetPolygon(pts, 0.5)))).toBeCloseTo(7.3 * 5.3, 2);
  });
});

describe('géométrie 3D', () => {
  it('triangule un polygone concave', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ];
    const tris = triangulate(L);
    expect(tris).toHaveLength(4);
    const area = tris.reduce((s, [a, b, c]) => s + Math.abs(polygonArea([L[a], L[b], L[c]])), 0);
    expect(area).toBeCloseTo(6);
  });

  it('produit un volume de dalle correct', () => {
    const p = new Project(emptyProject());
    p.transact('sol', () =>
      p.add({ id: 's', kind: 'floor', levelId: 'lvl-0', thickness: 0.2, offset: 0, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] }),
    );
    const m = elementMeshes(p, p.get('s')!)!;
    expect(meshVolume(m.solids[0].positions)).toBeCloseTo(4);
  });

  it('découpe un toit à 4 pans en pans plans avec faîtage', () => {
    const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];
    const facets = roofFacets(rect, 'hip', 45);
    expect(facets).toHaveLength(4);
    const area = facets.reduce((s, f) => s + Math.abs(polygonArea(f.points)), 0);
    expect(area).toBeCloseTo(60);
    // Faîtage à mi-largeur : hauteur = 3 m pour une pente de 45°.
    expect(roofHeightAt(rect, 45, { x: 5, y: 3 }, 'hip')).toBeCloseTo(3);
    expect(roofFacets(rect, 'gable', 45)).toHaveLength(2);
    expect(roofHeightAt(rect, 45, { x: 0.5, y: 3 }, 'gable')).toBeCloseTo(3);
    expect(roofFacets(rect, 'flat', 45)).toHaveLength(1);
  });

  it('calcule le nombre de contremarches', () => {
    expect(stairRisers(3.0, 0.18)).toBe(17);
    expect(stairRisers(2.7, 0.18)).toBe(15);
  });
});

describe('nomenclatures et export', () => {
  it('totalise les pièces et produit un CSV', () => {
    const p = new Project(sampleProject());
    const s = buildSchedule(p, 'room');
    expect(s.rows.length).toBe(5);
    expect(s.totals.area).toMatch(/m²$/);
    const csv = scheduleToCSV(s);
    expect(csv.split('\r\n')[0]).toContain('Numéro');
  });

  it('compte portes et fenêtres', () => {
    const p = new Project(sampleProject());
    expect(buildSchedule(p, 'door').totals.count).toBe('7');
    expect(buildSchedule(p, 'window').totals.count).toBe('8');
  });

  it('génère un IFC4 bien formé', () => {
    const p = new Project(sampleProject());
    const ifc = exportIFC(p, { timestamp: '2026-01-01T00:00:00' });
    expect(ifc.startsWith('ISO-10303-21;')).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC4'));");
    expect(ifc.match(/IFCWALL\(/g)).toHaveLength(p.ofKind('wall').length);
    expect(ifc.match(/IFCDOOR\(/g)).toHaveLength(7);
    expect(ifc.match(/IFCWINDOW\(/g)).toHaveLength(8);
    expect(ifc.match(/IFCBUILDINGSTOREY\(/g)).toHaveLength(2);
    expect(ifc).toContain('.HIP_ROOF.');
    // Toutes les références #n pointent vers une entité définie.
    const defined = new Set([...ifc.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
    const refs = [...ifc.matchAll(/#(\d+)(?!=)/g)].map((m) => m[1]);
    expect(refs.every((r) => defined.has(r))).toBe(true);
    // Les accents sont encodés.
    expect(ifc).not.toMatch(/[^\x00-\x7f]/);
  });

  it('génère des GlobalId IFC de 22 caractères', () => {
    const g = ifcGuid();
    expect(g).toHaveLength(22);
    expect('0123').toContain(g[0]);
  });
});
