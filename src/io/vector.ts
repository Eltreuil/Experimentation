// Export vectoriel des plans : un faux contexte Canvas 2D enregistre le dessin
// de la vue, puis le convertit en SVG, en DXF (AutoCAD R12) ou en feuille A3.
import type { Vec2 } from '../model/types';

type Matrix = [number, number, number, number, number, number];

export interface VPath {
  type: 'path';
  layer: string;
  subpaths: { pts: Vec2[]; closed: boolean }[];
  stroke?: string;
  fill?: string;
  width: number;
  dash: number[];
}

export interface VText {
  type: 'text';
  layer: string;
  x: number;
  y: number;
  angle: number;
  text: string;
  size: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  color: string;
  bold: boolean;
}

export type VShape = VPath | VText;

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Contexte Canvas 2D minimal qui enregistre les primitives au lieu de les peindre. */
export class RecordingContext {
  shapes: VShape[] = [];
  fillStyle: string = '#000';
  strokeStyle: string = '#000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  font = '12px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  private m: Matrix = [1, 0, 0, 1, 0, 0];
  private dash: number[] = [];
  private stack: { m: Matrix; fillStyle: string; strokeStyle: string; lineWidth: number; dash: number[]; font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline }[] = [];
  private current: { pts: Vec2[]; closed: boolean }[] = [];
  private measure: CanvasRenderingContext2D | null;

  constructor(private layerOf: () => string) {
    // Mesure de texte réelle si un canevas est disponible (navigateur).
    this.measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }

  private tx(x: number, y: number): Vec2 {
    const m = this.m;
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  }

  save(): void {
    this.stack.push({ m: [...this.m] as Matrix, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, dash: this.dash, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    Object.assign(this, { fillStyle: s.fillStyle, strokeStyle: s.strokeStyle, lineWidth: s.lineWidth, font: s.font, textAlign: s.textAlign, textBaseline: s.textBaseline });
    this.m = s.m;
    this.dash = s.dash;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, b, c, d, e, f];
  }

  translate(x: number, y: number): void {
    this.m = mul(this.m, [1, 0, 0, 1, x, y]);
  }

  rotate(a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.m = mul(this.m, [c, s, -s, c, 0, 0]);
  }

  setLineDash(d: number[]): void {
    this.dash = [...d];
  }

  beginPath(): void {
    this.current = [];
  }

  moveTo(x: number, y: number): void {
    this.current.push({ pts: [this.tx(x, y)], closed: false });
  }

  lineTo(x: number, y: number): void {
    if (!this.current.length) this.moveTo(x, y);
    else this.current[this.current.length - 1].pts.push(this.tx(x, y));
  }

  closePath(): void {
    const sp = this.current[this.current.length - 1];
    if (sp) sp.closed = true;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.current.push({ pts: [this.tx(x, y), this.tx(x + w, y), this.tx(x + w, y + h), this.tx(x, y + h)], closed: true });
  }

  arc(cx: number, cy: number, r: number, a0: number, a1: number): void {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 24)));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(this.tx(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
    this.current.push({ pts: full ? pts.slice(0, -1) : pts, closed: full });
  }

  clip(): void {
    // Non géré : les hachures sont désactivées pendant l'export.
  }

  private scaleFactor(): number {
    return Math.hypot(this.m[0], this.m[1]);
  }

  private push(stroke?: string, fill?: string): void {
    if (!this.current.length) return;
    this.shapes.push({
      type: 'path',
      layer: this.layerOf(),
      subpaths: this.current.map((sp) => ({ pts: [...sp.pts], closed: sp.closed })),
      stroke,
      fill,
      width: this.lineWidth * this.scaleFactor(),
      dash: this.dash.map((d) => d * this.scaleFactor()),
    });
  }

  stroke(): void {
    this.push(this.strokeStyle, undefined);
  }

  fill(): void {
    this.push(undefined, this.fillStyle);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = this.current;
    this.current = [];
    this.rect(x, y, w, h);
    this.push(undefined, this.fillStyle);
    this.current = saved;
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const saved = this.current;
    this.current = [];
    this.rect(x, y, w, h);
    this.push(this.strokeStyle, undefined);
    this.current = saved;
  }

  private fontSize(): number {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
    return m ? parseFloat(m[1]) : 12;
  }

  measureText(t: string): TextMetrics {
    if (this.measure) {
      this.measure.font = this.font;
      return this.measure.measureText(t);
    }
    return { width: t.length * this.fontSize() * 0.55 } as TextMetrics;
  }

  fillText(text: string, x: number, y: number): void {
    const p = this.tx(x, y);
    this.shapes.push({
      type: 'text',
      layer: this.layerOf(),
      x: p.x,
      y: p.y,
      angle: Math.atan2(this.m[1], this.m[0]),
      text,
      size: this.fontSize() * this.scaleFactor(),
      align: this.textAlign,
      baseline: this.textBaseline,
      color: this.fillStyle,
      bold: /\b(600|700|bold)\b/.test(this.font),
    });
  }
}

// ---------------------------------------------------------------------------
// SVG

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Contenu SVG (sans balise racine) des formes enregistrées. Unités : celles de l'enregistrement. */
export function shapesToSVG(shapes: VShape[], lineScale = 1): string {
  const out: string[] = [];
  let layer = '';
  for (const s of shapes) {
    if (s.layer !== layer) {
      if (layer) out.push('</g>');
      layer = s.layer;
      out.push(`<g id="${esc(layer)}" data-layer="${esc(layer)}">`);
    }
    if (s.type === 'path') {
      const d = s.subpaths.map((sp) => `M${sp.pts.map((q) => `${f(q.x)} ${f(q.y)}`).join(' L')}${sp.closed ? ' Z' : ''}`).join(' ');
      const attrs = [
        `d="${d}"`,
        `fill="${s.fill ? esc(s.fill) : 'none'}"`,
        s.stroke ? `stroke="${esc(s.stroke)}" stroke-width="${f(s.width * lineScale)}" stroke-linejoin="round" stroke-linecap="round"` : '',
        s.stroke && s.dash.length ? `stroke-dasharray="${s.dash.map((x) => f(x * lineScale * 2)).join(' ')}"` : '',
      ];
      out.push(`<path ${attrs.filter(Boolean).join(' ')}/>`);
    } else {
      const anchor = s.align === 'center' ? 'middle' : s.align === 'right' || s.align === 'end' ? 'end' : 'start';
      const baseline = s.baseline === 'middle' ? 'central' : s.baseline === 'top' ? 'hanging' : s.baseline === 'bottom' ? 'text-after-edge' : 'alphabetic';
      const rot = s.angle ? ` transform="rotate(${f((s.angle * 180) / Math.PI)} ${f(s.x)} ${f(s.y)})"` : '';
      out.push(
        `<text x="${f(s.x)}" y="${f(s.y)}" font-size="${f(s.size)}" font-family="Arial, Helvetica, sans-serif"${s.bold ? ' font-weight="bold"' : ''} fill="${esc(s.color)}" text-anchor="${anchor}" dominant-baseline="${baseline}"${rot}>${esc(s.text)}</text>`,
      );
    }
  }
  if (layer) out.push('</g>');
  return out.join('\n');
}

export function bboxOf(shapes: VShape[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const s of shapes) {
    if (s.type === 'path') for (const sp of s.subpaths) for (const q of sp.pts) add(q.x, q.y);
    else add(s.x, s.y);
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
// DXF (AutoCAD R12, ASCII)

function isDark(color: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.45;
}

const LAYER_COLORS: Record<string, number> = {
  MURS: 7,
  PORTES: 3,
  FENETRES: 4,
  OUVERTURES: 4,
  POTEAUX: 7,
  COTES: 1,
  TEXTES: 2,
  ETIQUETTES: 2,
  QUADRILLAGES: 5,
  COUPES: 6,
  MOBILIER: 8,
  ESCALIERS: 30,
  'GARDE-CORPS': 30,
  SOLS: 9,
  PIECES: 9,
  TOITS: 32,
  TREMIES: 7,
  PLAFONDS: 9,
  'SOUS-COUCHE': 9,
};

/**
 * Convertit les formes en DXF. `toWorld` ramène les coordonnées enregistrées
 * en coordonnées réelles (mm) ; `scale` convertit les tailles de texte.
 */
export function shapesToDXF(shapes: VShape[], toWorld: (q: Vec2) => Vec2, textScale: number): string {
  const lines: string[] = [];
  const g = (code: number, value: string | number) => lines.push(String(code), typeof value === 'number' ? (Math.round(value * 1000) / 1000).toString() : value);
  const layers = [...new Set(shapes.map((s) => s.layer.replace(/[^A-Z0-9_-]/gi, '_') || '0'))];

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4);
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const l of layers) {
    g(0, 'LAYER');
    g(2, l);
    g(70, 0);
    g(62, LAYER_COLORS[l] ?? 7);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const s of shapes) {
    const layer = s.layer.replace(/[^A-Z0-9_-]/gi, '_') || '0';
    if (s.type === 'path') {
      // Surfaces seulement remplies : on n'exporte que le contour des remplissages sombres (poteaux, flèches).
      if (!s.stroke && !(s.fill && isDark(s.fill))) continue;
      for (const sp of s.subpaths) {
        const pts = sp.pts.map(toWorld);
        const n = sp.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) continue;
          g(0, 'LINE');
          g(8, layer);
          g(10, a.x);
          g(20, a.y);
          g(30, 0);
          g(11, b.x);
          g(21, b.y);
          g(31, 0);
        }
      }
    } else {
      const p = toWorld({ x: s.x, y: s.y });
      const h = s.size * textScale * 0.75;
      const halign = s.align === 'center' ? 1 : s.align === 'right' || s.align === 'end' ? 2 : 0;
      const valign = s.baseline === 'middle' ? 2 : s.baseline === 'top' ? 3 : s.baseline === 'bottom' ? 1 : 0;
      g(0, 'TEXT');
      g(8, layer);
      g(10, p.x);
      g(20, p.y);
      g(30, 0);
      g(40, h);
      g(1, s.text);
      g(50, (-s.angle * 180) / Math.PI);
      if (halign || valign) {
        g(72, halign);
        g(73, valign);
        g(11, p.x);
        g(21, p.y);
        g(31, 0);
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Feuille A3 avec cartouche

export interface SheetInfo {
  project: string;
  view: string;
  scale: number;
  date: string;
  client?: string;
  address?: string;
  author?: string;
  number?: string;
  phase?: string;
  sheet?: string;
}

/** Feuille A3 paysage (420 × 297 mm) : cadre, cartouche et dessin à l'échelle. */
export function sheetSVG(shapes: VShape[], info: SheetInfo): string {
  const W = 420;
  const H = 297;
  const m = 10;
  const tbW = 120;
  const tbH = 62;
  const area = { x: m + 5, y: m + 5, w: W - 2 * m - 10, h: H - 2 * m - tbH - 15 };
  const b = bboxOf(shapes);
  const dx = area.x + (area.w - (b.x1 - b.x0)) / 2 - b.x0;
  const dy = area.y + (area.h - (b.y1 - b.y0)) / 2 - b.y0;
  const tbX = W - m - tbW;
  const tbY = H - m - tbH;
  const row = (y: number, label: string, value: string, big = false) =>
    `<text x="${tbX + 3}" y="${y}" font-size="2.2" fill="#666">${esc(label)}</text><text x="${tbX + 3}" y="${y + (big ? 6 : 4.2)}" font-size="${big ? 5 : 3.2}" font-weight="${big ? 'bold' : 'normal'}" fill="#111">${esc(value)}</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
<rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="#111" stroke-width="0.5"/>
<g transform="translate(${f(dx)} ${f(dy)})">
${shapesToSVG(shapes, 0.18)}
</g>
<g>
<rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" fill="#fff" stroke="#111" stroke-width="0.35"/>
<line x1="${tbX}" y1="${tbY + 14}" x2="${tbX + tbW}" y2="${tbY + 14}" stroke="#111" stroke-width="0.25"/>
<line x1="${tbX}" y1="${tbY + 30}" x2="${tbX + tbW}" y2="${tbY + 30}" stroke="#111" stroke-width="0.25"/>
<line x1="${tbX}" y1="${tbY + 44}" x2="${tbX + tbW}" y2="${tbY + 44}" stroke="#111" stroke-width="0.25"/>
<line x1="${tbX + 60}" y1="${tbY + 30}" x2="${tbX + 60}" y2="${tbY + tbH}" stroke="#111" stroke-width="0.25"/>
${row(tbY + 4, 'Projet', info.project, true)}
${row(tbY + 18, 'Maître d’ouvrage / adresse', [info.client, info.address].filter(Boolean).join(' — ') || '—')}
<text x="${tbX + 3}" y="${tbY + 26.5}" font-size="2.2" fill="#666">${esc(info.author ? `Auteur : ${info.author}` : 'OpenBIM Studio')}</text>
${row(tbY + 34, 'Vue', info.view)}
<g transform="translate(60 0)">${row(tbY + 34, 'Échelle', `1/${info.scale}`)}</g>
${row(tbY + 48, 'Date', info.date)}
<g transform="translate(60 0)">${row(tbY + 48, 'Phase · N° · Feuille', [info.phase || 'ESQ', info.number || '—', info.sheet || 'A101'].join(' · '))}</g>
<g transform="translate(${m + 8} ${H - m - 12})">
<path d="M0 0 L3 -10 L6 0 L3 -3 Z" fill="#111"/><text x="3" y="5" font-size="3.5" text-anchor="middle" font-weight="bold">N</text>
<g transform="translate(14 -2)">${scaleBar(info.scale)}</g>
</g>
</g>
</svg>`;
}

function scaleBar(scale: number): string {
  // Barre graphique de 5 m.
  const meters = 5;
  const len = (meters * 1000) / scale;
  const parts: string[] = [];
  for (let i = 0; i < meters; i++) {
    const x = (len / meters) * i;
    parts.push(`<rect x="${f(x)}" y="-1.5" width="${f(len / meters)}" height="1.5" fill="${i % 2 ? '#fff' : '#111'}" stroke="#111" stroke-width="0.2"/>`);
  }
  parts.push(`<text x="0" y="3.5" font-size="2.5">0</text><text x="${f(len)}" y="3.5" font-size="2.5" text-anchor="end">${meters} m</text>`);
  return parts.join('');
}

/** Imprime un SVG via un cadre caché (enregistrement PDF possible depuis la boîte d'impression). */
export function printSVG(svg: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Impression</title><style>@page{size:A3 landscape;margin:0}html,body{margin:0}svg{width:420mm;height:297mm;display:block}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 300);
}
