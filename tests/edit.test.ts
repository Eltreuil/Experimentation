import { describe, expect, it } from 'vitest';
import { emptyProject, sampleProject } from '../src/model/defaults';
import {
  alignTo,
  arrayElements,
  attachWallsToRoof,
  duplicate,
  extendToLine,
  mirrorElements,
  moveElements,
  offsetWall,
  reflectPoint,
  refLinesNear,
  rotateElements,
  splitWall,
  trimToCorner,
  wallChainPoints,
} from '../src/model/edit';
import { wallLength } from '../src/model/geometry';
import { elementMeshes, floorHoles, meshVolume } from '../src/model/mesh';
import { Project, newId } from '../src/model/project';
import type { Wall } from '../src/model/types';

const wall = (p: Project, a: [number, number], b: [number, number], typeId = 'wt-ext'): Wall =>
  p.add({ id: newId('w'), kind: 'wall', levelId: 'lvl-0', typeId, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, height: 3, baseOffset: 0 });

const fresh = () => new Project(emptyProject());

describe('modifier', () => {
  it('déplace un mur et étire les murs raccordés', () => {
    const p = fresh();
    let w1!: Wall;
    let w2!: Wall;
    p.transact('m', () => {
      w1 = wall(p, [0, 0], [5, 0]);
      w2 = wall(p, [5, 0], [5, 4]);
    });
    p.transact('d', () => moveElements(p, [w2.id], { x: 1, y: 0 }));
    expect(p.get<'wall'>(w2.id)!.a).toEqual({ x: 6, y: 0 });
    // L'extrémité du mur voisin suit pour garder le raccord.
    expect(p.get<'wall'>(w1.id)!.b).toEqual({ x: 6, y: 0 });
  });

  it('copie un mur avec ses ouvertures', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => {
      w = wall(p, [0, 0], [5, 0]);
      p.add({ id: 'd1', kind: 'door', hostId: w.id, typeId: 'dt-83', offset: 2, flipHand: false, flipFacing: false, mark: 'P1' });
    });
    const ids = p.transact('c', () => duplicate(p, [w.id], (q) => ({ x: q.x, y: q.y + 3 })));
    expect(ids).toHaveLength(2);
    const copy = ids.map((id) => p.get(id)!).find((e) => e.kind === 'door')!;
    expect(copy.kind === 'door' && copy.hostId).not.toBe(w.id);
    expect(copy.mark).toBe('P2');
  });

  it('fait pivoter et réfléchit', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => (w = wall(p, [0, 0], [4, 0])));
    p.transact('r', () => rotateElements(p, [w.id], { x: 0, y: 0 }, 90));
    expect(p.get<'wall'>(w.id)!.b.x).toBeCloseTo(0);
    expect(p.get<'wall'>(w.id)!.b.y).toBeCloseTo(4);
    expect(reflectPoint({ x: 1, y: 2 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toEqual({ x: -1, y: 2 });
    p.transact('s', () => mirrorElements(p, [w.id], { x: 1, y: 0 }, { x: 1, y: 1 }));
    const m = p.get<'wall'>(w.id)!;
    // Les extrémités sont inversées pour conserver le côté extérieur.
    expect(m.a.x).toBeCloseTo(2);
    expect(m.a.y).toBeCloseTo(4);
  });

  it('crée un réseau', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => (w = wall(p, [0, 0], [0, 3], 'wt-int')));
    const ids = p.transact('a', () => arrayElements(p, [w.id], { x: 2, y: 0 }, 4));
    expect(ids).toHaveLength(3);
    expect(p.get<'wall'>(ids[2])!.a.x).toBeCloseTo(6);
  });

  it('scinde un mur et réattribue les ouvertures', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => {
      w = wall(p, [0, 0], [10, 0]);
      p.add({ id: 'f1', kind: 'window', hostId: w.id, typeId: 'wn-120', offset: 8, sill: 0.9 });
    });
    const second = p.transact('s', () => splitWall(p, w.id, { x: 6, y: 0.1 }))!;
    expect(wallLength(p.get<'wall'>(w.id)!)).toBeCloseTo(6);
    const f = p.get<'window'>('f1')!;
    expect(f.hostId).toBe(second);
    expect(f.offset).toBeCloseTo(2);
  });

  it('ajuste deux murs pour former un angle', () => {
    const p = fresh();
    let a!: Wall;
    let b!: Wall;
    p.transact('m', () => {
      a = wall(p, [0, 0], [6, 0]);
      b = wall(p, [4, -2], [4, 3]);
    });
    // On garde la partie gauche du premier et la partie haute du second.
    p.transact('t', () => trimToCorner(p, a.id, { x: 1, y: 0 }, b.id, { x: 4, y: 2 }));
    expect(p.get<'wall'>(a.id)!.b).toEqual({ x: 4, y: 0 });
    expect(p.get<'wall'>(b.id)!.a).toEqual({ x: 4, y: 0 });
  });

  it('prolonge un mur jusqu’à une ligne', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => (w = wall(p, [0, 0], [3, 0])));
    p.transact('e', () => extendToLine(p, w.id, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: 2.9, y: 0 }));
    expect(p.get<'wall'>(w.id)!.b.x).toBeCloseTo(5);
  });

  it('décale un mur en copie', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => (w = wall(p, [0, 0], [4, 0])));
    const id = p.transact('o', () => offsetWall(p, w.id, 1.5, true))!;
    expect(id).not.toBe(w.id);
    expect(p.get<'wall'>(id)!.a.y).toBeCloseTo(1.5);
  });

  it('aligne un mur sur un quadrillage', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => {
      w = wall(p, [0.3, 0], [0.3, 4], 'wt-int');
      p.add({ id: 'g', kind: 'grid', a: { x: 1, y: -1 }, b: { x: 1, y: 5 }, label: '1' });
    });
    const ref = refLinesNear(p, 'lvl-0', { x: 1, y: 2 }, 0.05).find((l) => l.ownerId === 'g')!;
    const target = refLinesNear(p, 'lvl-0', { x: 0.3, y: 2 }, 0.01).find((l) => l.label === 'Axe du mur')!;
    expect(p.transact('al', () => alignTo(p, ref, target))).toBe(true);
    expect(p.get<'wall'>(w.id)!.a.x).toBeCloseTo(1);
  });

  it('produit les points de cotation en chaîne d’un mur', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => {
      w = wall(p, [0, 0], [6, 0]);
      p.add({ id: 'd1', kind: 'door', hostId: w.id, typeId: 'dt-93', offset: 3, flipHand: false, flipFacing: false });
    });
    const pts = wallChainPoints(p, p.get<'wall'>(w.id)!, 1);
    expect(pts).toHaveLength(4);
    expect(pts[1].x).toBeCloseTo(3 - 0.465);
  });
});

describe('contraintes et nouveaux éléments', () => {
  it('contraint la hauteur d’un mur au niveau supérieur', () => {
    const p = fresh();
    let w!: Wall;
    p.transact('m', () => {
      w = wall(p, [0, 0], [4, 0]);
      w.topLevelId = 'lvl-1';
      w.topOffset = -0.2;
    });
    expect(p.get<'wall'>(w.id)!.height).toBeCloseTo(2.8);
    p.transact('lvl', (d) => (d.levels.find((l) => l.id === 'lvl-1')!.elevation = 3.5));
    expect(p.get<'wall'>(w.id)!.height).toBeCloseTo(3.3);
  });

  it('attache le haut des murs au toit', () => {
    const p = new Project(sampleProject());
    const walls = p.ofKind('wall', 'lvl-1').map((w) => w.id);
    const n = p.transact('a', () => attachWallsToRoof(p, walls));
    expect(n).toBe(walls.length);
    // Un mur attaché est plus volumineux que sa version à hauteur fixe sous un toit en pente.
    const w = p.get<'wall'>(walls[0])!;
    const attached = elementMeshes(p, w)!.solids.reduce((s, x) => s + meshVolume(x.positions), 0);
    p.transact('d', () => (w.attachRoofId = null));
    const plain = elementMeshes(p, w)!.solids.reduce((s, x) => s + meshVolume(x.positions), 0);
    expect(attached).toBeGreaterThan(plain);
  });

  it('perce les sols traversés par une trémie', () => {
    const p = fresh();
    p.transact('m', () => {
      p.add({ id: 's', kind: 'floor', levelId: 'lvl-1', thickness: 0.2, offset: 0, points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }] });
      p.add({ id: 't', kind: 'shaft', levelId: 'lvl-1', height: 0.5, points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 1, y: 2 }] });
    });
    const s = p.get<'floor'>('s')!;
    expect(floorHoles(p, s.points, 3)).toHaveLength(1);
    const vol = meshVolume(elementMeshes(p, s)!.solids[0].positions);
    expect(vol).toBeCloseTo((24 - 2) * 0.2, 3);
  });

  it('génère la géométrie des murs-rideaux, garde-corps et composants', () => {
    const p = new Project(sampleProject());
    let cw!: Wall;
    p.transact('m', () => (cw = wall(p, [20, 0], [26, 0], 'wt-cw')));
    const mesh = elementMeshes(p, cw)!;
    expect(mesh.solids.some((s) => s.material === 'glass')).toBe(true);
    for (const e of p.ofKind('component')) expect(elementMeshes(p, e)!.solids.length).toBeGreaterThan(0);
    for (const e of p.ofKind('railing')) expect(elementMeshes(p, e)!.solids[0].positions.length).toBeGreaterThan(0);
  });
});
