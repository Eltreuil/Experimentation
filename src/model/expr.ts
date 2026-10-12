// Moteur de formules des familles paramétriques (équivalent des formules Revit).
// Analyse sûre (pas d'eval) : nombres avec unités, + - * / ^ %, comparaisons,
// et / ou / non, if(c; a; b), fonctions mathématiques et noms de paramètres.
//
// Les longueurs sont en mètres : « 60 cm », « 600mm » et « 0.6 » sont équivalents.
// Les noms de paramètres peuvent contenir des espaces en les entourant de
// crochets : [Hauteur assise]. Les identifiants simples (Largeur, nb_pieds) n'en
// ont pas besoin. Le séparateur d'arguments est « , » ou « ; ».

export type Value = number | boolean | string;

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'var'; name: string }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

export class ExprError extends Error {}

const UNITS: Record<string, number> = { mm: 0.001, cm: 0.01, dm: 0.1, m: 1, km: 1000, '°': Math.PI / 180, deg: Math.PI / 180 };

interface Tok {
  k: 'num' | 'id' | 'str' | 'op';
  v: string;
  n?: number;
}

const ID_START = /[\p{L}_]/u;
const ID_PART = /[\p{L}\p{N}_]/u;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      // Notation décimale française : 0,5 si suivi d'un chiffre et précédé d'un chiffre.
      if (src[j] === ',' && /[0-9]/.test(src[j + 1] ?? '') && /^\d+$/.test(src.slice(i, j)) && !inCall(out)) {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      if (/[eE]/.test(src[j] ?? '') && /[-+0-9]/.test(src[j + 1] ?? '')) {
        j += 2;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const text = src.slice(i, j).replace(',', '.');
      const n = Number(text);
      if (!Number.isFinite(n)) throw new ExprError(`Nombre invalide : ${text}`);
      // Unité collée ou séparée par un espace : 60cm, 60 cm, 45°.
      let k = j;
      while (src[k] === ' ') k++;
      const unit = /^(mm|cm|dm|km|m|°|deg)(?![\p{L}\p{N}_])/u.exec(src.slice(k));
      if (unit) {
        out.push({ k: 'num', v: text, n: n * UNITS[unit[1]] });
        i = k + unit[1].length;
      } else {
        out.push({ k: 'num', v: text, n });
        i = j;
      }
      continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new ExprError('Crochet « ] » manquant');
      out.push({ k: 'id', v: src.slice(i + 1, j).trim() });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new ExprError('Guillemet manquant');
      out.push({ k: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '==', '&&', '||'].includes(two)) {
      out.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^%()<>=,;!'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    throw new ExprError(`Caractère inattendu : « ${c} »`);
  }
  return out;
}

/** Vrai si on est à l'intérieur d'un appel de fonction (la virgule y sépare les arguments). */
function inCall(toks: Tok[]): boolean {
  let depth = 0;
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.k === 'op' && t.v === ')') depth++;
    if (t.k === 'op' && t.v === '(') {
      if (depth === 0) return i > 0 && toks[i - 1].k === 'id';
      depth--;
    }
  }
  return false;
}

const KEYWORD_OPS: Record<string, string> = { et: '&&', and: '&&', ou: '||', or: '||' };

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  parse(): Node {
    if (!this.toks.length) throw new ExprError('Formule vide');
    const n = this.or();
    if (this.i < this.toks.length) throw new ExprError(`Élément inattendu : « ${this.toks[this.i].v} »`);
    return n;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.k === 'op') return t.v === v;
    return t.k === 'id' && KEYWORD_OPS[t.v.toLowerCase()] === v;
  }

  private eat(v: string): void {
    if (!this.isOp(v)) throw new ExprError(`« ${v} » attendu`);
    this.i++;
  }

  private or(): Node {
    let a = this.and();
    while (this.isOp('||')) {
      this.i++;
      a = { t: 'bin', op: '||', a, b: this.and() };
    }
    return a;
  }

  private and(): Node {
    let a = this.cmp();
    while (this.isOp('&&')) {
      this.i++;
      a = { t: 'bin', op: '&&', a, b: this.cmp() };
    }
    return a;
  }

  private cmp(): Node {
    let a = this.add();
    for (;;) {
      const t = this.peek();
      if (t?.k === 'op' && ['<', '>', '<=', '>=', '=', '==', '<>', '!='].includes(t.v)) {
        this.i++;
        const op = t.v === '==' ? '=' : t.v === '!=' ? '<>' : t.v;
        a = { t: 'bin', op, a, b: this.add() };
      } else return a;
    }
  }

  private add(): Node {
    let a = this.mul();
    for (;;) {
      const t = this.peek();
      if (t?.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.i++;
        a = { t: 'bin', op: t.v, a, b: this.mul() };
      } else return a;
    }
  }

  private mul(): Node {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.k === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.i++;
        a = { t: 'bin', op: t.v, a, b: this.unary() };
      } else return a;
    }
  }

  private unary(): Node {
    const t = this.peek();
    if (t?.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) {
      this.i++;
      return { t: 'un', op: t.v, a: this.unary() };
    }
    if (t?.k === 'id' && ['non', 'not'].includes(t.v.toLowerCase()) && this.toks[this.i + 1]?.v === '(') {
      this.i++;
      return { t: 'un', op: '!', a: this.unary() };
    }
    return this.pow();
  }

  private pow(): Node {
    const a = this.primary();
    if (this.isOp('^')) {
      this.i++;
      return { t: 'bin', op: '^', a, b: this.unary() };
    }
    return a;
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) throw new ExprError('Formule incomplète');
    this.i++;
    if (t.k === 'num') return { t: 'num', v: t.n! };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'op' && t.v === '(') {
      const n = this.or();
      this.eat(')');
      return n;
    }
    if (t.k === 'id') {
      if (this.isOp('(')) {
        this.i++;
        const args: Node[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.or());
            if (this.isOp(',') || this.isOp(';')) {
              this.i++;
              continue;
            }
            break;
          }
        }
        this.eat(')');
        return { t: 'call', name: t.v.toLowerCase(), args };
      }
      return { t: 'var', name: t.v };
    }
    throw new ExprError(`Élément inattendu : « ${t.v} »`);
  }
}

const cache = new Map<string, Node>();

export function parse(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    n = new Parser(tokenize(src)).parse();
    if (cache.size > 5000) cache.clear();
    cache.set(src, n);
  }
  return n;
}

const num = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);
const bool = (v: Value): boolean => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : v !== '' && v !== '0');

const FUNCS: Record<string, (args: Value[]) => Value> = {
  min: (a) => Math.min(...a.map(num)),
  max: (a) => Math.max(...a.map(num)),
  abs: (a) => Math.abs(num(a[0])),
  sqrt: (a) => Math.sqrt(num(a[0])),
  rac: (a) => Math.sqrt(num(a[0])),
  // Angles en radians (les littéraux « 30° » sont convertis).
  sin: (a) => Math.sin(num(a[0])),
  cos: (a) => Math.cos(num(a[0])),
  tan: (a) => Math.tan(num(a[0])),
  asin: (a) => Math.asin(num(a[0])),
  acos: (a) => Math.acos(num(a[0])),
  atan: (a) => Math.atan(num(a[0])),
  pi: () => Math.PI,
  exp: (a) => Math.exp(num(a[0])),
  ln: (a) => Math.log(num(a[0])),
  log: (a) => Math.log10(num(a[0])),
  // Arrondis : round(x) ou round(x, pas) — rounddown/roundup comme dans Revit.
  round: (a) => (a.length > 1 ? Math.round(num(a[0]) / num(a[1])) * num(a[1]) : Math.round(num(a[0]))),
  arrondi: (a) => FUNCS.round(a),
  rounddown: (a) => (a.length > 1 ? Math.floor(num(a[0]) / num(a[1]) + 1e-9) * num(a[1]) : Math.floor(num(a[0]) + 1e-9)),
  roundup: (a) => (a.length > 1 ? Math.ceil(num(a[0]) / num(a[1]) - 1e-9) * num(a[1]) : Math.ceil(num(a[0]) - 1e-9)),
  floor: (a) => Math.floor(num(a[0]) + 1e-9),
  ceil: (a) => Math.ceil(num(a[0]) - 1e-9),
  clamp: (a) => Math.min(num(a[2]), Math.max(num(a[1]), num(a[0]))),
};

export type Lookup = (name: string) => Value | undefined;

export function evaluate(node: Node, lookup: Lookup): Value {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'var': {
      const v = lookup(node.name);
      if (v === undefined) {
        const low = node.name.toLowerCase();
        if (low === 'vrai' || low === 'true') return true;
        if (low === 'faux' || low === 'false') return false;
        if (low === 'pi') return Math.PI;
        throw new ExprError(`Paramètre inconnu : « ${node.name} »`);
      }
      return v;
    }
    case 'un': {
      const a = evaluate(node.a, lookup);
      if (node.op === '!') return !bool(a);
      return node.op === '-' ? -num(a) : num(a);
    }
    case 'bin': {
      if (node.op === '&&') return bool(evaluate(node.a, lookup)) && bool(evaluate(node.b, lookup));
      if (node.op === '||') return bool(evaluate(node.a, lookup)) || bool(evaluate(node.b, lookup));
      const a = evaluate(node.a, lookup);
      const b = evaluate(node.b, lookup);
      switch (node.op) {
        case '+':
          return typeof a === 'string' || typeof b === 'string' ? `${a}${b}` : num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/': {
          const d = num(b);
          if (d === 0) throw new ExprError('Division par zéro');
          return num(a) / d;
        }
        case '%':
          return num(a) % num(b);
        case '^':
          return Math.pow(num(a), num(b));
        case '<':
          return num(a) < num(b) - 1e-9;
        case '>':
          return num(a) > num(b) + 1e-9;
        case '<=':
          return num(a) <= num(b) + 1e-9;
        case '>=':
          return num(a) >= num(b) - 1e-9;
        case '=':
          return typeof a === 'string' || typeof b === 'string' ? String(a) === String(b) : Math.abs(num(a) - num(b)) < 1e-9;
        case '<>':
          return typeof a === 'string' || typeof b === 'string' ? String(a) !== String(b) : Math.abs(num(a) - num(b)) >= 1e-9;
      }
      throw new ExprError(`Opérateur inconnu ${node.op}`);
    }
    case 'call': {
      if (node.name === 'if' || node.name === 'si') {
        if (node.args.length !== 3) throw new ExprError('if(condition ; valeur si vrai ; valeur si faux)');
        return bool(evaluate(node.args[0], lookup)) ? evaluate(node.args[1], lookup) : evaluate(node.args[2], lookup);
      }
      if (node.name === 'and' || node.name === 'et') return node.args.every((n) => bool(evaluate(n, lookup)));
      if (node.name === 'or' || node.name === 'ou') return node.args.some((n) => bool(evaluate(n, lookup)));
      if (node.name === 'not' || node.name === 'non') return !bool(evaluate(node.args[0], lookup));
      const f = FUNCS[node.name];
      if (!f) throw new ExprError(`Fonction inconnue : ${node.name}()`);
      const r = f(node.args.map((n) => evaluate(n, lookup)));
      if (typeof r === 'number' && !Number.isFinite(r)) throw new ExprError(`Résultat invalide pour ${node.name}()`);
      return r;
    }
  }
}

/** Noms de paramètres référencés par une formule (pour l'ordre d'évaluation). */
export function references(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.t === 'var') out.add(n.name);
    else if (n.t === 'un') walk(n.a);
    else if (n.t === 'bin') {
      walk(n.a);
      walk(n.b);
    } else if (n.t === 'call') n.args.forEach(walk);
  };
  walk(parse(src));
  return [...out];
}

/** Évalue une formule ; en cas d'erreur, retourne `fallback` et le message. */
export function evalExpr(src: string | number | boolean, lookup: Lookup): Value {
  if (typeof src !== 'string') return src;
  return evaluate(parse(src), lookup);
}

export function tryEval(src: string, lookup: Lookup): { value: Value | null; error: string | null } {
  try {
    return { value: evalExpr(src, lookup), error: null };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
}

export const toNumber = num;
export const toBool = bool;
