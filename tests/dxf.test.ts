import { describe, expect, it } from 'vitest';
import { parseDXF } from '../src/io/dxfImport';

const dxf = (body: string, header = '') =>
  ['0', 'SECTION', '2', 'HEADER', header, '0', 'ENDSEC', body, '0', 'EOF'].filter(Boolean).join('\n');

const BLOCKS = [
  '0', 'SECTION', '2', 'BLOCKS',
  '0', 'BLOCK', '2', 'CARRE', '10', '0', '20', '0',
  '0', 'LINE', '8', 'B', '10', '0', '20', '0', '11', '100', '21', '0',
  '0', 'ENDBLK',
  '0', 'ENDSEC',
].join('\n');

const ENTITIES = [
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', 'MURS', '10', '0', '20', '0', '11', '5000', '21', '0',
  '0', 'LWPOLYLINE', '8', 'MURS', '90', '4', '70', '1', '10', '0', '20', '0', '10', '1000', '20', '0', '10', '1000', '20', '1000', '10', '0', '20', '1000',
  '0', 'CIRCLE', '8', 'POTEAUX', '10', '2000', '20', '2000', '40', '150',
  '0', 'TEXT', '8', 'TEXTES', '10', '100', '20', '200', '40', '250', '1', 'Séjour',
  '0', 'INSERT', '8', 'B', '2', 'CARRE', '10', '3000', '20', '0', '41', '2', '42', '2', '50', '90',
  '0', 'ENDSEC',
].join('\n');

describe('import DXF', () => {
  it('lit lignes, polylignes, cercles, textes et blocs', () => {
    const d = parseDXF(dxf(BLOCKS + '\n' + ENTITIES, ['9', '$INSUNITS', '70', '4'].join('\n')));
    expect(d.unitToMeters).toBe(0.001);
    const segs = d.lines.length / 4;
    // 1 ligne + 4 côtés + cercle (≥ 36 segments) + 1 ligne de bloc
    expect(segs).toBeGreaterThanOrEqual(1 + 4 + 36 + 1);
    expect(d.texts).toEqual([expect.objectContaining({ text: 'Séjour', h: 250 })]);
    expect(d.layers).toEqual(expect.arrayContaining(['MURS', 'POTEAUX', 'TEXTES', 'B']));
    // Bloc inséré en (3000, 0), échelle 2, rotation 90° : la ligne de 100 devient verticale de 200.
    const L = d.lines;
    const last = L.slice(L.length - 4);
    expect(last[0]).toBeCloseTo(3000);
    expect(last[2]).toBeCloseTo(3000);
    expect(last[3]).toBeCloseTo(200);
    expect(d.bounds.x1).toBeCloseTo(5000);
  });

  it('tolère un fichier sans en-tête ni unités', () => {
    const d = parseDXF(['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '1', '20', '2', '11', '3', '21', '4', '0', 'ENDSEC', '0', 'EOF'].join('\r\n'));
    expect(d.unitToMeters).toBeNull();
    expect(d.lines).toEqual([1, 2, 3, 4]);
  });
});
