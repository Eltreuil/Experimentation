import { newId } from './project';
import { defaultFamilies } from './familyLibrary';
import type { Element, ProjectData, Vec2, Wall } from './types';

export function emptyProject(name = 'Nouveau projet'): ProjectData {
  return {
    version: 1,
    name,
    units: 'cm',
    levels: [
      { id: 'lvl-0', name: 'Niveau 0', elevation: 0, height: 2.7 },
      { id: 'lvl-1', name: 'Niveau 1', elevation: 3.0, height: 2.7 },
    ],
    wallTypes: [
      {
        id: 'wt-ext',
        name: 'Mur extérieur - Béton 20 + ITE 10',
        thickness: 0.3,
        color: '#d9cbb3',
        function: 'exterior',
        layers: [
          { name: 'Enduit extérieur', thickness: 0.015, color: '#efe6d5', function: 'finish' },
          { name: 'Isolant PSE', thickness: 0.1, color: '#f6e7a8', function: 'insulation' },
          { name: 'Béton armé', thickness: 0.18, color: '#bfbab0', function: 'structure' },
          { name: 'Enduit plâtre', thickness: 0.005, color: '#ffffff', function: 'finish' },
        ],
      },
      {
        id: 'wt-int',
        name: 'Cloison - Plaque de plâtre 7',
        thickness: 0.07,
        color: '#f2f2f2',
        function: 'interior',
        layers: [
          { name: 'Plaque de plâtre BA13', thickness: 0.0125, color: '#ffffff', function: 'finish' },
          { name: 'Laine minérale', thickness: 0.045, color: '#f6e7a8', function: 'insulation' },
          { name: 'Plaque de plâtre BA13', thickness: 0.0125, color: '#ffffff', function: 'finish' },
        ],
      },
      {
        id: 'wt-ref',
        name: 'Mur de refend - Brique 15',
        thickness: 0.15,
        color: '#c98f6b',
        function: 'interior',
        layers: [
          { name: 'Enduit plâtre', thickness: 0.01, color: '#ffffff', function: 'finish' },
          { name: 'Brique terre cuite', thickness: 0.13, color: '#c98f6b', function: 'structure' },
          { name: 'Enduit plâtre', thickness: 0.01, color: '#ffffff', function: 'finish' },
        ],
      },
      { id: 'wt-cw', name: 'Mur-rideau - Meneaux 150', thickness: 0.12, color: '#5f666d', function: 'exterior', family: 'curtain', curtainSpacing: 1.5, curtainRowSpacing: 1.2 },
    ],
    doorTypes: [
      { id: 'dt-83', name: 'Porte simple 83 x 204', width: 0.83, height: 2.04, color: '#8a5a3b' },
      { id: 'dt-93', name: 'Porte simple 93 x 215', width: 0.93, height: 2.15, color: '#5b4636' },
      { id: 'dt-140', name: 'Porte double 140 x 215', width: 1.4, height: 2.15, color: '#5b4636' },
    ],
    windowTypes: [
      { id: 'wn-60', name: 'Fenêtre 60 x 75', width: 0.6, height: 0.75, sill: 1.35, color: '#ffffff' },
      { id: 'wn-120', name: 'Fenêtre 120 x 135', width: 1.2, height: 1.35, sill: 0.9, color: '#ffffff' },
      { id: 'wn-240', name: 'Baie coulissante 240 x 215', width: 2.4, height: 2.15, sill: 0, color: '#3c3c3c' },
    ],
    families: defaultFamilies(),
    elements: {},
  };
}

/** Petite maison R+1 servant de projet de démonstration. */
export function sampleProject(): ProjectData {
  const d = emptyProject('Maison de démonstration');
  const els: Element[] = [];
  const push = <T extends Element>(e: T): T => {
    els.push(e);
    return e;
  };

  const loop = (levelId: string, pts: Vec2[], typeId: string, height: number): Wall[] =>
    pts.map((p, i) =>
      push<Wall>({
        id: newId('w'),
        kind: 'wall',
        levelId,
        typeId,
        a: { ...p },
        b: { ...pts[(i + 1) % pts.length] },
        height,
        baseOffset: 0,
      }),
    );
  const wall = (levelId: string, a: Vec2, b: Vec2, typeId: string, height: number): Wall =>
    push<Wall>({ id: newId('w'), kind: 'wall', levelId, typeId, a, b, height, baseOffset: 0 });

  const W = 10;
  const D = 8;
  const footprint = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: D },
    { x: 0, y: D },
  ];

  // --- Niveau 0
  const [s0, e0, n0, w0] = loop('lvl-0', footprint, 'wt-ext', 3.0);
  const ref = wall('lvl-0', { x: 6, y: 0 }, { x: 6, y: D }, 'wt-ref', 3.0);
  const c1 = wall('lvl-0', { x: 6, y: 4.5 }, { x: W, y: 4.5 }, 'wt-int', 3.0);

  push({ id: newId('d'), kind: 'door', hostId: s0.id, typeId: 'dt-93', offset: 3, flipHand: false, flipFacing: true, mark: 'P1' });
  push({ id: newId('d'), kind: 'door', hostId: ref.id, typeId: 'dt-83', offset: 2.2, flipHand: false, flipFacing: false, mark: 'P2' });
  push({ id: newId('d'), kind: 'door', hostId: ref.id, typeId: 'dt-83', offset: 6, flipHand: true, flipFacing: false, mark: 'P3' });
  push({ id: newId('d'), kind: 'door', hostId: c1.id, typeId: 'dt-83', offset: 1.0, flipHand: false, flipFacing: false, mark: 'P4' });
  push({ id: newId('f'), kind: 'window', hostId: n0.id, typeId: 'wn-240', offset: 6.5, sill: 0, mark: 'F1' });
  push({ id: newId('f'), kind: 'window', hostId: w0.id, typeId: 'wn-120', offset: 4, sill: 0.9, mark: 'F2' });
  push({ id: newId('f'), kind: 'window', hostId: e0.id, typeId: 'wn-120', offset: 2.2, sill: 0.9, mark: 'F3' });
  push({ id: newId('f'), kind: 'window', hostId: s0.id, typeId: 'wn-60', offset: 8, sill: 1.35, mark: 'F4' });

  push({ id: newId('s'), kind: 'floor', levelId: 'lvl-0', points: footprint.map((p) => ({ ...p })), thickness: 0.25, offset: 0 });
  push({
    id: newId('r'),
    kind: 'room',
    levelId: 'lvl-0',
    name: 'Séjour',
    seed: { x: 3, y: 2.5 },
    number: '001',
    points: [
      { x: 0.15, y: 0.15 },
      { x: 5.925, y: 0.15 },
      { x: 5.925, y: 7.85 },
      { x: 0.15, y: 7.85 },
    ],
  });
  push({
    id: newId('r'),
    kind: 'room',
    levelId: 'lvl-0',
    name: 'Cuisine',
    seed: { x: 8, y: 6.2 },
    number: '002',
    points: [
      { x: 6.075, y: 4.535 },
      { x: 9.85, y: 4.535 },
      { x: 9.85, y: 7.85 },
      { x: 6.075, y: 7.85 },
    ],
  });
  push({
    id: newId('r'),
    kind: 'room',
    levelId: 'lvl-0',
    name: 'Entrée / Escalier',
    seed: { x: 7, y: 2.3 },
    number: '003',
    points: [
      { x: 6.075, y: 0.15 },
      { x: 9.85, y: 0.15 },
      { x: 9.85, y: 4.465 },
      { x: 6.075, y: 4.465 },
    ],
  });
  push({ id: newId('st'), kind: 'stair', levelId: 'lvl-0', a: { x: 9.3, y: 0.5 }, b: { x: 9.3, y: 4.1 }, width: 0.9, height: 3.0, maxRiser: 0.18, mark: 'E1' });
  push({ id: newId('c'), kind: 'column', levelId: 'lvl-0', pos: { x: 4.6, y: 3.4 }, width: 0.25, depth: 0.25, height: 3.0, rotation: 0, shape: 'round', mark: 'C1' });

  // --- Niveau 1
  const [s1, , n1, w1] = loop('lvl-1', footprint, 'wt-ext', 2.7);
  const r1 = wall('lvl-1', { x: 5, y: 0 }, { x: 5, y: D }, 'wt-ref', 2.7);
  const c2 = wall('lvl-1', { x: 0, y: 4 }, { x: 5, y: 4 }, 'wt-int', 2.7);
  push({ id: newId('d'), kind: 'door', hostId: r1.id, typeId: 'dt-83', offset: 2, flipHand: false, flipFacing: true, mark: 'P5' });
  push({ id: newId('d'), kind: 'door', hostId: r1.id, typeId: 'dt-83', offset: 6, flipHand: false, flipFacing: true, mark: 'P6' });
  push({ id: newId('d'), kind: 'door', hostId: c2.id, typeId: 'dt-83', offset: 4.2, flipHand: true, flipFacing: false, mark: 'P7' });
  push({ id: newId('f'), kind: 'window', hostId: s1.id, typeId: 'wn-120', offset: 2.5, sill: 0.9, mark: 'F5' });
  push({ id: newId('f'), kind: 'window', hostId: n1.id, typeId: 'wn-120', offset: 2.5, sill: 0.9, mark: 'F6' });
  push({ id: newId('f'), kind: 'window', hostId: n1.id, typeId: 'wn-120', offset: 7.5, sill: 0.9, mark: 'F7' });
  push({ id: newId('f'), kind: 'window', hostId: w1.id, typeId: 'wn-60', offset: 4, sill: 1.35, mark: 'F8' });
  push({
    id: newId('s'),
    kind: 'floor',
    levelId: 'lvl-1',
    thickness: 0.25,
    offset: 0,
    points: [
      { x: 0, y: 0 },
      { x: 8.8, y: 0 },
      { x: 8.8, y: 4.5 },
      { x: W, y: 4.5 },
      { x: W, y: D },
      { x: 0, y: D },
    ],
  });
  push({
    id: newId('r'),
    kind: 'room',
    levelId: 'lvl-1',
    name: 'Chambre 1',
    seed: { x: 2.5, y: 2 },
    number: '101',
    points: [
      { x: 0.15, y: 0.15 },
      { x: 4.925, y: 0.15 },
      { x: 4.925, y: 3.965 },
      { x: 0.15, y: 3.965 },
    ],
  });
  push({
    id: newId('r'),
    kind: 'room',
    levelId: 'lvl-1',
    name: 'Chambre 2',
    seed: { x: 2.5, y: 6 },
    number: '102',
    points: [
      { x: 0.15, y: 4.035 },
      { x: 4.925, y: 4.035 },
      { x: 4.925, y: 7.85 },
      { x: 0.15, y: 7.85 },
    ],
  });

  // --- Toiture (posée sur le niveau 1, à 2,70 m)
  push({
    id: newId('t'),
    kind: 'roof',
    levelId: 'lvl-1',
    thickness: 0.3,
    slope: 30,
    shape: 'hip',
    baseOffset: 2.7,
    points: [
      { x: -0.5, y: -0.5 },
      { x: W + 0.5, y: -0.5 },
      { x: W + 0.5, y: D + 0.5 },
      { x: -0.5, y: D + 0.5 },
    ],
  });

  // --- Mobilier et équipements
  const comp = (family: string, x: number, y: number, rotation: number, levelId: string, typeId?: string, params?: Record<string, number | boolean>) =>
    push({ id: newId('cp'), kind: 'component', levelId, family, typeId, pos: { x, y }, rotation, params });
  comp('sofa', 2.2, 1.0, 0, 'lvl-0');
  comp('param-table', 2.2, 5.6, 0, 'lvl-0', 't1');
  comp('param-kitchen', 7.95, 7.5, 180, 'lvl-0', 't1', { Longueur: 3.6 });
  comp('fridge', 9.5, 5.3, 270, 'lvl-0');
  comp('param-bed', 2.5, 6.75, 0, 'lvl-1', 't1');
  comp('wardrobe', 4.5, 5.6, 270, 'lvl-1');
  comp('param-bed', 1.1, 2.0, 90, 'lvl-1', 't3', { 'Avec chevets': false });
  comp('desk', 3.5, 0.6, 0, 'lvl-1');
  comp('param-shelf', 4.65, 2.2, 90, 'lvl-1', 't1');
  comp('tree', -4, 4, 0, 'lvl-0');

  // --- Garde-corps de la trémie d'escalier à l'étage
  push({ id: newId('gc'), kind: 'railing', levelId: 'lvl-1', points: [{ x: 8.8, y: 4.4 }, { x: 8.8, y: 0.2 }], height: 1.0, baseOffset: 0 });

  // --- Coupe longitudinale
  push({ id: newId('cp'), kind: 'section', name: 'Coupe 1', a: { x: -1.5, y: 2.6 }, b: { x: 11.5, y: 2.6 }, depth: 10, flip: true });

  // --- Quadrillages et cotes
  push({ id: newId('g'), kind: 'grid', a: { x: 0, y: -2 }, b: { x: 0, y: D + 2 }, label: '1' });
  push({ id: newId('g'), kind: 'grid', a: { x: 6, y: -2 }, b: { x: 6, y: D + 2 }, label: '2' });
  push({ id: newId('g'), kind: 'grid', a: { x: W, y: -2 }, b: { x: W, y: D + 2 }, label: '3' });
  push({ id: newId('g'), kind: 'grid', a: { x: -2, y: 0 }, b: { x: W + 2, y: 0 }, label: 'A' });
  push({ id: newId('g'), kind: 'grid', a: { x: -2, y: D }, b: { x: W + 2, y: D }, label: 'B' });
  push({ id: newId('dim'), kind: 'dimension', levelId: 'lvl-0', a: { x: 0, y: 0 }, b: { x: W, y: 0 }, offset: -1.2 });
  push({ id: newId('dim'), kind: 'dimension', levelId: 'lvl-0', a: { x: W, y: 0 }, b: { x: W, y: D }, offset: -1.2 });

  for (const e of els) d.elements[e.id] = e;
  return d;
}
