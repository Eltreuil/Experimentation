import { describe, expect, it } from 'vitest';
import { evalExpr, references, tryEval } from '../src/model/expr';

const vars: Record<string, number | boolean | string> = { Largeur: 1.8, Longueur: 2.4, 'Hauteur assise': 0.45, Avec_dossier: true, Matériau: 'chêne' };
const ev = (s: string) => evalExpr(s, (n) => vars[n]);

describe('formules', () => {
  it('calcule l’arithmétique et la priorité des opérateurs', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('2 ^ 3 ^ 2')).toBe(512);
    expect(ev('-2 ^ 2')).toBe(-4);
    expect(ev('10 % 4')).toBe(2);
  });

  it('gère les unités et la virgule décimale', () => {
    expect(ev('60 cm')).toBeCloseTo(0.6);
    expect(ev('600mm + 0,4')).toBeCloseTo(1.0);
    expect(ev('90°')).toBeCloseTo(Math.PI / 2);
    expect(ev('sin(30°)')).toBeCloseTo(0.5);
  });

  it('lit les paramètres, y compris avec espaces et accents', () => {
    expect(ev('Largeur / 2')).toBeCloseTo(0.9);
    expect(ev('[Hauteur assise] * 2')).toBeCloseTo(0.9);
    expect(ev('Matériau = "chêne"')).toBe(true);
  });

  it('évalue conditions et fonctions', () => {
    expect(ev('if(Largeur > 1.5; 6; 4)')).toBe(6);
    expect(ev('si(Avec_dossier et Largeur < 1; 1; 0)')).toBe(0);
    expect(ev('rounddown(Longueur / 0.6)')).toBe(4);
    expect(ev('roundup(2.01)')).toBe(3);
    expect(ev('round(1.234; 0.05)')).toBeCloseTo(1.25);
    expect(ev('max(1; Largeur; 0.5)')).toBe(1.8);
    expect(ev('not(Avec_dossier)')).toBe(false);
    expect(ev('vrai ou faux')).toBe(true);
  });

  it('signale les erreurs sans planter', () => {
    expect(tryEval('Inconnu + 1', () => undefined).error).toMatch(/inconnu/i);
    expect(tryEval('1 / 0', () => undefined).error).toMatch(/zéro/);
    expect(tryEval('(1 + 2', () => undefined).error).toBeTruthy();
    expect(tryEval('1 $ 2', () => undefined).error).toBeTruthy();
  });

  it('liste les paramètres référencés', () => {
    expect(references('if([Hauteur assise] > 0; Largeur; Longueur * 2)').sort()).toEqual(['Hauteur assise', 'Largeur', 'Longueur']);
  });
});
