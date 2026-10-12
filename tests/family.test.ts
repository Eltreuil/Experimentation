import { describe, expect, it } from 'vitest';
import { sampleProject } from '../src/model/defaults';
import { evaluateFamily, renameParam, resolveParams } from '../src/model/family';
import { blankFamily, defaultFamilies } from '../src/model/familyLibrary';
import { elementMeshes, meshVolume } from '../src/model/mesh';
import { Project, normalize } from '../src/model/project';
import type { FamilyDef } from '../src/model/types';

const lib = () => defaultFamilies();
const fam = (id: string): FamilyDef => lib().find((f) => f.id === id)!;

describe('familles paramétriques', () => {
  it('toutes les familles de la bibliothèque s’évaluent sans erreur', () => {
    for (const f of lib()) {
      for (const t of f.types) {
        const r = evaluateFamily(f, t.id);
        expect(r.errors, `${f.name} / ${t.name}`).toEqual([]);
        expect(r.boxes.length, f.name).toBeGreaterThan(0);
        expect(r.prims.length, f.name).toBeGreaterThan(0);
      }
    }
  });

  it('calcule les paramètres pilotés par formule selon le type', () => {
    const table = fam('param-table');
    expect(resolveParams(table, table.types[0])['Chaises par côté']).toBe(3);
    expect(resolveParams(table, table.types[1])['Chaises par côté']).toBe(4);
    expect(resolveParams(table, table.types[2])['Chaises par côté']).toBe(2);
    // 1 plateau + 4 pieds + 2 × 4 chaises pour la table de 2,40 m
    expect(evaluateFamily(table, 't2').boxes).toHaveLength(13);
  });

  it('applique les paramètres d’occurrence et la visibilité conditionnelle', () => {
    const table = fam('param-table');
    expect(evaluateFamily(table, 't1', { 'Avec chaises': false }).boxes).toHaveLength(5);
    const shelf = fam('param-shelf');
    expect(evaluateFamily(shelf, 't1', { 'Nombre de tablettes': 7 }).boxes).toHaveLength(9);
    const top = evaluateFamily(shelf, 't1', { 'Nombre de tablettes': 3 }).boxes.filter((b) => b.x1 - b.x0 < 1).map((b) => b.z1);
    expect(Math.max(...top)).toBeCloseTo(2.0);
  });

  it('signale les erreurs de formule et les références circulaires', () => {
    const f = blankFamily('x');
    f.params.push({ name: 'A', kind: 'number', scope: 'type', value: 1, formula: 'B + 1' });
    f.params.push({ name: 'B', kind: 'number', scope: 'type', value: 1, formula: 'A + 1' });
    f.solids[0].x1 = 'Inconnu';
    const r = evaluateFamily(f);
    expect(r.errors.some((e) => /circulaire/.test(e))).toBe(true);
    expect(r.errors.some((e) => /Inconnu/.test(e))).toBe(true);
  });

  it('renomme un paramètre dans toutes les formules', () => {
    const f = fam('param-table');
    renameParam(f, 'Section pied', 'Pied');
    expect(f.solids.find((s) => s.id === 'pieds')!.x1).toContain('Pied');
    expect(JSON.stringify(f)).not.toContain('Section pied');
    expect(evaluateFamily(f).errors).toEqual([]);
    renameParam(f, 'Longueur', 'Long totale');
    expect(f.params.find((p) => p.name === 'Chaises par côté')!.formula).toContain('[Long totale]');
    expect(evaluateFamily(f).errors).toEqual([]);
  });

  it('met à jour toutes les occurrences quand le type change', () => {
    const p = new Project(sampleProject());
    const table = p.ofKind('component').find((c) => c.family === 'param-table')!;
    const before = p.componentGeometry(table).bounds;
    p.transact('type', (d) => (d.families!.find((f) => f.id === 'param-table')!.types[0].values.Longueur = 3));
    const after = p.componentGeometry(table).bounds;
    expect(after.x1 - after.x0).toBeGreaterThan(before.x1 - before.x0 + 1);
    const vol = elementMeshes(p, table)!.solids.reduce((s, x) => s + meshVolume(x.positions), 0);
    expect(vol).toBeGreaterThan(0);
  });

  it('migre les anciens composants à dimensions fixes', () => {
    const d = sampleProject();
    const legacy = { id: 'old', kind: 'component', levelId: 'lvl-0', family: 'sofa', pos: { x: 0, y: 0 }, rotation: 0, width: 2, depth: 1, height: 1 };
    (d.elements as Record<string, unknown>).old = legacy;
    delete d.families;
    const n = normalize(d);
    expect(n.families!.length).toBeGreaterThan(10);
    expect('width' in n.elements.old).toBe(false);
  });
});
