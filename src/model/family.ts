// Familles paramétriques : résolution des paramètres (types, occurrences,
// formules) et génération de la géométrie (volumes 3D et symbole en plan).
import { ExprError, evalExpr, references, toBool, toNumber, type Value } from './expr';
import type { Component, Expr, FamilyDef, FamilyParam, FamilySolid, FamilySymbol, FamilyType, Id, ParamValue, Vec2 } from './types';

export interface EvalBox {
  shape: 'box' | 'cylinder';
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  color: string;
  glass: boolean;
}

export type EvalPrim =
  | { t: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'circle'; cx: number; cy: number; r: number };

export interface FamilyResult {
  values: Record<string, Value>;
  boxes: EvalBox[];
  prims: EvalPrim[];
  /** Emprise en plan (repère local de la famille). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  errors: string[];
}

const MAX_REPEAT = 500;
const DEFAULT_COLOR = '#b9bec4';

/** Valeurs des paramètres d'une occurrence : défauts ← type ← occurrence ← formules. */
export function resolveParams(fam: FamilyDef, type: FamilyType | undefined, overrides: Record<string, ParamValue> = {}, errors: string[] = []): Record<string, Value> {
  const byName = new Map(fam.params.map((p) => [p.name, p]));
  const raw = new Map<string, Value>();
  for (const p of fam.params) {
    let v: Value = p.value;
    if (p.scope === 'type' && type && p.name in type.values) v = type.values[p.name];
    if (p.scope === 'instance' && p.name in overrides) v = overrides[p.name];
    raw.set(p.name, coerce(p, v));
  }
  const done = new Map<string, Value>();
  const visiting = new Set<string>();
  const resolve = (name: string): Value | undefined => {
    if (done.has(name)) return done.get(name);
    const p = byName.get(name);
    if (!p) return undefined;
    if (!p.formula) {
      done.set(name, raw.get(name)!);
      return raw.get(name);
    }
    if (visiting.has(name)) {
      errors.push(`Référence circulaire sur « ${name} »`);
      return raw.get(name);
    }
    visiting.add(name);
    let v: Value;
    try {
      v = coerce(p, evalExpr(p.formula, resolve));
    } catch (e) {
      errors.push(`${name} : ${(e as Error).message}`);
      v = raw.get(name)!;
    }
    visiting.delete(name);
    done.set(name, v);
    return v;
  };
  const out: Record<string, Value> = {};
  for (const p of fam.params) out[p.name] = resolve(p.name)!;
  return out;
}

function coerce(p: FamilyParam, v: Value): Value {
  switch (p.kind) {
    case 'boolean':
      return toBool(v);
    case 'text':
    case 'material':
      return String(v);
    case 'integer':
      return Math.round(toNumber(v));
    default:
      return toNumber(v);
  }
}

/** Évalue la géométrie d'une famille pour un jeu de paramètres. */
export function evaluateFamily(fam: FamilyDef, typeId?: Id, overrides: Record<string, ParamValue> = {}): FamilyResult {
  const errors: string[] = [];
  const type = fam.types.find((t) => t.id === typeId) ?? fam.types[0];
  const values = resolveParams(fam, type, overrides, errors);
  const boxes: EvalBox[] = [];
  const prims: EvalPrim[] = [];

  const scoped = (i: number) => (name: string): Value | undefined => (name === 'i' ? i : values[name]);
  const n = (e: Expr | undefined, look: (name: string) => Value | undefined, def = 0): number => {
    if (e === undefined || e === '') return def;
    return toNumber(evalExpr(e, look));
  };
  const repeat = (item: { count?: Expr; visible?: Expr }, label: string, fn: (i: number, look: (name: string) => Value | undefined) => void) => {
    try {
      if (item.visible !== undefined && item.visible !== '' && !toBool(evalExpr(item.visible, scoped(0)))) return;
      const count = Math.max(0, Math.min(MAX_REPEAT, Math.round(n(item.count, scoped(0), 1))));
      for (let i = 0; i < count; i++) fn(i, scoped(i));
    } catch (e) {
      errors.push(`${label} : ${(e as Error).message}`);
    }
  };

  fam.solids.forEach((s: FamilySolid, k) => {
    repeat(s, s.name || `Volume ${k + 1}`, (i, look) => {
      const dx = n(s.dx, look) * i;
      const dy = n(s.dy, look) * i;
      const dz = n(s.dz, look) * i;
      const x0 = n(s.x0, look) + dx;
      const x1 = n(s.x1, look) + dx;
      const y0 = n(s.y0, look) + dy;
      const y1 = n(s.y1, look) + dy;
      const z0 = n(s.z0, look) + dz;
      const z1 = n(s.z1, look) + dz;
      if (Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6 || Math.abs(z1 - z0) < 1e-6) return;
      boxes.push({
        shape: s.shape,
        x0: Math.min(x0, x1),
        x1: Math.max(x0, x1),
        y0: Math.min(y0, y1),
        y1: Math.max(y0, y1),
        z0: Math.min(z0, z1),
        z1: Math.max(z0, z1),
        color: materialColor(s.material, values),
        glass: !!s.glass,
      });
    });
  });

  fam.symbols.forEach((s: FamilySymbol, k) => {
    repeat(s, `Symbole ${k + 1}`, (i, look) => {
      const dx = n(s.dx, look) * i;
      const dy = n(s.dy, look) * i;
      const x0 = n(s.x0, look) + dx;
      const y0 = n(s.y0, look) + dy;
      if (s.shape === 'circle') {
        prims.push({ t: 'circle', cx: x0, cy: y0, r: Math.abs(n(s.x1, look)) });
        return;
      }
      prims.push({ t: s.shape, x0, y0, x1: n(s.x1, look) + dx, y1: n(s.y1, look) + dy });
    });
  });

  if (fam.autoSymbol || prims.length === 0) {
    for (const b of boxes) {
      if (b.shape === 'cylinder') prims.push({ t: 'circle', cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, r: Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2 });
      else prims.push({ t: 'rect', x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
    }
  }

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const ext = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const b of boxes) {
    ext(b.x0, b.y0);
    ext(b.x1, b.y1);
  }
  for (const p of prims) {
    if (p.t === 'circle') {
      ext(p.cx - p.r, p.cy - p.r);
      ext(p.cx + p.r, p.cy + p.r);
    } else {
      ext(p.x0, p.y0);
      ext(p.x1, p.y1);
    }
  }
  const bounds = x0 === Infinity ? { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } : { x0, y0, x1, y1 };
  return { values, boxes, prims, bounds, errors };
}

function materialColor(m: string, values: Record<string, Value>): string {
  if (/^#[0-9a-f]{6}$/i.test(m)) return m;
  const v = values[m];
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : DEFAULT_COLOR;
}

/** Transforme un point local de la famille en coordonnées du plan pour une occurrence. */
export function placer(c: Component): (x: number, y: number) => Vec2 {
  const a = (c.rotation * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return (x, y) => ({ x: c.pos.x + x * cs - y * sn, y: c.pos.y + x * sn + y * cs });
}

/** Vérifie une formule dans le contexte d'une famille (pour l'éditeur). */
export function checkFormula(fam: FamilyDef, src: string, allowIndex = false): string | null {
  try {
    const names = new Set(fam.params.map((p) => p.name));
    for (const r of references(src)) {
      const low = r.toLowerCase();
      if (!names.has(r) && !(allowIndex && r === 'i') && !['vrai', 'faux', 'true', 'false', 'pi'].includes(low)) return `Paramètre inconnu : « ${r} »`;
    }
    return null;
  } catch (e) {
    return e instanceof ExprError ? e.message : String(e);
  }
}

/** Renomme un paramètre dans toutes les formules de la famille. */
export function renameParam(fam: FamilyDef, from: string, to: string): void {
  const bare = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(to) ? to : `[${to}]`;
  const re = new RegExp(`\\[${escapeRe(from)}\\]|(?<![\\p{L}\\p{N}_\\[])${escapeRe(from)}(?![\\p{L}\\p{N}_\\]])`, 'gu');
  const fix = (e: Expr | undefined): Expr | undefined => (typeof e === 'string' ? e.replace(re, bare) : e);
  for (const p of fam.params) {
    if (p.name === from) p.name = to;
    if (p.formula) p.formula = fix(p.formula) as string;
  }
  for (const t of fam.types) {
    if (from in t.values) {
      t.values[to] = t.values[from];
      delete t.values[from];
    }
  }
  for (const s of [...fam.solids, ...fam.symbols]) {
    for (const k of ['x0', 'x1', 'y0', 'y1', 'z0', 'z1', 'visible', 'count', 'dx', 'dy', 'dz'] as const) {
      const obj = s as unknown as Record<string, Expr | undefined>;
      if (k in obj) obj[k] = fix(obj[k]);
    }
    if ('material' in s && s.material === from) s.material = to;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

