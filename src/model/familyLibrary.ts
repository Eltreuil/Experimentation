// Bibliothèque de familles paramétriques livrée avec l'application.
import { COMPONENT_FAMILIES, type ComponentFamily } from './components';
import type { FamilyDef, FamilyParam, FamilySolid, FamilySymbol } from './types';

const r = (n: number) => Math.round(n * 1e4) / 1e4;
/** Expression « coefficient × paramètre » lisible. */
const k = (c: number, p: string): string => (c === 0 ? '0' : c === 1 ? p : c === -1 ? `-${p}` : `${r(c)} * ${p}`);

const dims = (w: number, d: number, h: number): FamilyParam[] => [
  { name: 'Largeur', kind: 'length', scope: 'type', value: w },
  { name: 'Profondeur', kind: 'length', scope: 'type', value: d },
  { name: 'Hauteur', kind: 'length', scope: 'type', value: h },
];

/** Convertit une famille de l'ancienne bibliothèque (coordonnées normalisées). */
function fromLegacy(f: ComponentFamily): FamilyDef {
  const solids: FamilySolid[] = f.boxes.map((b, i) => ({
    id: `s${i + 1}`,
    shape: b.round ? 'cylinder' : 'box',
    x0: k(b.x0, 'Largeur'),
    x1: k(b.x1, 'Largeur'),
    y0: k(b.y0, 'Profondeur'),
    y1: k(b.y1, 'Profondeur'),
    z0: k(b.z0, 'Hauteur'),
    z1: k(b.z1, 'Hauteur'),
    material: b.color,
    glass: b.color === '#cfe6f5',
  }));
  const symbols: FamilySymbol[] = f.plan.map((p, i) =>
    p.t === 'circle'
      ? { id: `p${i + 1}`, shape: 'circle', x0: k(p.cx, 'Largeur'), y0: k(p.cy, 'Profondeur'), x1: k(p.r, 'min(Largeur; Profondeur)'), y1: 0 }
      : { id: `p${i + 1}`, shape: p.t, x0: k(p.x0, 'Largeur'), y0: k(p.y0, 'Profondeur'), x1: k(p.x1, 'Largeur'), y1: k(p.y1, 'Profondeur') },
  );
  return {
    id: f.id,
    name: f.name.replace(/\s+\d+\s*×\s*\d+$/, ''),
    category: f.category,
    params: dims(f.width, f.depth, f.height),
    types: [{ id: 't1', name: `${Math.round(f.width * 100)} × ${Math.round(f.depth * 100)}`, values: { Largeur: f.width, Profondeur: f.depth, Hauteur: f.height } }],
    solids,
    symbols,
    autoSymbol: false,
  };
}

/** Table rectangulaire avec chaises réparties automatiquement selon sa longueur. */
const TABLE: FamilyDef = {
  id: 'param-table',
  name: 'Table paramétrique',
  category: 'Mobilier',
  description: 'Le nombre de chaises dépend de la longueur (une chaise par 60 cm de chaque côté).',
  params: [
    { name: 'Longueur', kind: 'length', scope: 'type', value: 1.8 },
    { name: 'Largeur', kind: 'length', scope: 'type', value: 0.9 },
    { name: 'Hauteur', kind: 'length', scope: 'type', value: 0.75 },
    { name: 'Épaisseur plateau', kind: 'length', scope: 'type', value: 0.04 },
    { name: 'Section pied', kind: 'length', scope: 'type', value: 0.06 },
    { name: 'Matériau plateau', kind: 'material', scope: 'type', value: '#b48a5a' },
    { name: 'Matériau chaises', kind: 'material', scope: 'type', value: '#4a4f55' },
    { name: 'Avec chaises', kind: 'boolean', scope: 'instance', value: true },
    { name: 'Chaises par côté', kind: 'integer', scope: 'type', value: 3, formula: 'max(1; rounddown(Longueur / 60 cm))' },
  ],
  types: [
    { id: 't1', name: '180 × 90', values: { Longueur: 1.8, Largeur: 0.9 } },
    { id: 't2', name: '240 × 100', values: { Longueur: 2.4, Largeur: 1.0 } },
    { id: 't3', name: '120 × 80', values: { Longueur: 1.2, Largeur: 0.8 } },
  ],
  solids: [
    { id: 'plateau', name: 'Plateau', shape: 'box', x0: '-Longueur / 2', x1: 'Longueur / 2', y0: '-Largeur / 2', y1: 'Largeur / 2', z0: 'Hauteur - [Épaisseur plateau]', z1: 'Hauteur', material: 'Matériau plateau' },
    {
      id: 'pieds',
      name: 'Pieds',
      shape: 'box',
      count: 4,
      x0: 'if(i < 2; -Longueur / 2 + 5 cm; Longueur / 2 - 5 cm - [Section pied])',
      x1: 'if(i < 2; -Longueur / 2 + 5 cm + [Section pied]; Longueur / 2 - 5 cm)',
      y0: 'if(i % 2 = 0; -Largeur / 2 + 5 cm; Largeur / 2 - 5 cm - [Section pied])',
      y1: 'if(i % 2 = 0; -Largeur / 2 + 5 cm + [Section pied]; Largeur / 2 - 5 cm)',
      z0: 0,
      z1: 'Hauteur - [Épaisseur plateau]',
      material: 'Matériau plateau',
    },
    {
      id: 'chaises-n',
      name: 'Chaises (côté nord)',
      shape: 'box',
      visible: '[Avec chaises]',
      count: '[Chaises par côté]',
      x0: '-Longueur / 2 + (i + 0.5) * Longueur / [Chaises par côté] - 22 cm',
      x1: '-Longueur / 2 + (i + 0.5) * Longueur / [Chaises par côté] + 22 cm',
      y0: 'Largeur / 2 + 5 cm',
      y1: 'Largeur / 2 + 50 cm',
      z0: 0,
      z1: '45 cm',
      material: 'Matériau chaises',
    },
    {
      id: 'chaises-s',
      name: 'Chaises (côté sud)',
      shape: 'box',
      visible: '[Avec chaises]',
      count: '[Chaises par côté]',
      x0: '-Longueur / 2 + (i + 0.5) * Longueur / [Chaises par côté] - 22 cm',
      x1: '-Longueur / 2 + (i + 0.5) * Longueur / [Chaises par côté] + 22 cm',
      y0: '-Largeur / 2 - 50 cm',
      y1: '-Largeur / 2 - 5 cm',
      z0: 0,
      z1: '45 cm',
      material: 'Matériau chaises',
    },
  ],
  symbols: [],
  autoSymbol: true,
};

/** Étagère / bibliothèque : tablettes réparties sur la hauteur. */
const SHELF: FamilyDef = {
  id: 'param-shelf',
  name: 'Étagère paramétrique',
  category: 'Mobilier',
  params: [
    { name: 'Largeur', kind: 'length', scope: 'type', value: 1.0 },
    { name: 'Profondeur', kind: 'length', scope: 'type', value: 0.35 },
    { name: 'Hauteur', kind: 'length', scope: 'type', value: 2.0 },
    { name: 'Épaisseur', kind: 'length', scope: 'type', value: 0.025 },
    { name: 'Nombre de tablettes', kind: 'integer', scope: 'instance', value: 5 },
    { name: 'Matériau', kind: 'material', scope: 'type', value: '#d9c4a0' },
  ],
  types: [
    { id: 't1', name: '100 × 35 × 200', values: {} },
    { id: 't2', name: '80 × 30 × 180', values: { Largeur: 0.8, Profondeur: 0.3, Hauteur: 1.8 } },
  ],
  solids: [
    { id: 'g', name: 'Montant gauche', shape: 'box', x0: '-Largeur / 2', x1: '-Largeur / 2 + Épaisseur', y0: '-Profondeur / 2', y1: 'Profondeur / 2', z0: 0, z1: 'Hauteur', material: 'Matériau' },
    { id: 'd', name: 'Montant droit', shape: 'box', x0: 'Largeur / 2 - Épaisseur', x1: 'Largeur / 2', y0: '-Profondeur / 2', y1: 'Profondeur / 2', z0: 0, z1: 'Hauteur', material: 'Matériau' },
    {
      id: 't',
      name: 'Tablettes',
      shape: 'box',
      count: '[Nombre de tablettes]',
      dz: '(Hauteur - Épaisseur) / max(1; [Nombre de tablettes] - 1)',
      x0: '-Largeur / 2 + Épaisseur',
      x1: 'Largeur / 2 - Épaisseur',
      y0: '-Profondeur / 2',
      y1: 'Profondeur / 2',
      z0: 0,
      z1: 'Épaisseur',
      material: 'Matériau',
    },
  ],
  symbols: [
    { id: 'c', shape: 'rect', x0: '-Largeur / 2', y0: '-Profondeur / 2', x1: 'Largeur / 2', y1: 'Profondeur / 2' },
    { id: 'l', shape: 'line', x0: '-Largeur / 2', y0: '-Profondeur / 2', x1: 'Largeur / 2', y1: 'Profondeur / 2' },
  ],
  autoSymbol: false,
};

/** Linéaire de cuisine : caissons de 60 cm, plan de travail, évier optionnel. */
const KITCHEN: FamilyDef = {
  id: 'param-kitchen',
  name: 'Linéaire de cuisine paramétrique',
  category: 'Cuisine',
  params: [
    { name: 'Longueur', kind: 'length', scope: 'instance', value: 2.4 },
    { name: 'Profondeur', kind: 'length', scope: 'type', value: 0.65 },
    { name: 'Hauteur', kind: 'length', scope: 'type', value: 0.9 },
    { name: 'Largeur caisson', kind: 'length', scope: 'type', value: 0.6 },
    { name: 'Avec évier', kind: 'boolean', scope: 'instance', value: true },
    { name: 'Avec plaque', kind: 'boolean', scope: 'instance', value: true },
    { name: 'Façades', kind: 'material', scope: 'type', value: '#f4f4f2' },
    { name: 'Plan de travail', kind: 'material', scope: 'type', value: '#4a4f55' },
    { name: 'Nombre de caissons', kind: 'integer', scope: 'type', value: 4, formula: 'max(1; rounddown(Longueur / [Largeur caisson]))' },
  ],
  types: [
    { id: 't1', name: 'Blanc / plan anthracite', values: {} },
    { id: 't2', name: 'Bois / plan blanc', values: { Façades: '#b48a5a', 'Plan de travail': '#f4f4f2' } },
  ],
  solids: [
    { id: 'plinthe', name: 'Plinthe', shape: 'box', x0: '-Longueur / 2', x1: 'Longueur / 2', y0: '-Profondeur / 2 + 5 cm', y1: 'Profondeur / 2', z0: 0, z1: '10 cm', material: '#3a3d41' },
    {
      id: 'caissons',
      name: 'Caissons',
      shape: 'box',
      count: '[Nombre de caissons]',
      x0: '-Longueur / 2 + i * Longueur / [Nombre de caissons] + 3 mm',
      x1: '-Longueur / 2 + (i + 1) * Longueur / [Nombre de caissons] - 3 mm',
      y0: '-Profondeur / 2',
      y1: 'Profondeur / 2 - 2 cm',
      z0: '10 cm',
      z1: 'Hauteur - 4 cm',
      material: 'Façades',
    },
    { id: 'plan', name: 'Plan de travail', shape: 'box', x0: '-Longueur / 2', x1: 'Longueur / 2', y0: '-Profondeur / 2 - 2 cm', y1: 'Profondeur / 2', z0: 'Hauteur - 4 cm', z1: 'Hauteur', material: 'Plan de travail' },
    { id: 'evier', name: 'Évier', shape: 'box', visible: '[Avec évier]', x0: '-Longueur / 2 + 20 cm', x1: '-Longueur / 2 + 70 cm', y0: '-20 cm', y1: '20 cm', z0: 'Hauteur', z1: 'Hauteur + 5 mm', material: '#c8ccd0' },
    { id: 'plaque', name: 'Plaque de cuisson', shape: 'box', visible: '[Avec plaque] et Longueur >= 1.5', x0: 'Longueur / 2 - 80 cm', x1: 'Longueur / 2 - 20 cm', y0: '-25 cm', y1: '25 cm', z0: 'Hauteur', z1: 'Hauteur + 5 mm', material: '#151618' },
  ],
  symbols: [
    { id: 'c', shape: 'rect', x0: '-Longueur / 2', y0: '-Profondeur / 2', x1: 'Longueur / 2', y1: 'Profondeur / 2' },
    { id: 'e', shape: 'rect', visible: '[Avec évier]', x0: '-Longueur / 2 + 20 cm', y0: '-20 cm', x1: '-Longueur / 2 + 70 cm', y1: '20 cm' },
    { id: 'f1', shape: 'circle', visible: '[Avec plaque] et Longueur >= 1.5', count: 2, dx: '30 cm', x0: 'Longueur / 2 - 65 cm', y0: '-12 cm', x1: '10 cm', y1: 0 },
    { id: 'f2', shape: 'circle', visible: '[Avec plaque] et Longueur >= 1.5', count: 2, dx: '30 cm', x0: 'Longueur / 2 - 65 cm', y0: '12 cm', x1: '10 cm', y1: 0 },
  ],
  autoSymbol: false,
};

/** Lit avec tête de lit et tables de chevet optionnelles. */
const BED: FamilyDef = {
  id: 'param-bed',
  name: 'Lit paramétrique',
  category: 'Mobilier',
  params: [
    { name: 'Largeur couchage', kind: 'length', scope: 'type', value: 1.6 },
    { name: 'Longueur couchage', kind: 'length', scope: 'type', value: 2.0 },
    { name: 'Hauteur', kind: 'length', scope: 'type', value: 0.5 },
    { name: 'Avec chevets', kind: 'boolean', scope: 'instance', value: true },
    { name: 'Tissu', kind: 'material', scope: 'instance', value: '#8fa3b8' },
    { name: 'Bois', kind: 'material', scope: 'type', value: '#b48a5a' },
    { name: 'Places', kind: 'integer', scope: 'type', value: 2, formula: 'if([Largeur couchage] >= 1.2; 2; 1)' },
  ],
  types: [
    { id: 't1', name: '160 × 200', values: {} },
    { id: 't2', name: '140 × 190', values: { 'Largeur couchage': 1.4, 'Longueur couchage': 1.9 } },
    { id: 't3', name: '90 × 190', values: { 'Largeur couchage': 0.9, 'Longueur couchage': 1.9 } },
  ],
  solids: [
    { id: 'sommier', name: 'Sommier', shape: 'box', x0: '-[Largeur couchage] / 2', x1: '[Largeur couchage] / 2', y0: '-[Longueur couchage] / 2', y1: '[Longueur couchage] / 2', z0: 0, z1: 'Hauteur', material: '#f4f4f2' },
    { id: 'couette', name: 'Couette', shape: 'box', x0: '-[Largeur couchage] / 2 - 2 cm', x1: '[Largeur couchage] / 2 + 2 cm', y0: '-[Longueur couchage] / 2', y1: '[Longueur couchage] / 2 - 45 cm', z0: 'Hauteur', z1: 'Hauteur + 6 cm', material: 'Tissu' },
    {
      id: 'oreillers',
      name: 'Oreillers',
      shape: 'box',
      count: 'Places',
      x0: '-[Largeur couchage] / 2 + 8 cm + i * ([Largeur couchage] - 16 cm) / Places',
      x1: '-[Largeur couchage] / 2 + i * ([Largeur couchage] - 16 cm) / Places + ([Largeur couchage] - 16 cm) / Places',
      y0: '[Longueur couchage] / 2 - 40 cm',
      y1: '[Longueur couchage] / 2 - 8 cm',
      z0: 'Hauteur',
      z1: 'Hauteur + 10 cm',
      material: '#ffffff',
    },
    { id: 'tete', name: 'Tête de lit', shape: 'box', x0: '-[Largeur couchage] / 2 - 5 cm', x1: '[Largeur couchage] / 2 + 5 cm', y0: '[Longueur couchage] / 2', y1: '[Longueur couchage] / 2 + 6 cm', z0: 0, z1: '1 m', material: 'Bois' },
    { id: 'chevet-g', name: 'Chevet gauche', shape: 'box', visible: '[Avec chevets]', x0: '-[Largeur couchage] / 2 - 50 cm', x1: '-[Largeur couchage] / 2 - 8 cm', y0: '[Longueur couchage] / 2 - 40 cm', y1: '[Longueur couchage] / 2', z0: 0, z1: '50 cm', material: 'Bois' },
    { id: 'chevet-d', name: 'Chevet droit', shape: 'box', visible: '[Avec chevets]', x0: '[Largeur couchage] / 2 + 8 cm', x1: '[Largeur couchage] / 2 + 50 cm', y0: '[Longueur couchage] / 2 - 40 cm', y1: '[Longueur couchage] / 2', z0: 0, z1: '50 cm', material: 'Bois' },
  ],
  symbols: [
    { id: 'c', shape: 'rect', x0: '-[Largeur couchage] / 2', y0: '-[Longueur couchage] / 2', x1: '[Largeur couchage] / 2', y1: '[Longueur couchage] / 2' },
    { id: 'pli', shape: 'line', x0: '-[Largeur couchage] / 2', y0: '[Longueur couchage] / 2 - 45 cm', x1: '[Largeur couchage] / 2', y1: '[Longueur couchage] / 2 - 45 cm' },
    {
      id: 'or',
      shape: 'rect',
      count: 'Places',
      x0: '-[Largeur couchage] / 2 + 8 cm + i * ([Largeur couchage] - 16 cm) / Places',
      y0: '[Longueur couchage] / 2 - 40 cm',
      x1: '-[Largeur couchage] / 2 + i * ([Largeur couchage] - 16 cm) / Places + ([Largeur couchage] - 16 cm) / Places',
      y1: '[Longueur couchage] / 2 - 8 cm',
    },
    { id: 'tl', shape: 'rect', x0: '-[Largeur couchage] / 2 - 5 cm', y0: '[Longueur couchage] / 2', x1: '[Largeur couchage] / 2 + 5 cm', y1: '[Longueur couchage] / 2 + 6 cm' },
    { id: 'cg', shape: 'rect', visible: '[Avec chevets]', x0: '-[Largeur couchage] / 2 - 50 cm', y0: '[Longueur couchage] / 2 - 40 cm', x1: '-[Largeur couchage] / 2 - 8 cm', y1: '[Longueur couchage] / 2' },
    { id: 'cd', shape: 'rect', visible: '[Avec chevets]', x0: '[Largeur couchage] / 2 + 8 cm', y0: '[Longueur couchage] / 2 - 40 cm', x1: '[Largeur couchage] / 2 + 50 cm', y1: '[Longueur couchage] / 2' },
  ],
  autoSymbol: false,
};

/** Bloc générique : point de départ pour créer une famille. */
export function blankFamily(id: string, name = 'Nouvelle famille'): FamilyDef {
  return {
    id,
    name,
    category: 'Modèle générique',
    params: dims(1, 0.6, 0.9).concat([{ name: 'Matériau', kind: 'material', scope: 'type', value: '#b9bec4' }]),
    types: [{ id: 't1', name: 'Type 1', values: {} }],
    solids: [
      { id: 's1', name: 'Volume', shape: 'box', x0: '-Largeur / 2', x1: 'Largeur / 2', y0: '-Profondeur / 2', y1: 'Profondeur / 2', z0: 0, z1: 'Hauteur', material: 'Matériau' },
    ],
    symbols: [],
    autoSymbol: true,
  };
}

/** Familles chargées dans un nouveau projet. */
export function defaultFamilies(): FamilyDef[] {
  return [...[TABLE, BED, KITCHEN, SHELF].map((f) => structuredClone(f)), ...COMPONENT_FAMILIES.map(fromLegacy)];
}
