// Export IFC4 (STEP, ISO 10303-21) : niveaux, murs avec réservations, portes,
// fenêtres, dalles, toitures, poteaux, escaliers et espaces.
import { polygonArea, wallDir } from '../model/geometry';
import type { Project } from '../model/project';
import { componentFamily } from '../model/components';
import { elementMeshes, floorHoles } from '../model/mesh';
import { isHosted } from '../model/project';
import type { Element, Id, RoofShape, Vec2 } from '../model/types';

const ROOF_TYPES: Record<RoofShape, string> = { flat: '.FLAT_ROOF.', mono: '.SHED_ROOF.', gable: '.GABLE_ROOF.', hip: '.HIP_ROOF.' };

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** GlobalId IFC : 128 bits encodés sur 22 caractères. */
export function ifcGuid(rand: () => number = Math.random): string {
  let s = B64[Math.floor(rand() * 4)];
  for (let i = 1; i < 22; i++) s += B64[Math.floor(rand() * 64)];
  return s;
}

const str = (s: string | undefined): string => {
  if (s === undefined || s === '') return '$';
  // Encodage des caractères non ASCII selon ISO 10303-21 (\X2\....\X0\).
  let out = '';
  for (const ch of s.replace(/\\/g, '\\\\').replace(/'/g, "''")) {
    const code = ch.codePointAt(0)!;
    out += code < 128 ? ch : `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
  }
  return `'${out}'`;
};
const num = (n: number): string => {
  const r = Math.round(n * 1e6) / 1e6;
  const s = String(r);
  return s.includes('.') || s.includes('e') ? s : `${s}.`;
};
const ref = (id: number): string => `#${id}`;
const list = (ids: number[]): string => `(${ids.map(ref).join(',')})`;

class StepWriter {
  private lines: string[] = [];
  private next = 1;

  add(entity: string): number {
    const id = this.next++;
    this.lines.push(`#${id}=${entity};`);
    return id;
  }

  point(x: number, y: number, z?: number): number {
    return this.add(z === undefined ? `IFCCARTESIANPOINT((${num(x)},${num(y)}))` : `IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  }

  dir(x: number, y: number, z?: number): number {
    return this.add(z === undefined ? `IFCDIRECTION((${num(x)},${num(y)}))` : `IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
  }

  placement3d(x: number, y: number, z: number, refDir?: Vec2): number {
    const loc = this.point(x, y, z);
    if (!refDir) return this.add(`IFCAXIS2PLACEMENT3D(${ref(loc)},$,$)`);
    const axis = this.dir(0, 0, 1);
    const rd = this.dir(refDir.x, refDir.y, 0);
    return this.add(`IFCAXIS2PLACEMENT3D(${ref(loc)},${ref(axis)},${ref(rd)})`);
  }

  body(lines: string[], header: { name: string; author: string; timestamp: string }): string {
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
      `FILE_NAME(${str(header.name)},'${header.timestamp}',(${header.author ? str(header.author) : "''"}),(''),'OpenBIM Studio','OpenBIM Studio','');`,
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      ...lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }

  get content(): string[] {
    return this.lines;
  }
}

export interface IfcOptions {
  author?: string;
  timestamp?: string;
  rand?: () => number;
}

export function exportIFC(p: Project, opts: IfcOptions = {}): string {
  const w = new StepWriter();
  const guid = () => ifcGuid(opts.rand);
  const d = p.data;

  // --- Contexte et unités
  const origin = w.placement3d(0, 0, 0);
  const north = w.dir(0, 1);
  const ctx = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(origin)},${ref(north)})`);
  const bodyCtx = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ref(ctx)},$,.MODEL_VIEW.,$)`);
  const uLen = w.add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const uArea = w.add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uVol = w.add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const uAng = w.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = w.add(`IFCUNITASSIGNMENT(${list([uLen, uArea, uVol, uAng])})`);
  const project = w.add(`IFCPROJECT('${guid()}',$,${str(d.name)},$,$,$,$,(${ref(ctx)}),${ref(units)})`);

  // --- Structure spatiale
  const sitePl = w.add(`IFCLOCALPLACEMENT($,${ref(w.placement3d(0, 0, 0))})`);
  const site = w.add(`IFCSITE('${guid()}',$,'Site',$,$,${ref(sitePl)},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = w.add(`IFCLOCALPLACEMENT(${ref(sitePl)},${ref(w.placement3d(0, 0, 0))})`);
  const building = w.add(`IFCBUILDING('${guid()}',$,${str(d.name)},$,$,${ref(bldPl)},$,$,.ELEMENT.,$,$,$)`);
  w.add(`IFCRELAGGREGATES('${guid()}',$,$,$,${ref(project)},(${ref(site)}))`);
  w.add(`IFCRELAGGREGATES('${guid()}',$,$,$,${ref(site)},(${ref(building)}))`);

  const storeyOf = new Map<Id, { id: number; pl: number; elevation: number }>();
  const storeys: number[] = [];
  for (const l of p.sortedLevels()) {
    const pl = w.add(`IFCLOCALPLACEMENT(${ref(bldPl)},${ref(w.placement3d(0, 0, l.elevation))})`);
    const id = w.add(`IFCBUILDINGSTOREY('${guid()}',$,${str(l.name)},$,$,${ref(pl)},$,$,.ELEMENT.,${num(l.elevation)})`);
    storeyOf.set(l.id, { id, pl, elevation: l.elevation });
    storeys.push(id);
  }
  if (storeys.length) w.add(`IFCRELAGGREGATES('${guid()}',$,$,$,${ref(building)},${list(storeys)})`);

  const contained = new Map<Id, number[]>();
  const contain = (levelId: Id, el: number) => {
    const arr = contained.get(levelId) ?? [];
    arr.push(el);
    contained.set(levelId, arr);
  };

  // --- Géométrie
  const polyline = (pts: Vec2[]): number => {
    const ring = polygonArea(pts) >= 0 ? pts : [...pts].reverse();
    const ids = ring.map((q) => w.point(q.x, q.y));
    return w.add(`IFCPOLYLINE(${list([...ids, ids[0]])})`);
  };
  const extrusion = (pts: Vec2[], z0: number, depth: number): number => {
    const profile = w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${ref(polyline(pts))})`);
    const pos = w.placement3d(0, 0, z0);
    return w.add(`IFCEXTRUDEDAREASOLID(${ref(profile)},${ref(pos)},${ref(w.dir(0, 0, 1))},${num(depth)})`);
  };
  const shape = (items: number[], type = 'SweptSolid'): number => {
    const rep = w.add(`IFCSHAPEREPRESENTATION(${ref(bodyCtx)},'Body','${type}',${list(items)})`);
    return w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(rep)}))`);
  };
  const localPl = (levelId: Id): number => w.add(`IFCLOCALPLACEMENT(${ref(storeyOf.get(levelId)!.pl)},${ref(w.placement3d(0, 0, 0))})`);
  /** Boîte centrée en (0,0) dans un repère local orienté. */
  const box = (along: number, across: number, z0: number, height: number): number => {
    const pos2 = w.add(`IFCAXIS2PLACEMENT2D(${ref(w.point(0, 0))},$)`);
    const profile = w.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${ref(pos2)},${num(along)},${num(across)})`);
    return w.add(`IFCEXTRUDEDAREASOLID(${ref(profile)},${ref(w.placement3d(0, 0, z0))},${ref(w.dir(0, 0, 1))},${num(height)})`);
  };

  const wallIfc = new Map<Id, { id: number; pl: number }>();

  /** Représentation B-rep facettée à partir du maillage de l'élément (géométries non extrudables). */
  const brepOf = (e: Element, elevation: number): number | null => {
    const mesh = elementMeshes(p, e);
    if (!mesh) return null;
    const faces: number[] = [];
    for (const s of mesh.solids) {
      for (let i = 0; i < s.positions.length; i += 9) {
        const pts: number[] = [];
        for (let k = 0; k < 3; k++) {
          const [x, y, z] = s.positions.slice(i + k * 3, i + k * 3 + 3);
          pts.push(w.point(x, -z, y - elevation));
        }
        const loop = w.add(`IFCPOLYLOOP(${list(pts)})`);
        const bound = w.add(`IFCFACEOUTERBOUND(${ref(loop)},.T.)`);
        faces.push(w.add(`IFCFACE((${ref(bound)}))`));
      }
    }
    if (!faces.length) return null;
    const shell = w.add(`IFCCLOSEDSHELL(${list(faces)})`);
    return shape([w.add(`IFCFACETEDBREP(${ref(shell)})`)], 'Brep');
  };

  const emit = (e: Element) => {
    switch (e.kind) {
      case 'wall': {
        if (!storeyOf.has(e.levelId)) return;
        const t = p.wallType(e.typeId);
        const o = p.outline(e);
        const pl = localPl(e.levelId);
        const st = storeyOf.get(e.levelId)!;
        if (t.family === 'curtain') {
          const rep = brepOf(e, st.elevation);
          const id = w.add(`IFCCURTAINWALL('${guid()}',$,${str(t.name)},$,${str(t.name)},${ref(pl)},${rep ? ref(rep) : '$'},${str(e.mark)},.NOTDEFINED.)`);
          contain(e.levelId, id);
          break;
        }
        // Mur attaché au toit : géométrie exacte (B-rep) ; sinon extrusion de l'emprise.
        const rep = e.attachRoofId ? brepOf(e, st.elevation) : shape([extrusion([o.aL, o.bL, o.bR, o.aR], e.baseOffset, e.height)]);
        const id = w.add(
          `IFCWALL('${guid()}',$,${str(t.name)},$,${str(t.name)},${ref(pl)},${rep ? ref(rep) : '$'},${str(e.mark)},.STANDARD.)`,
        );
        wallIfc.set(e.id, { id, pl });
        contain(e.levelId, id);
        break;
      }
      case 'floor': {
        if (!storeyOf.has(e.levelId)) return;
        const pl = localPl(e.levelId);
        const top = storeyOf.get(e.levelId)!.elevation + e.offset;
        const holes = floorHoles(p, e.points, top);
        let solid: number;
        if (holes.length) {
          // Trémies : profil avec évidements.
          const profile = w.add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${ref(polyline(e.points))},${list(holes.map((hl) => polyline(hl)))})`);
          solid = w.add(`IFCEXTRUDEDAREASOLID(${ref(profile)},${ref(w.placement3d(0, 0, e.offset - e.thickness))},${ref(w.dir(0, 0, 1))},${num(e.thickness)})`);
        } else {
          solid = extrusion(e.points, e.offset - e.thickness, e.thickness);
        }
        const id = w.add(`IFCSLAB('${guid()}',$,'Dalle',$,$,${ref(pl)},${ref(shape([solid]))},${str(e.mark)},.FLOOR.)`);
        contain(e.levelId, id);
        break;
      }
      case 'roof': {
        const st = storeyOf.get(e.levelId);
        const mesh = elementMeshes(p, e);
        if (!st || !mesh) return;
        const pl = localPl(e.levelId);
        // Géométrie exacte des pans : représentation B-rep facettée.
        const rep = brepOf(e, st.elevation);
        if (!rep) return;
        const id = w.add(
          `IFCROOF('${guid()}',$,${str(`Toiture ${e.slope}°`)},$,$,${ref(pl)},${ref(rep)},${str(e.mark)},${ROOF_TYPES[e.shape ?? 'mono']})`,
        );
        contain(e.levelId, id);
        break;
      }
      case 'column': {
        if (!storeyOf.has(e.levelId)) return;
        const a = (e.rotation * Math.PI) / 180;
        const pl = w.add(
          `IFCLOCALPLACEMENT(${ref(storeyOf.get(e.levelId)!.pl)},${ref(w.placement3d(e.pos.x, e.pos.y, 0, { x: Math.cos(a), y: Math.sin(a) }))})`,
        );
        let solid: number;
        if (e.shape === 'round') {
          const pos2 = w.add(`IFCAXIS2PLACEMENT2D(${ref(w.point(0, 0))},$)`);
          const prof = w.add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${ref(pos2)},${num(e.width / 2)})`);
          solid = w.add(`IFCEXTRUDEDAREASOLID(${ref(prof)},${ref(w.placement3d(0, 0, 0))},${ref(w.dir(0, 0, 1))},${num(e.height)})`);
        } else {
          solid = box(e.width, e.depth, 0, e.height);
        }
        const id = w.add(`IFCCOLUMN('${guid()}',$,'Poteau',$,$,${ref(pl)},${ref(shape([solid]))},${str(e.mark)},.COLUMN.)`);
        contain(e.levelId, id);
        break;
      }
      case 'stair': {
        if (!storeyOf.has(e.levelId)) return;
        const dx = e.b.x - e.a.x;
        const dy = e.b.y - e.a.y;
        const run = Math.hypot(dx, dy);
        if (run < 1e-6) return;
        const n = Math.max(1, Math.ceil(e.height / e.maxRiser - 1e-9));
        const pl = w.add(
          `IFCLOCALPLACEMENT(${ref(storeyOf.get(e.levelId)!.pl)},${ref(w.placement3d(e.a.x, e.a.y, 0, { x: dx / run, y: dy / run }))})`,
        );
        const items: number[] = [];
        for (let i = 0; i < n; i++) {
          const x0 = (run / n) * i;
          const x1 = (run / n) * (i + 1);
          const pts = [
            { x: x0, y: -e.width / 2 },
            { x: x1, y: -e.width / 2 },
            { x: x1, y: e.width / 2 },
            { x: x0, y: e.width / 2 },
          ];
          items.push(extrusion(pts, 0, (e.height / n) * (i + 1)));
        }
        const id = w.add(`IFCSTAIR('${guid()}',$,'Escalier',$,$,${ref(pl)},${ref(shape(items))},${str(e.mark)},.STRAIGHT_RUN_STAIR.)`);
        contain(e.levelId, id);
        break;
      }
      case 'room': {
        if (!storeyOf.has(e.levelId) || e.points.length < 3) return;
        const lvl = p.level(e.levelId)!;
        const pl = localPl(e.levelId);
        const solid = extrusion(e.points, 0, lvl.height);
        const id = w.add(
          `IFCSPACE('${guid()}',$,${str(e.number)},$,$,${ref(pl)},${ref(shape([solid]))},${str(e.name)},.ELEMENT.,.INTERNAL.,$)`,
        );
        contain(e.levelId, id);
        break;
      }
      case 'ceiling': {
        if (!storeyOf.has(e.levelId)) return;
        const solid = extrusion(e.points, e.height, e.thickness);
        const id = w.add(`IFCCOVERING('${guid()}',$,'Faux-plafond',$,$,${ref(localPl(e.levelId))},${ref(shape([solid]))},${str(e.mark)},.CEILING.)`);
        contain(e.levelId, id);
        break;
      }
      case 'railing': {
        const st = storeyOf.get(e.levelId);
        if (!st) return;
        const rep = brepOf(e, st.elevation);
        const id = w.add(`IFCRAILING('${guid()}',$,'Garde-corps',$,$,${ref(localPl(e.levelId))},${rep ? ref(rep) : '$'},${str(e.mark)},.GUARDRAIL.)`);
        contain(e.levelId, id);
        break;
      }
      case 'component': {
        const st = storeyOf.get(e.levelId);
        if (!st) return;
        const fam = componentFamily(e.family);
        const rep = brepOf(e, st.elevation);
        const pl = localPl(e.levelId);
        const r = rep ? ref(rep) : '$';
        const sanitary: Record<string, string> = { wc: 'TOILETPAN', sink: 'WASHHANDBASIN', bathtub: 'BATH', shower: 'SHOWER' };
        const furniture: Record<string, string> = { 'bed-double': 'BED', 'bed-single': 'BED', sofa: 'SOFA', armchair: 'CHAIR', 'table-dining': 'TABLE', 'table-round': 'TABLE', desk: 'DESK', wardrobe: 'SHELF' };
        let id: number;
        if (sanitary[fam.id]) id = w.add(`IFCSANITARYTERMINAL('${guid()}',$,${str(fam.name)},$,$,${ref(pl)},${r},${str(e.mark)},.${sanitary[fam.id]}.)`);
        else if (fam.category === 'Mobilier' || fam.category === 'Cuisine') id = w.add(`IFCFURNITURE('${guid()}',$,${str(fam.name)},$,$,${ref(pl)},${r},${str(e.mark)},.${furniture[fam.id] ?? 'NOTDEFINED'}.)`);
        else id = w.add(`IFCFURNISHINGELEMENT('${guid()}',$,${str(fam.name)},$,$,${ref(pl)},${r},${str(e.mark)})`);
        contain(e.levelId, id);
        break;
      }
      default:
        break;
    }
  };

  const elements = p.elements;
  for (const e of elements) if (!isHosted(e)) emit(e);

  // --- Ouvertures sans menuiserie : simple réservation dans le mur.
  for (const e of elements) {
    if (e.kind !== 'opening') continue;
    const host = p.get<'wall'>(e.hostId);
    const hostIfc = host && wallIfc.get(host.id);
    if (!host || !hostIfc) continue;
    const dir = wallDir(host);
    const pl = w.add(`IFCLOCALPLACEMENT(${ref(hostIfc.pl)},${ref(w.placement3d(host.a.x + dir.x * e.offset, host.a.y + dir.y * e.offset, host.baseOffset + e.sill, dir))})`);
    const solid = box(e.width, p.thickness(host) + 0.1, 0, e.height);
    const opening = w.add(`IFCOPENINGELEMENT('${guid()}',$,${str('Ouverture')},$,$,${ref(pl)},${ref(shape([solid]))},${str(e.mark)},.OPENING.)`);
    w.add(`IFCRELVOIDSELEMENT('${guid()}',$,$,$,${ref(hostIfc.id)},${ref(opening)})`);
  }

  // --- Portes et fenêtres : réservation dans le mur + élément de remplissage.
  for (const e of elements) {
    if (e.kind !== 'door' && e.kind !== 'window') continue;
    const host = p.get<'wall'>(e.hostId);
    const hostIfc = host && wallIfc.get(host.id);
    if (!host || !hostIfc) continue;
    const t = e.kind === 'door' ? p.doorType(e.typeId) : p.windowType(e.typeId);
    const dir = wallDir(host);
    const cx = host.a.x + dir.x * e.offset;
    const cy = host.a.y + dir.y * e.offset;
    const thick = p.thickness(host);
    const bottom = host.baseOffset + (e.kind === 'door' ? 0 : e.sill);
    const openPl = w.add(`IFCLOCALPLACEMENT(${ref(hostIfc.pl)},${ref(w.placement3d(cx, cy, bottom, dir))})`);
    const openSolid = box(t.width, thick + 0.1, 0, t.height);
    const opening = w.add(`IFCOPENINGELEMENT('${guid()}',$,${str('Réservation')},$,$,${ref(openPl)},${ref(shape([openSolid]))},$,.OPENING.)`);
    w.add(`IFCRELVOIDSELEMENT('${guid()}',$,$,$,${ref(hostIfc.id)},${ref(opening)})`);
    const fillPl = w.add(`IFCLOCALPLACEMENT(${ref(openPl)},${ref(w.placement3d(0, 0, 0))})`);
    const fillSolid = box(t.width, e.kind === 'door' ? 0.05 : 0.08, 0, t.height);
    const fill =
      e.kind === 'door'
        ? w.add(
            `IFCDOOR('${guid()}',$,${str(t.name)},$,$,${ref(fillPl)},${ref(shape([fillSolid]))},${str(e.mark)},${num(t.height)},${num(t.width)},.DOOR.,.SINGLE_SWING_${e.flipHand ? 'RIGHT' : 'LEFT'}.,$)`,
          )
        : w.add(
            `IFCWINDOW('${guid()}',$,${str(t.name)},$,$,${ref(fillPl)},${ref(shape([fillSolid]))},${str(e.mark)},${num(t.height)},${num(t.width)},.WINDOW.,.SINGLE_PANEL.,$)`,
          );
    w.add(`IFCRELFILLSELEMENT('${guid()}',$,$,$,${ref(opening)},${ref(fill)})`);
    contain(host.levelId, fill);
  }

  for (const [levelId, ids] of contained) {
    const st = storeyOf.get(levelId);
    if (st && ids.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',$,$,$,${list(ids)},${ref(st.id)})`);
  }

  const timestamp = opts.timestamp ?? new Date().toISOString().slice(0, 19);
  return w.body(w.content, { name: `${d.name}.ifc`, author: opts.author ?? '', timestamp });
}
