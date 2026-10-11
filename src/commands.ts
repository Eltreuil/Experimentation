import type { App } from './app';
import { add, bounds, polygonCentroid, rotate, v } from './model/geometry';
import { newId } from './model/project';
import { buildingFootprint, offsetPolygon } from './model/rooms';
import type { Element, Id, Level, Vec2 } from './model/types';

let clipboard: Element[] = [];

function transformElement(e: Element, f: (p: Vec2) => Vec2, mirror = false): void {
  switch (e.kind) {
    case 'wall':
    case 'stair':
    case 'dimension':
    case 'grid':
      e.a = f(e.a);
      e.b = f(e.b);
      break;
    case 'floor':
    case 'room':
    case 'roof':
      e.points = e.points.map(f);
      // Une symétrie inverse le sens du contour : on le rétablit.
      if (mirror) e.points.reverse();
      break;
    case 'column':
      e.pos = f(e.pos);
      break;
    case 'door':
    case 'window':
      // Les ouvertures sont repositionnées avec leur mur hôte.
      break;
  }
}

/** Centre de la sélection (pour rotation / symétrie). */
function selectionCenter(app: App, ids: Id[]): Vec2 {
  const pts: Vec2[] = [];
  for (const id of ids) {
    const e = app.project.get(id);
    if (!e) continue;
    if ('a' in e) pts.push(e.a, e.b);
    else if ('points' in e) pts.push(polygonCentroid(e.points));
    else if (e.kind === 'column') pts.push(e.pos);
  }
  if (!pts.length) return v(0, 0);
  const b = bounds(pts);
  return v((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2);
}

export function copySelection(app: App): void {
  const ids = new Set(app.selection);
  // Les ouvertures accompagnent leur mur hôte.
  for (const e of app.project.elements) if ((e.kind === 'door' || e.kind === 'window') && ids.has(e.hostId)) ids.add(e.id);
  clipboard = [...ids].map((id) => app.project.get(id)).filter((e): e is Element => !!e).map((e) => structuredClone(e));
  app.status(`${clipboard.length} élément(s) copié(s)`);
}

export function paste(app: App, offset: Vec2 = v(1, -1)): void {
  if (!clipboard.length) return;
  const p = app.project;
  const levelId = app.activeLevelId;
  const idMap = new Map<Id, Id>();
  const created: Id[] = [];
  p.transact('Coller', () => {
    for (const src of clipboard) {
      if (src.kind === 'door' || src.kind === 'window') continue;
      const e = structuredClone(src);
      e.id = newId(e.kind[0]);
      idMap.set(src.id, e.id);
      if ('levelId' in e) e.levelId = levelId;
      transformElement(e, (q) => add(q, offset));
      if (e.mark && (e.kind === 'column' || e.kind === 'stair')) e.mark = p.nextMark(e.kind);
      if (e.kind === 'room') e.number = p.nextRoomNumber();
      if (e.kind === 'grid') e.label = p.nextGridLabel();
      p.add(e);
      created.push(e.id);
    }
    for (const src of clipboard) {
      if (src.kind !== 'door' && src.kind !== 'window') continue;
      const host = idMap.get(src.hostId);
      if (!host) continue;
      const e = structuredClone(src);
      e.id = newId(e.kind[0]);
      e.hostId = host;
      e.mark = p.nextMark(e.kind);
      p.add(e);
      created.push(e.id);
    }
  });
  app.select(created);
}

export function rotateSelection(app: App, degrees = 90): void {
  const ids = [...app.selection];
  if (!ids.length) return;
  const c = selectionCenter(app, ids);
  const a = (degrees * Math.PI) / 180;
  app.project.transact('Rotation', () => {
    for (const id of ids) {
      const e = app.project.get(id);
      if (!e) continue;
      transformElement(e, (q) => rotate(q, a, c));
      if (e.kind === 'column') e.rotation = (e.rotation + degrees) % 360;
    }
  });
}

export function mirrorSelection(app: App, axis: 'x' | 'y'): void {
  const ids = [...app.selection];
  if (!ids.length) return;
  const c = selectionCenter(app, ids);
  const f = (q: Vec2): Vec2 => (axis === 'x' ? v(2 * c.x - q.x, q.y) : v(q.x, 2 * c.y - q.y));
  app.project.transact('Symétrie', () => {
    for (const id of ids) {
      const e = app.project.get(id);
      if (!e) continue;
      transformElement(e, f, true);
    }
    // On inverse le sens des murs pour conserver leur côté extérieur ;
    // les ouvertures sont donc remesurées depuis la nouvelle origine.
    for (const id of ids) {
      const e = app.project.get(id);
      if (e?.kind !== 'wall') continue;
      const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      for (const o of app.project.hosted(e.id)) {
        o.offset = L - o.offset;
        if (o.kind === 'door') o.flipHand = !o.flipHand;
      }
      const tmp = e.a;
      e.a = e.b;
      e.b = tmp;
    }
  });
}

export function flipSelectedDoors(app: App, what: 'hand' | 'facing'): void {
  app.project.transact('Inverser', () => {
    for (const id of app.selection) {
      const e = app.project.get(id);
      if (e?.kind !== 'door') continue;
      if (what === 'hand') e.flipHand = !e.flipHand;
      else e.flipFacing = !e.flipFacing;
    }
  });
}

export function floorFromWalls(app: App): boolean {
  const p = app.project;
  const levelId = app.activeLevelId;
  const pts = buildingFootprint(p, levelId);
  if (!pts) {
    app.status('Aucun contour de murs fermé trouvé sur ce niveau.');
    return false;
  }
  const id = newId('s');
  p.transact('Sol depuis les murs', () => p.add({ id, kind: 'floor', levelId, points: pts, thickness: app.options.floorThickness, offset: 0 }));
  app.select([id]);
  return true;
}

export function roofFromWalls(app: App): boolean {
  const p = app.project;
  const levelId = app.activeLevelId;
  const pts = buildingFootprint(p, levelId);
  if (!pts) {
    app.status('Aucun contour de murs fermé trouvé sur ce niveau.');
    return false;
  }
  const walls = p.ofKind('wall', levelId);
  const top = Math.max(...walls.map((w) => w.baseOffset + w.height));
  const id = newId('t');
  p.transact('Toit depuis les murs', () =>
    p.add({
      id,
      kind: 'roof',
      levelId,
      points: offsetPolygon(pts, app.options.roofOverhang),
      thickness: app.options.roofThickness,
      slope: app.options.roofSlope,
      shape: app.options.roofShape,
      baseOffset: top,
    }),
  );
  app.select([id]);
  return true;
}

export function addLevel(app: App): Level {
  const p = app.project;
  const levels = p.sortedLevels();
  const top = levels[levels.length - 1];
  const elevation = top ? top.elevation + Math.max(top.height + 0.3, 2.5) : 0;
  const lvl: Level = { id: newId('lvl'), name: `Niveau ${levels.length}`, elevation: Math.round(elevation * 100) / 100, height: top?.height ?? 2.7 };
  p.transact('Nouveau niveau', (d) => d.levels.push(lvl));
  return lvl;
}

/** Copie les murs d'un niveau vers un autre (ex. monter les murs extérieurs d'un étage). */
export function copyWallsToLevel(app: App, fromId: Id, toId: Id, onlyExterior = true): number {
  const p = app.project;
  const lvl = p.level(toId);
  if (!lvl) return 0;
  const walls = p.ofKind('wall', fromId).filter((w) => !onlyExterior || p.wallType(w.typeId).function === 'exterior');
  p.transact('Copier les murs au niveau', () => {
    for (const w of walls) p.add({ ...structuredClone(w), id: newId('w'), levelId: toId, height: lvl.height });
  });
  return walls.length;
}

export function deleteLevel(app: App, id: Id): boolean {
  const p = app.project;
  if (p.data.levels.length <= 1) return false;
  p.transact('Supprimer le niveau', (d) => {
    const ids = p.elements.filter((e) => 'levelId' in e && e.levelId === id).map((e) => e.id);
    p.remove(ids);
    d.levels = d.levels.filter((l) => l.id !== id);
  });
  return true;
}

