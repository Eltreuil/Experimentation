// Modèle de données BIM. Toutes les longueurs sont stockées en mètres,
// les angles en degrés. Le plan utilise un repère (x vers l'est, y vers le nord).

export type Id = string;

export interface Vec2 {
  x: number;
  y: number;
}

export type Units = 'mm' | 'cm' | 'm';

export interface Level {
  id: Id;
  name: string;
  elevation: number;
  /** Hauteur d'étage par défaut (utilisée pour les murs et escaliers). */
  height: number;
}

export interface WallType {
  id: Id;
  name: string;
  thickness: number;
  color: string;
  function: 'exterior' | 'interior';
  /** Mur de base ou mur-rideau (panneaux vitrés et meneaux). */
  family?: 'basic' | 'curtain';
  /**
   * Structure du mur, de la face extérieure vers la face intérieure.
   * L'extérieur est à droite du sens de tracé (a→b). Si présente, l'épaisseur
   * du type est la somme des couches.
   */
  layers?: WallLayer[];
  /** Mur-rideau : espacement des meneaux verticaux et des traverses horizontales. */
  curtainSpacing?: number;
  curtainRowSpacing?: number;
}

export interface WallLayer {
  name: string;
  thickness: number;
  color: string;
  function: 'structure' | 'insulation' | 'finish' | 'membrane' | 'air';
}

export interface DoorType {
  id: Id;
  name: string;
  width: number;
  height: number;
  color: string;
}

export interface WindowType {
  id: Id;
  name: string;
  width: number;
  height: number;
  sill: number;
  color: string;
}

interface BaseElement {
  id: Id;
  mark?: string;
  comments?: string;
}

export interface Wall extends BaseElement {
  kind: 'wall';
  levelId: Id;
  typeId: Id;
  a: Vec2;
  b: Vec2;
  height: number;
  baseOffset: number;
  /** Contrainte supérieure : hauteur pilotée par un niveau (null = hauteur non contrainte). */
  topLevelId?: Id | null;
  topOffset?: number;
  /** Haut du mur attaché à la sous-face d'un toit. */
  attachRoofId?: Id | null;
}

export interface Door extends BaseElement {
  kind: 'door';
  hostId: Id;
  typeId: Id;
  /** Distance du centre de l'ouverture depuis le point a du mur hôte. */
  offset: number;
  flipHand: boolean;
  flipFacing: boolean;
}

export interface Window extends BaseElement {
  kind: 'window';
  hostId: Id;
  typeId: Id;
  offset: number;
  sill: number;
}

/** Ouverture rectangulaire dans un mur (sans menuiserie). */
export interface WallOpening extends BaseElement {
  kind: 'opening';
  hostId: Id;
  offset: number;
  width: number;
  height: number;
  sill: number;
}

/** Trémie : perce les sols et toits traversés. */
export interface Shaft extends BaseElement {
  kind: 'shaft';
  levelId: Id;
  points: Vec2[];
  height: number;
}

export interface Ceiling extends BaseElement {
  kind: 'ceiling';
  levelId: Id;
  points: Vec2[];
  /** Hauteur de la sous-face au-dessus du niveau. */
  height: number;
  thickness: number;
}

export interface Railing extends BaseElement {
  kind: 'railing';
  levelId: Id;
  /** Tracé ouvert du garde-corps. */
  points: Vec2[];
  height: number;
  baseOffset: number;
}

/** Occurrence d'une famille paramétrique (mobilier, sanitaire, équipement…). */
export interface Component extends BaseElement {
  kind: 'component';
  levelId: Id;
  /** Identifiant de la famille chargée dans le projet. */
  family: string;
  /** Type de la famille (jeu de valeurs des paramètres de type). */
  typeId?: Id;
  pos: Vec2;
  rotation: number;
  /** Décalage vertical par rapport au niveau. */
  offset?: number;
  /** Valeurs des paramètres d'occurrence (écrasent les valeurs par défaut). */
  params?: Record<string, ParamValue>;
}

// ---------------------------------------------------------------------------
// Familles paramétriques

export type ParamValue = number | boolean | string;
export type ParamKind = 'length' | 'number' | 'integer' | 'angle' | 'boolean' | 'text' | 'material';

export interface FamilyParam {
  name: string;
  kind: ParamKind;
  /** Paramètre de type (partagé par toutes les occurrences du type) ou d'occurrence. */
  scope: 'type' | 'instance';
  /** Valeur par défaut. */
  value: ParamValue;
  /** Formule : si présente, la valeur est calculée (paramètre piloté). */
  formula?: string;
}

export interface FamilyType {
  id: Id;
  name: string;
  values: Record<string, ParamValue>;
}

/** Expression : nombre (mètres) ou formule faisant référence aux paramètres. */
export type Expr = number | string;

export interface FamilySolid {
  id: Id;
  name?: string;
  shape: 'box' | 'cylinder';
  x0: Expr;
  x1: Expr;
  y0: Expr;
  y1: Expr;
  z0: Expr;
  z1: Expr;
  /** Couleur « #rrggbb » ou nom d'un paramètre Matériau. */
  material: string;
  /** Visibilité conditionnelle (formule booléenne). */
  visible?: Expr;
  /** Répétition : nombre d'exemplaires et pas ; la variable « i » vaut 0, 1, 2… */
  count?: Expr;
  dx?: Expr;
  dy?: Expr;
  dz?: Expr;
  glass?: boolean;
}

export interface FamilySymbol {
  id: Id;
  shape: 'line' | 'rect' | 'circle';
  /** Ligne : x0,y0 → x1,y1. Rectangle : coins opposés. Cercle : centre (x0,y0) et rayon x1. */
  x0: Expr;
  y0: Expr;
  x1: Expr;
  y1: Expr;
  visible?: Expr;
  count?: Expr;
  dx?: Expr;
  dy?: Expr;
}

export interface FamilyDef {
  id: Id;
  name: string;
  category: string;
  description?: string;
  params: FamilyParam[];
  types: FamilyType[];
  solids: FamilySolid[];
  symbols: FamilySymbol[];
  /** Symbole en plan déduit des volumes (vue de dessus) en plus des symboles 2D. */
  autoSymbol: boolean;
}

export interface TextNote extends BaseElement {
  kind: 'text';
  levelId: Id;
  pos: Vec2;
  text: string;
  /** Hauteur du texte sur papier, en mm. */
  size: number;
  rotation: number;
}

/** Ligne de coupe : génère une vue en coupe. */
export interface Section extends BaseElement {
  kind: 'section';
  name: string;
  a: Vec2;
  b: Vec2;
  /** Profondeur de vue au-delà du plan de coupe. */
  depth: number;
  /** Inverse le sens de visée. */
  flip: boolean;
}

export interface Floor extends BaseElement {
  kind: 'floor';
  levelId: Id;
  points: Vec2[];
  thickness: number;
  offset: number;
}

export type RoofShape = 'flat' | 'mono' | 'gable' | 'hip';

export interface Roof extends BaseElement {
  kind: 'roof';
  levelId: Id;
  points: Vec2[];
  thickness: number;
  /** Pente en degrés des arêtes définissant la pente. */
  slope: number;
  /**
   * Arêtes définissant la pente : plat (aucune), 1 pan (première arête),
   * 2 pans (première arête et arête opposée), 4 pans / croupe (toutes).
   */
  shape?: RoofShape;
  baseOffset: number;
}

export interface Column extends BaseElement {
  kind: 'column';
  levelId: Id;
  pos: Vec2;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  shape: 'rect' | 'round';
}

export interface Room extends BaseElement {
  kind: 'room';
  levelId: Id;
  points: Vec2[];
  name: string;
  number: string;
}

export interface Stair extends BaseElement {
  kind: 'stair';
  levelId: Id;
  a: Vec2;
  b: Vec2;
  width: number;
  height: number;
  maxRiser: number;
}

export interface Dimension extends BaseElement {
  kind: 'dimension';
  levelId: Id;
  a: Vec2;
  b: Vec2;
  offset: number;
}

export interface Grid extends BaseElement {
  kind: 'grid';
  a: Vec2;
  b: Vec2;
  label: string;
}

export type Element =
  | Wall
  | Door
  | Window
  | Floor
  | Roof
  | Column
  | Room
  | Stair
  | Dimension
  | Grid
  | WallOpening
  | Shaft
  | Ceiling
  | Railing
  | Component
  | TextNote
  | Section;

export type ElementKind = Element['kind'];

export type ElementOf<K extends ElementKind> = Extract<Element, { kind: K }>;

export interface ProjectData {
  version: 1;
  name: string;
  units: Units;
  levels: Level[];
  wallTypes: WallType[];
  doorTypes: DoorType[];
  windowTypes: WindowType[];
  /** Familles paramétriques chargées dans le projet. */
  families?: FamilyDef[];
  elements: Record<Id, Element>;
  /** Réglages d'affichage par vue (clé de vue). */
  viewSettings?: Record<string, ViewSettings>;
  /** Informations du cartouche. */
  info?: ProjectInfo;
}

export interface ViewSettings {
  /** Catégories masquées dans la vue. */
  hidden?: ElementKind[];
  /** Échelle de la vue (dénominateur : 100 pour 1/100). */
  scale?: number;
  /** Affiche le niveau inférieur en grisé (plans). */
  underlay?: boolean;
}

export interface ProjectInfo {
  client?: string;
  address?: string;
  author?: string;
  number?: string;
  phase?: string;
}

export const KIND_LABELS: Record<ElementKind, string> = {
  wall: 'Mur',
  door: 'Porte',
  window: 'Fenêtre',
  floor: 'Sol',
  roof: 'Toit',
  column: 'Poteau',
  room: 'Pièce',
  stair: 'Escalier',
  dimension: 'Cote',
  grid: 'Quadrillage',
  opening: 'Ouverture',
  shaft: 'Trémie',
  ceiling: 'Faux-plafond',
  railing: 'Garde-corps',
  component: 'Composant',
  text: 'Texte',
  section: 'Coupe',
};

/** Éléments posés dans un mur hôte. */
export type Hosted = Door | Window | WallOpening;
