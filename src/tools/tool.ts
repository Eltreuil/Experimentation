import type { Vec2 } from '../model/types';
import type { PlanView } from '../views/planView';

export type SnapKind = 'end' | 'mid' | 'vertex' | 'center' | 'intersection' | 'nearest' | 'ortho' | 'increment';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
}

export interface PointerInfo {
  /** Position brute sous le curseur (mètres). */
  raw: Vec2;
  /** Position accrochée. */
  point: Vec2;
  snap: SnapResult;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface Tool {
  readonly hint: string;
  onDown?(p: PointerInfo): void;
  onMove?(p: PointerInfo): void;
  onUp?(p: PointerInfo): void;
  onDblClick?(p: PointerInfo): void;
  /** Retourne true si la touche a été consommée. */
  onKey?(e: KeyboardEvent): boolean;
  /** Échap : retourne true si l'outil a annulé une saisie en cours (sinon on repasse en sélection). */
  cancel?(): boolean;
  draw?(ctx: CanvasRenderingContext2D): void;
  /** Point de départ utilisé pour l'accrochage orthogonal. */
  anchor?(): Vec2 | null;
  /** Sélection d'éléments à ne pas prendre en compte pour l'accrochage. */
  readonly snapExclude?: Set<string>;
}

export type ToolFactory = (view: PlanView) => Tool;
