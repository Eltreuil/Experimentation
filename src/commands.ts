import type { App } from './app';
import { attachWallsToRoof, detachWalls, duplicate, elementsCenter, mirrorElements, rotateElements, withHosted } from './model/edit';
import { add, v } from './model/geometry';
import { isHosted, newId } from './model/project';
import { buildingFootprint, offsetPolygon } from './model/rooms';
import type { Element, Id, Level, Vec2 } from './model/types';

let clipboard: { ids: Id[]; data: string } | null = null;

export function copySelection(app: App): void {
  if (!app.selection.size) return;
  // On mémorise un instantané : le collage fonctionne même si les originaux changent.
  const ids = [...withHosted(app.project, app.selection)];
  const data = JSON.stringify(ids.map((id) => app.project.get(id)).filter(Boolean));
  clipboard = { ids, data };
  app.status(`${ids.length} élément(s) copié(s)`);
}

export function paste(app: App, offset: Vec2 = v(1, -1)): void {
  if (!clipboard) return;
  const p = app.project;
  const source = JSON.parse(clipboard.data) as Element[];
  const created = p.transact('Coller', () => {
    // Les éléments du presse-papiers absents du projet y sont réinsérés le temps de la duplication.
    const before = new Set(Object.keys(p.data.elements));
    for (const e of source) if (!p.data.elements[e.id]) p.data.elements[e.id] = structuredClone(e);
    const ids = duplicate(p, source.filter((e) => !isHosted(e)).map((e) => e.id), (q) => add(q, offset), { levelId: app.activeLevelId });
    for (const e of source) if (!before.has(e.id)) delete p.data.elements[e.id];
    return ids;
  });
  app.select(created);
}

export function rotateSelection(app: App, degrees = 90): void {
  const ids = [...app.selection];
  if (!ids.length) return;
  const c = elementsCenter(app.project, ids);
  app.project.transact('Rotation', () => rotateElements(app.project, ids, c, degrees));
}

export function mirrorSelection(app: App, axis: 'x' | 'y'): void {
  const ids = [...app.selection];
  if (!ids.length) return;
  const c = elementsCenter(app.project, ids);
  const b = axis === 'x' ? v(c.x, c.y + 1) : v(c.x + 1, c.y);
  app.project.transact('Symétrie', () => mirrorElements(app.project, ids, c, b));
}

export function attachSelectedWalls(app: App): void {
  const walls = [...app.selection].filter((id) => app.project.get(id)?.kind === 'wall');
  if (!walls.length) {
    app.status('Sélectionnez des murs à attacher au toit.');
    return;
  }
  const n = app.project.transact('Attacher haut', () => attachWallsToRoof(app.project, walls));
  app.status(n ? `${n} mur(s) attaché(s) au toit.` : 'Aucun toit trouvé au-dessus des murs sélectionnés.');
}

export function detachSelectedWalls(app: App): void {
  const walls = [...app.selection].filter((id) => app.project.get(id)?.kind === 'wall');
  app.project.transact('Détacher haut', () => detachWalls(app.project, walls));
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

