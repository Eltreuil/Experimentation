// Signature géométrique d'un élément : change si et seulement si sa géométrie 3D
// peut avoir changé (lui-même ou une de ses dépendances). Sert à ne reconstruire
// que les éléments modifiés dans les vues 3D.
import { isHosted, type Project } from './project';
import type { Element } from './types';

export function elementSignature(p: Project, e: Element): string {
  const parts: unknown[] = [e];
  const lvl = (id: string | undefined) => (id ? p.level(id)?.elevation : undefined);
  switch (e.kind) {
    case 'wall': {
      parts.push(lvl(e.levelId), p.wallType(e.typeId), p.outline(e), p.openingSpans(e));
      if (e.attachRoofId) {
        const r = p.get<'roof'>(e.attachRoofId);
        parts.push(r, lvl(r?.levelId));
      }
      break;
    }
    case 'door':
    case 'window':
    case 'opening': {
      const w = p.get<'wall'>(e.hostId);
      parts.push(w, w && lvl(w.levelId), w && p.thickness(w));
      if (e.kind === 'door') parts.push(p.doorType(e.typeId));
      if (e.kind === 'window') parts.push(p.windowType(e.typeId));
      break;
    }
    case 'floor':
      // Les trémies percent les sols.
      parts.push(lvl(e.levelId), p.ofKind('shaft').map((s) => [s, lvl(s.levelId)]));
      break;
    case 'component':
      parts.push(lvl(e.levelId), p.family(e.family));
      break;
    default:
      if ('levelId' in e) parts.push(lvl(e.levelId));
  }
  if (isHosted(e)) parts.push('h');
  return JSON.stringify(parts);
}
