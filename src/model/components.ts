// Bibliothèque de composants (familles chargeables) : mobilier, sanitaires,
// équipements. Chaque famille décrit un symbole en plan et des volumes 3D en
// coordonnées normalisées (-0,5…0,5 en largeur/profondeur, 0…1 en hauteur),
// mis à l'échelle par les dimensions de l'occurrence.

export type PlanPrim =
  | { t: 'rect'; x0: number; y0: number; x1: number; y1: number; r?: number }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'line'; x0: number; y0: number; x1: number; y1: number };

export interface Box3 {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  color: string;
  round?: boolean;
}

export interface ComponentFamily {
  id: string;
  name: string;
  category: 'Mobilier' | 'Sanitaire' | 'Cuisine' | 'Équipement' | 'Extérieur';
  width: number;
  depth: number;
  height: number;
  plan: PlanPrim[];
  boxes: Box3[];
}

const WOOD = '#b48a5a';
const FABRIC = '#8fa3b8';
const WHITE = '#f4f4f2';
const STEEL = '#b9bec4';
const DARK = '#4a4f55';
const GREEN = '#5d8a4a';

export const COMPONENT_FAMILIES: ComponentFamily[] = [
  {
    id: 'bed-double',
    name: 'Lit double 160 × 200',
    category: 'Mobilier',
    width: 1.6,
    depth: 2.1,
    height: 0.9,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'rect', x0: -0.42, y0: 0.3, x1: -0.04, y1: 0.45, r: 0.03 },
      { t: 'rect', x0: 0.04, y0: 0.3, x1: 0.42, y1: 0.45, r: 0.03 },
      { t: 'line', x0: -0.5, y0: 0.2, x1: 0.5, y1: 0.2 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 0.5, color: WHITE },
      { x0: -0.5, x1: 0.5, y0: 0.45, y1: 0.5, z0: 0, z1: 1, color: WOOD },
      { x0: -0.42, x1: -0.04, y0: 0.3, y1: 0.44, z0: 0.5, z1: 0.6, color: WHITE },
      { x0: 0.04, x1: 0.42, y0: 0.3, y1: 0.44, z0: 0.5, z1: 0.6, color: WHITE },
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.2, z0: 0.5, z1: 0.56, color: FABRIC },
    ],
  },
  {
    id: 'bed-single',
    name: 'Lit simple 90 × 190',
    category: 'Mobilier',
    width: 0.9,
    depth: 2.0,
    height: 0.9,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'rect', x0: -0.4, y0: 0.3, x1: 0.4, y1: 0.45, r: 0.03 },
      { t: 'line', x0: -0.5, y0: 0.2, x1: 0.5, y1: 0.2 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 0.5, color: WHITE },
      { x0: -0.5, x1: 0.5, y0: 0.45, y1: 0.5, z0: 0, z1: 1, color: WOOD },
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.2, z0: 0.5, z1: 0.56, color: FABRIC },
    ],
  },
  {
    id: 'sofa',
    name: 'Canapé 3 places',
    category: 'Mobilier',
    width: 2.2,
    depth: 0.9,
    height: 0.85,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5, r: 0.05 },
      { t: 'rect', x0: -0.42, y0: -0.45, x1: 0.42, y1: 0.22 },
      { t: 'line', x0: -0.14, y0: -0.45, x1: -0.14, y1: 0.22 },
      { t: 'line', x0: 0.14, y0: -0.45, x1: 0.14, y1: 0.22 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 0.5, color: FABRIC },
      { x0: -0.5, x1: 0.5, y0: 0.22, y1: 0.5, z0: 0.5, z1: 1, color: FABRIC },
      { x0: -0.5, x1: -0.42, y0: -0.5, y1: 0.22, z0: 0.5, z1: 0.75, color: FABRIC },
      { x0: 0.42, x1: 0.5, y0: -0.5, y1: 0.22, z0: 0.5, z1: 0.75, color: FABRIC },
    ],
  },
  {
    id: 'armchair',
    name: 'Fauteuil',
    category: 'Mobilier',
    width: 0.85,
    depth: 0.85,
    height: 0.85,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5, r: 0.08 },
      { t: 'rect', x0: -0.32, y0: -0.45, x1: 0.32, y1: 0.22 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 0.5, color: FABRIC },
      { x0: -0.5, x1: 0.5, y0: 0.22, y1: 0.5, z0: 0.5, z1: 1, color: FABRIC },
    ],
  },
  {
    id: 'table-dining',
    name: 'Table à manger 6 personnes',
    category: 'Mobilier',
    width: 1.8,
    depth: 0.9,
    height: 0.75,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'rect', x0: -0.38, y0: 0.55, x1: -0.15, y1: 0.85, r: 0.03 },
      { t: 'rect', x0: -0.12, y0: 0.55, x1: 0.12, y1: 0.85, r: 0.03 },
      { t: 'rect', x0: 0.15, y0: 0.55, x1: 0.38, y1: 0.85, r: 0.03 },
      { t: 'rect', x0: -0.38, y0: -0.85, x1: -0.15, y1: -0.55, r: 0.03 },
      { t: 'rect', x0: -0.12, y0: -0.85, x1: 0.12, y1: -0.55, r: 0.03 },
      { t: 'rect', x0: 0.15, y0: -0.85, x1: 0.38, y1: -0.55, r: 0.03 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.94, z1: 1, color: WOOD },
      { x0: -0.48, x1: -0.44, y0: -0.46, y1: -0.38, z0: 0, z1: 0.94, color: WOOD },
      { x0: 0.44, x1: 0.48, y0: -0.46, y1: -0.38, z0: 0, z1: 0.94, color: WOOD },
      { x0: -0.48, x1: -0.44, y0: 0.38, y1: 0.46, z0: 0, z1: 0.94, color: WOOD },
      { x0: 0.44, x1: 0.48, y0: 0.38, y1: 0.46, z0: 0, z1: 0.94, color: WOOD },
      { x0: -0.38, x1: -0.15, y0: 0.55, y1: 0.85, z0: 0, z1: 0.6, color: DARK },
      { x0: -0.12, x1: 0.12, y0: 0.55, y1: 0.85, z0: 0, z1: 0.6, color: DARK },
      { x0: 0.15, x1: 0.38, y0: 0.55, y1: 0.85, z0: 0, z1: 0.6, color: DARK },
      { x0: -0.38, x1: -0.15, y0: -0.85, y1: -0.55, z0: 0, z1: 0.6, color: DARK },
      { x0: -0.12, x1: 0.12, y0: -0.85, y1: -0.55, z0: 0, z1: 0.6, color: DARK },
      { x0: 0.15, x1: 0.38, y0: -0.85, y1: -0.55, z0: 0, z1: 0.6, color: DARK },
    ],
  },
  {
    id: 'table-round',
    name: 'Table ronde Ø 110',
    category: 'Mobilier',
    width: 1.1,
    depth: 1.1,
    height: 0.75,
    plan: [{ t: 'circle', cx: 0, cy: 0, r: 0.5 }],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.94, z1: 1, color: WOOD, round: true },
      { x0: -0.06, x1: 0.06, y0: -0.06, y1: 0.06, z0: 0, z1: 0.94, color: DARK, round: true },
    ],
  },
  {
    id: 'desk',
    name: 'Bureau 140 × 70',
    category: 'Mobilier',
    width: 1.4,
    depth: 0.7,
    height: 0.75,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'circle', cx: 0, cy: -0.85, r: 0.2 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.95, z1: 1, color: WOOD },
      { x0: -0.5, x1: -0.46, y0: -0.5, y1: 0.5, z0: 0, z1: 0.95, color: WOOD },
      { x0: 0.46, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 0.95, color: WOOD },
    ],
  },
  {
    id: 'wardrobe',
    name: 'Armoire 120 × 60',
    category: 'Mobilier',
    width: 1.2,
    depth: 0.6,
    height: 2.2,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'line', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'line', x0: -0.5, y0: 0.5, x1: 0.5, y1: -0.5 },
    ],
    boxes: [{ x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 1, color: WOOD }],
  },
  {
    id: 'wc',
    name: 'WC suspendu',
    category: 'Sanitaire',
    width: 0.38,
    depth: 0.55,
    height: 0.8,
    plan: [
      { t: 'rect', x0: -0.5, y0: 0.25, x1: 0.5, y1: 0.5 },
      { t: 'circle', cx: 0, cy: -0.05, r: 0.42 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: 0.25, y1: 0.5, z0: 0, z1: 1, color: WHITE },
      { x0: -0.45, x1: 0.45, y0: -0.5, y1: 0.3, z0: 0.3, z1: 0.52, color: WHITE, round: true },
    ],
  },
  {
    id: 'sink',
    name: 'Lavabo',
    category: 'Sanitaire',
    width: 0.6,
    depth: 0.45,
    height: 0.85,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5, r: 0.04 },
      { t: 'circle', cx: 0, cy: -0.05, r: 0.3 },
    ],
    boxes: [{ x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.82, z1: 1, color: WHITE }],
  },
  {
    id: 'bathtub',
    name: 'Baignoire 170 × 75',
    category: 'Sanitaire',
    width: 1.7,
    depth: 0.75,
    height: 0.58,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'rect', x0: -0.44, y0: -0.38, x1: 0.44, y1: 0.38, r: 0.12 },
      { t: 'circle', cx: 0.38, cy: 0, r: 0.03 },
    ],
    boxes: [{ x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 1, color: WHITE }],
  },
  {
    id: 'shower',
    name: 'Douche 90 × 90',
    category: 'Sanitaire',
    width: 0.9,
    depth: 0.9,
    height: 2.0,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'line', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'line', x0: -0.5, y0: 0.5, x1: 0.5, y1: -0.5 },
      { t: 'circle', cx: 0, cy: 0, r: 0.04 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 0.02, color: WHITE },
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: -0.49, z0: 0.02, z1: 1, color: '#cfe6f5' },
    ],
  },
  {
    id: 'kitchen-run',
    name: 'Plan de travail 240 × 65',
    category: 'Cuisine',
    width: 2.4,
    depth: 0.65,
    height: 0.9,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'rect', x0: -0.3, y0: -0.3, x1: -0.08, y1: 0.3, r: 0.03 },
      { t: 'circle', cx: 0.18, cy: -0.15, r: 0.1 },
      { t: 'circle', cx: 0.33, cy: -0.15, r: 0.1 },
      { t: 'circle', cx: 0.18, cy: 0.18, r: 0.1 },
      { t: 'circle', cx: 0.33, cy: 0.18, r: 0.1 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.45, y1: 0.5, z0: 0, z1: 0.95, color: WHITE },
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.95, z1: 1, color: DARK },
    ],
  },
  {
    id: 'fridge',
    name: 'Réfrigérateur',
    category: 'Cuisine',
    width: 0.6,
    depth: 0.65,
    height: 1.85,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 },
      { t: 'line', x0: -0.5, y0: -0.4, x1: 0.5, y1: -0.4 },
    ],
    boxes: [{ x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 1, color: STEEL }],
  },
  {
    id: 'island',
    name: 'Îlot central 180 × 90',
    category: 'Cuisine',
    width: 1.8,
    depth: 0.9,
    height: 0.9,
    plan: [{ t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 }],
    boxes: [
      { x0: -0.47, x1: 0.47, y0: -0.4, y1: 0.47, z0: 0, z1: 0.95, color: WHITE },
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.95, z1: 1, color: DARK },
    ],
  },
  {
    id: 'boiler',
    name: 'Chaudière / ballon',
    category: 'Équipement',
    width: 0.6,
    depth: 0.6,
    height: 1.8,
    plan: [
      { t: 'circle', cx: 0, cy: 0, r: 0.5 },
      { t: 'line', x0: -0.35, y0: -0.35, x1: 0.35, y1: 0.35 },
    ],
    boxes: [{ x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 1, color: STEEL, round: true }],
  },
  {
    id: 'tree',
    name: 'Arbre',
    category: 'Extérieur',
    width: 4,
    depth: 4,
    height: 6,
    plan: [
      { t: 'circle', cx: 0, cy: 0, r: 0.5 },
      { t: 'circle', cx: 0, cy: 0, r: 0.04 },
      { t: 'line', x0: -0.3, y0: 0, x1: 0.3, y1: 0 },
      { t: 'line', x0: 0, y0: -0.3, x1: 0, y1: 0.3 },
    ],
    boxes: [
      { x0: -0.04, x1: 0.04, y0: -0.04, y1: 0.04, z0: 0, z1: 0.4, color: '#6b4a2f', round: true },
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.35, z1: 1, color: GREEN, round: true },
    ],
  },
  {
    id: 'car',
    name: 'Voiture',
    category: 'Extérieur',
    width: 1.8,
    depth: 4.5,
    height: 1.5,
    plan: [
      { t: 'rect', x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5, r: 0.15 },
      { t: 'rect', x0: -0.4, y0: -0.25, x1: 0.4, y1: 0.18, r: 0.06 },
    ],
    boxes: [
      { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0.1, z1: 0.5, color: '#2d5f9a' },
      { x0: -0.42, x1: 0.42, y0: -0.25, y1: 0.2, z0: 0.5, z1: 1, color: '#2d5f9a' },
    ],
  },
];

export function componentFamily(id: string): ComponentFamily {
  return COMPONENT_FAMILIES.find((f) => f.id === id) ?? COMPONENT_FAMILIES[0];
}
