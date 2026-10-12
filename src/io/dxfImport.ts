// Lecture de fichiers DXF (ASCII) pour les importer comme fond de plan :
// LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE (approx.), TEXT,
// MTEXT, SOLID et INSERT (blocs, avec échelle et rotation).

export interface DxfData {
  /** Segments [x0, y0, x1, y1] en unités du fichier. */
  lines: number[];
  texts: { x: number; y: number; h: number; angle: number; text: string }[];
  layers: string[];
  /** Unités déclarées ($INSUNITS) : facteur vers le mètre, si connu. */
  unitToMeters: number | null;
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

type Pair = [number, string];

interface RawEntity {
  type: string;
  pairs: Pair[];
}

const INSUNITS: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      i--;
      continue;
    }
    out.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

/** Découpe une section en entités (chaque entité commence par un code 0). */
function entities(pairs: Pair[], start: number, end: number): RawEntity[] {
  const out: RawEntity[] = [];
  let cur: RawEntity | null = null;
  for (let i = start; i < end; i++) {
    const [c, v] = pairs[i];
    if (c === 0) {
      cur = { type: v.trim().toUpperCase(), pairs: [] };
      out.push(cur);
    } else if (cur) {
      cur.pairs.push([c, v]);
    }
  }
  return out;
}

const num = (e: RawEntity, code: number, def = 0): number => {
  const p = e.pairs.find((x) => x[0] === code);
  return p ? parseFloat(p[1]) : def;
};
const str = (e: RawEntity, code: number): string => e.pairs.find((x) => x[0] === code)?.[1] ?? '';

type Xf = (x: number, y: number) => [number, number];

export function parseDXF(text: string): DxfData {
  const pairs = readPairs(text);
  const sections = new Map<string, [number, number]>();
  let unitToMeters: number | null = null;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1].trim();
      let j = i + 2;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1].trim() === 'ENDSEC')) j++;
      sections.set(name, [i + 2, j]);
      i = j;
    }
  }
  const header = sections.get('HEADER');
  if (header) {
    for (let i = header[0]; i < header[1]; i++) {
      if (pairs[i][0] === 9 && pairs[i][1].trim() === '$INSUNITS') {
        const u = parseInt(pairs[i + 1]?.[1] ?? '', 10);
        unitToMeters = INSUNITS[u] ?? null;
      }
    }
  }

  // Blocs : nom → entités.
  const blocks = new Map<string, RawEntity[]>();
  const bsec = sections.get('BLOCKS');
  if (bsec) {
    const list = entities(pairs, bsec[0], bsec[1]);
    let current: { name: string; base: [number, number]; ents: RawEntity[] } | null = null;
    for (const e of list) {
      if (e.type === 'BLOCK') {
        current = { name: str(e, 2), base: [num(e, 10), num(e, 20)], ents: [] };
      } else if (e.type === 'ENDBLK') {
        if (current) {
          // Décalage par le point de base du bloc.
          blocks.set(current.name, current.ents.map((x) => ({ ...x, base: current!.base }) as RawEntity & { base: [number, number] }));
        }
        current = null;
      } else if (current) {
        current.ents.push(e);
      }
    }
  }

  const lines: number[] = [];
  const texts: DxfData['texts'] = [];
  const layers = new Set<string>();
  const seg = (xf: Xf, x0: number, y0: number, x1: number, y1: number) => {
    const [a, b] = xf(x0, y0);
    const [c, d] = xf(x1, y1);
    if (Number.isFinite(a + b + c + d)) lines.push(a, b, c, d);
  };
  const arc = (xf: Xf, cx: number, cy: number, r: number, a0: number, a1: number) => {
    let sweep = a1 - a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(6, Math.ceil(sweep / (Math.PI / 18)));
    let px = cx + r * Math.cos(a0);
    let py = cy + r * Math.sin(a0);
    for (let i = 1; i <= n; i++) {
      const a = a0 + (sweep * i) / n;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      seg(xf, px, py, x, y);
      px = x;
      py = y;
    }
  };

  const draw = (list: RawEntity[], xf: Xf, scale: number, rot: number, depth: number) => {
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      layers.add(str(e, 8) || '0');
      switch (e.type) {
        case 'LINE':
          seg(xf, num(e, 10), num(e, 20), num(e, 11), num(e, 21));
          break;
        case 'LWPOLYLINE': {
          const xs = e.pairs.filter((p) => p[0] === 10).map((p) => parseFloat(p[1]));
          const ys = e.pairs.filter((p) => p[0] === 20).map((p) => parseFloat(p[1]));
          const closed = (num(e, 70) & 1) === 1;
          for (let i = 0; i < xs.length - 1; i++) seg(xf, xs[i], ys[i], xs[i + 1], ys[i + 1]);
          if (closed && xs.length > 2) seg(xf, xs[xs.length - 1], ys[ys.length - 1], xs[0], ys[0]);
          break;
        }
        case 'POLYLINE': {
          const closed = (num(e, 70) & 1) === 1;
          const pts: [number, number][] = [];
          while (list[k + 1] && list[k + 1].type === 'VERTEX') {
            k++;
            pts.push([num(list[k], 10), num(list[k], 20)]);
          }
          if (list[k + 1]?.type === 'SEQEND') k++;
          for (let i = 0; i < pts.length - 1; i++) seg(xf, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (closed && pts.length > 2) seg(xf, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
          break;
        }
        case 'CIRCLE':
          arc(xf, num(e, 10), num(e, 20), num(e, 40), 0, Math.PI * 2);
          break;
        case 'ARC':
          arc(xf, num(e, 10), num(e, 20), num(e, 40), (num(e, 50) * Math.PI) / 180, (num(e, 51) * Math.PI) / 180);
          break;
        case 'ELLIPSE': {
          const cx = num(e, 10);
          const cy = num(e, 20);
          const mx = num(e, 11);
          const my = num(e, 21);
          const ratio = num(e, 40, 1);
          const t0 = num(e, 41, 0);
          let t1 = num(e, 42, Math.PI * 2);
          if (t1 <= t0) t1 += Math.PI * 2;
          const n = 48;
          const ax = { x: mx, y: my };
          const bx = { x: -my * ratio, y: mx * ratio };
          let prev: [number, number] | null = null;
          for (let i = 0; i <= n; i++) {
            const t = t0 + ((t1 - t0) * i) / n;
            const p: [number, number] = [cx + ax.x * Math.cos(t) + bx.x * Math.sin(t), cy + ax.y * Math.cos(t) + bx.y * Math.sin(t)];
            if (prev) seg(xf, prev[0], prev[1], p[0], p[1]);
            prev = p;
          }
          break;
        }
        case 'SOLID':
        case '3DFACE': {
          const q = [
            [num(e, 10), num(e, 20)],
            [num(e, 11), num(e, 21)],
            [num(e, 13, num(e, 12)), num(e, 23, num(e, 22))],
            [num(e, 12), num(e, 22)],
          ];
          for (let i = 0; i < 4; i++) seg(xf, q[i][0], q[i][1], q[(i + 1) % 4][0], q[(i + 1) % 4][1]);
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const [x, y] = xf(num(e, 10), num(e, 20));
          const raw = e.type === 'MTEXT' ? e.pairs.filter((p) => p[0] === 3 || p[0] === 1).map((p) => p[1]).join('') : str(e, 1);
          const t = raw.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
          if (t) texts.push({ x, y, h: num(e, 40, 2.5) * scale, angle: (num(e, 50) * Math.PI) / 180 + rot, text: t });
          break;
        }
        case 'INSERT': {
          if (depth > 8) break;
          const blk = blocks.get(str(e, 2));
          if (!blk) break;
          const ix = num(e, 10);
          const iy = num(e, 20);
          const sx = num(e, 41, 1);
          const sy = num(e, 42, 1);
          const a = (num(e, 50) * Math.PI) / 180;
          const base = (blk[0] as RawEntity & { base?: [number, number] })?.base ?? [0, 0];
          const cs = Math.cos(a);
          const sn = Math.sin(a);
          const local: Xf = (x, y) => {
            const lx = (x - base[0]) * sx;
            const ly = (y - base[1]) * sy;
            return xf(ix + lx * cs - ly * sn, iy + lx * sn + ly * cs);
          };
          draw(blk, local, scale * Math.abs(sx), rot + a, depth + 1);
          break;
        }
        default:
          break;
      }
    }
  };

  const esec = sections.get('ENTITIES');
  if (esec) draw(entities(pairs, esec[0], esec[1]), (x, y) => [x, y], 1, 0, 0);

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < lines.length; i += 2) {
    x0 = Math.min(x0, lines[i]);
    x1 = Math.max(x1, lines[i]);
    y0 = Math.min(y0, lines[i + 1]);
    y1 = Math.max(y1, lines[i + 1]);
  }
  return { lines, texts, layers: [...layers], unitToMeters, bounds: x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0, y0, x1, y1 } };
}
