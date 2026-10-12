import type { App } from '../app';
import { flipSelectedDoors } from '../commands';
import { polygonArea, polygonCentroid, polygonPerimeter, stairRisers, wallLength, add, mul, wallDir, dist } from '../model/geometry';
import { formatLength, levelOf } from '../model/project';
import { PHASE_FILTERS, isPhased, viewPhase } from '../model/phases';
import { viewKey } from '../app';
import { familyEditor, formatParam, paramField } from './familyEditor';
import { wallLayersDialog } from './dialogs';
import { KIND_LABELS, type Element, type ElementKind, type Id, type LineStyle, type ViewSettings } from '../model/types';
import { LINE_STYLES } from '../views/planView';
import { REGION_PATTERNS } from './ribbon';
import { clear, h, perFrame } from './dom';
import { ROOF_SHAPES } from './ribbon';
import { checkField, colorField, lengthField, numberField, readonlyField, row, selectField, textField } from './fields';

/** Palette « Propriétés » : paramètres d'occurrence et de type de la sélection. */
export class PropertiesPanel {
  constructor(
    private app: App,
    private root: HTMLElement,
  ) {
    app.on('selection', () => this.render());
    app.on('view', () => this.render());
    app.project.onChange(
      perFrame(() => {
        // Ne pas reconstruire pendant une saisie (le champ perdrait le focus).
        if (!root.contains(document.activeElement)) this.render();
      }),
    );
    this.render();
  }

  private edit(label: string, fn: () => void): void {
    this.app.project.transact(label, () => {
      fn();
      this.app.project.clampOpenings();
    });
    this.render();
  }

  render(): void {
    const root = this.root;
    clear(root);
    const sel = [...this.app.selection].map((id) => this.app.project.get(id)).filter((e): e is Element => !!e);
    if (sel.length === 0) {
      this.renderView(root);
    } else if (sel.length === 1) {
      this.renderElement(root, sel[0]);
    } else {
      this.renderMulti(root, sel);
    }
  }

  private section(root: HTMLElement, title: string): HTMLElement {
    const body = h('div', { class: 'prop-body' });
    root.append(h('div', { class: 'prop-section' }, h('div', { class: 'prop-title' }, title), body));
    return body;
  }

  private header(root: HTMLElement, title: string, subtitle?: string): void {
    root.append(h('div', { class: 'prop-header' }, h('div', { class: 'prop-kind' }, title), subtitle ? h('div', { class: 'prop-sub' }, subtitle) : null));
  }

  private renderView(root: HTMLElement): void {
    const p = this.app.project;
    const v = this.app.view;
    const u = p.data.units;
    if (v.kind === 'plan') {
      const lvl = p.level(v.levelId);
      if (!lvl) return;
      this.header(root, 'Vue en plan', lvl.name);
      const s = this.section(root, 'Niveau');
      s.append(row('Nom', textField(lvl.name, (val) => this.edit('Renommer le niveau', () => (lvl.name = val || lvl.name)))));
      s.append(row('Altitude', lengthField(lvl.elevation, u, (m) => this.edit('Altitude du niveau', () => (lvl.elevation = m)))));
      s.append(row('Hauteur d’étage', lengthField(lvl.height, u, (m) => this.edit('Hauteur du niveau', () => (lvl.height = m)), { min: 0.5 })));
      const counts = new Map<ElementKind, number>();
      for (const e of p.elements) {
        if (levelOf(p, e) !== lvl.id) continue;
        counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      }
      const c = this.section(root, 'Contenu du niveau');
      if (!counts.size) c.append(h('div', { class: 'prop-empty' }, 'Aucun élément'));
      for (const [k, n] of counts) c.append(row(KIND_LABELS[k], readonlyField(String(n))));
    } else {
      const titles = { '3d': 'Vue 3D', elevation: 'Élévation', schedule: 'Nomenclature', section: 'Coupe' } as const;
      this.header(root, titles[v.kind]);
    }
    if (v.kind !== 'schedule') {
      const key = viewKey(v);
      const settings = p.data.viewSettings?.[key];
      const { phase, filter } = viewPhase(p, settings);
      const setView = (patch: Partial<ViewSettings>) =>
        this.edit('Phase de la vue', () => {
          p.data.viewSettings = p.data.viewSettings ?? {};
          p.data.viewSettings[key] = { ...(p.data.viewSettings[key] ?? {}), ...patch };
        });
      const ph = this.section(root, 'Phases');
      ph.append(row('Phase', selectField(phase, p.phases.map((x) => ({ value: x.id, label: x.name })), (val) => setView({ phase: val })), 'Les nouveaux éléments sont créés dans cette phase'));
      ph.append(row('Filtre de phase', selectField(filter, PHASE_FILTERS, (val) => setView({ phaseFilter: val }))));
    }
    const proj = this.section(root, 'Projet');
    proj.append(row('Nom du projet', textField(p.data.name, (val) => this.edit('Nom du projet', () => (p.data.name = val || p.data.name)))));
    proj.append(
      row(
        'Unités',
        selectField(p.data.units, [
          { value: 'mm', label: 'Millimètres' },
          { value: 'cm', label: 'Centimètres' },
          { value: 'm', label: 'Mètres' },
        ], (val) => this.edit('Unités', () => (p.data.units = val))),
      ),
    );
    root.append(h('div', { class: 'prop-tip' }, 'Astuce : sélectionnez un élément pour modifier ses paramètres. Raccourcis : MU mur, PO porte, FE fenêtre, PI pièce, CO cote.'));
  }

  private renderMulti(root: HTMLElement, sel: Element[]): void {
    const counts = new Map<ElementKind, number>();
    for (const e of sel) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    this.header(root, `${sel.length} éléments sélectionnés`);
    const s = this.section(root, 'Catégories');
    for (const [k, n] of counts) s.append(row(KIND_LABELS[k], readonlyField(String(n))));
    // Changement de type groupé pour des murs.
    if (counts.size === 1 && counts.has('wall')) {
      const p = this.app.project;
      const walls = sel as Extract<Element, { kind: 'wall' }>[];
      const t = this.section(root, 'Type commun');
      t.append(
        row(
          'Type',
          selectField(
            walls.every((w) => w.typeId === walls[0].typeId) ? walls[0].typeId : '',
            [{ value: '', label: '— Varié —' }, ...p.data.wallTypes.map((x) => ({ value: x.id, label: x.name }))],
            (val) => val && this.edit('Changer de type', () => walls.forEach((w) => (w.typeId = val))),
          ),
        ),
      );
      t.append(row('Hauteur', lengthField(walls[0].height, p.data.units, (m) => this.edit('Hauteur', () => walls.forEach((w) => (w.height = m))), { min: 0.1 })));
    }
    root.append(h('button', { class: 'btn danger block', onclick: () => this.app.deleteSelection() }, 'Supprimer la sélection'));
  }

  private renderElement(root: HTMLElement, e: Element): void {
    const p = this.app.project;
    const u = p.data.units;
    const L = (v: number, set: (m: number) => void, min?: number) => lengthField(v, u, (m) => this.edit('Modifier', () => set(m)), { min });
    const levelSelect = (levelId: Id, set: (id: Id) => void) =>
      selectField(levelId, p.sortedLevels().map((l) => ({ value: l.id, label: l.name })), (val) => this.edit('Niveau', () => set(val)));
    const common = (s: HTMLElement) => {
      s.append(row('Repère', textField(e.mark ?? '', (val) => this.edit('Repère', () => (e.mark = val || undefined)))));
      s.append(row('Commentaires', textField(e.comments ?? '', (val) => this.edit('Commentaires', () => (e.comments = val || undefined)))));
      if (!isPhased(e)) return;
      const ph = this.section(root, 'Phases');
      const phases = p.phases.map((x) => ({ value: x.id, label: x.name }));
      ph.append(row('Phase de création', selectField(e.phaseCreated ?? p.phases[0].id, phases, (val) => this.edit('Phase de création', () => (e.phaseCreated = val)))));
      ph.append(row('Phase de démolition', selectField(e.phaseDemolished ?? '', [{ value: '', label: 'Aucune' }, ...phases], (val) => this.edit('Phase de démolition', () => (e.phaseDemolished = val || null)))));
      ph.append(row('Épinglé', checkField(!!e.pinned, (val) => this.edit(val ? 'Épingler' : 'Désépingler', () => (e.pinned = val || undefined))), 'Un élément épinglé ne peut pas être déplacé ni supprimé'));
    };

    switch (e.kind) {
      case 'wall': {
        const t = p.wallType(e.typeId);
        this.header(root, 'Mur', t.name);
        root.append(this.typeSelector(e.typeId, p.data.wallTypes, (id) => (e.typeId = id)));
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Décalage inférieur', L(e.baseOffset, (m) => (e.baseOffset = m))));
        const above = p.sortedLevels().filter((l) => l.elevation > (p.level(e.levelId)?.elevation ?? 0));
        c.append(
          row(
            'Contrainte supérieure',
            selectField(
              e.topLevelId ?? '',
              [{ value: '', label: 'Non contrainte' }, ...above.map((l) => ({ value: l.id, label: `Jusqu’au niveau : ${l.name}` }))],
              (val) => this.edit('Contrainte supérieure', () => (e.topLevelId = val || null)),
            ),
          ),
        );
        if (e.topLevelId) {
          c.append(row('Décalage supérieur', L(e.topOffset ?? 0, (m) => (e.topOffset = m))));
          c.append(row('Hauteur', readonlyField(formatLength(e.height, u, true))));
        } else {
          c.append(row('Hauteur non contrainte', L(e.height, (m) => (e.height = m), 0.1)));
        }
        const roofs = p.ofKind('roof');
        c.append(
          row(
            'Haut attaché au toit',
            selectField(
              e.attachRoofId ?? '',
              [{ value: '', label: 'Non' }, ...roofs.map((r) => ({ value: r.id, label: `Toit ${p.level(r.levelId)?.name ?? ''} (${r.slope}°)` }))],
              (val) => this.edit('Attacher haut', () => (e.attachRoofId = val || null)),
            ),
          ),
        );
        const d = this.section(root, 'Cotes');
        d.append(
          row(
            'Longueur',
            L(wallLength(e), (m) => {
              if (m > 0.01) e.b = add(e.a, mul(wallDir(e), m));
            }, 0.01),
          ),
        );
        const openings = p.openingSpans(e).reduce((acc, o) => acc + (o.end - o.start) * (Math.min(o.top, e.height) - o.bottom), 0);
        d.append(row('Surface', readonlyField(`${Math.max(0, wallLength(e) * e.height - openings).toFixed(2)} m²`)));
        d.append(row('Volume', readonlyField(`${(Math.max(0, wallLength(e) * e.height - openings) * t.thickness).toFixed(2)} m³`)));
        common(this.section(root, 'Données d’identification'));
        this.typeSection(root, 'wall', e.typeId);
        root.append(
          h('button', {
            class: 'btn block',
            onclick: () =>
              this.edit('Inverser le mur', () => {
                const a = e.a;
                const L0 = wallLength(e);
                e.a = e.b;
                e.b = a;
                for (const o of p.hosted(e.id)) {
                  o.offset = L0 - o.offset;
                  if (o.kind === 'door') o.flipHand = !o.flipHand;
                }
              }),
          }, 'Inverser le sens du mur'),
        );
        break;
      }
      case 'door':
      case 'window': {
        const isDoor = e.kind === 'door';
        const t = isDoor ? p.doorType(e.typeId) : p.windowType(e.typeId);
        const host = p.get<'wall'>(e.hostId);
        this.header(root, isDoor ? 'Porte' : 'Fenêtre', t.name);
        root.append(
          isDoor
            ? this.typeSelector(e.typeId, p.data.doorTypes, (id) => (e.typeId = id))
            : this.typeSelector(e.typeId, p.data.windowTypes, (id) => (e.typeId = id)),
        );
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', readonlyField(host ? p.level(host.levelId)?.name ?? '' : '')));
        c.append(row('Distance depuis l’origine du mur', L(e.offset - t.width / 2, (m) => (e.offset = m + t.width / 2), 0)));
        if (e.kind === 'window') c.append(row('Hauteur d’allège', L(e.sill, (m) => (e.sill = m), 0)));
        if (e.kind === 'door') {
          c.append(row('Inverser le sens (main)', checkField(e.flipHand, (val) => this.edit('Inverser', () => (e.flipHand = val)))));
          c.append(row('Inverser l’ouverture', checkField(e.flipFacing, (val) => this.edit('Inverser', () => (e.flipFacing = val)))));
        }
        common(this.section(root, 'Données d’identification'));
        this.typeSection(root, e.kind, e.typeId);
        if (e.kind === 'door') {
          root.append(
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn', onclick: () => flipSelectedDoors(this.app, 'hand') }, '⇆ Main'),
              h('button', { class: 'btn', onclick: () => flipSelectedDoors(this.app, 'facing') }, '⇅ Ouverture'),
            ),
          );
        }
        break;
      }
      case 'floor': {
        this.header(root, 'Sol', `Dalle ${formatLength(e.thickness, u, true)}`);
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Décalage par rapport au niveau', L(e.offset, (m) => (e.offset = m))));
        c.append(row('Épaisseur', L(e.thickness, (m) => (e.thickness = m), 0.01)));
        const d = this.section(root, 'Cotes');
        const area = Math.abs(polygonArea(e.points));
        d.append(row('Surface', readonlyField(`${area.toFixed(2)} m²`)));
        d.append(row('Périmètre', readonlyField(formatLength(polygonPerimeter(e.points), u, true))));
        d.append(row('Volume', readonlyField(`${(area * e.thickness).toFixed(2)} m³`)));
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'roof': {
        this.header(root, 'Toit', `${ROOF_SHAPES.find((r) => r.value === (e.shape ?? 'mono'))?.label} · ${e.slope}°`);
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau de base', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Décalage de la base', L(e.baseOffset, (m) => (e.baseOffset = m))));
        c.append(row('Forme', selectField(e.shape ?? 'mono', ROOF_SHAPES, (val) => this.edit('Forme du toit', () => (e.shape = val)))));
        c.append(row('Pente', numberField(e.slope, (val) => this.edit('Pente', () => (e.slope = val)), { min: 0, max: 75, step: 1, suffix: '°' })));
        c.append(row('Épaisseur', L(e.thickness, (m) => (e.thickness = m), 0.01)));
        const d = this.section(root, 'Cotes');
        const area = Math.abs(polygonArea(e.points));
        d.append(row('Surface projetée', readonlyField(`${area.toFixed(2)} m²`)));
        d.append(row('Surface rampante', readonlyField(`${(area / Math.cos((e.slope * Math.PI) / 180)).toFixed(2)} m²`)));
        root.append(
          h('button', {
            class: 'btn block',
            title: 'Pour 1 ou 2 pans, la pente part de la première arête du contour',
            onclick: () => this.edit('Changer l’arête de pente', () => e.points.push(e.points.shift()!)),
          }, 'Changer l’arête de pente'),
        );
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'column': {
        this.header(root, 'Poteau', e.shape === 'round' ? 'Circulaire' : 'Rectangulaire');
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Hauteur', L(e.height, (m) => (e.height = m), 0.1)));
        const d = this.section(root, 'Cotes');
        d.append(row('Forme', selectField(e.shape, [{ value: 'rect', label: 'Rectangulaire' }, { value: 'round', label: 'Circulaire' }], (val) => this.edit('Forme', () => (e.shape = val)))));
        d.append(row(e.shape === 'round' ? 'Diamètre' : 'Largeur', L(e.width, (m) => (e.width = m), 0.05)));
        if (e.shape === 'rect') {
          d.append(row('Profondeur', L(e.depth, (m) => (e.depth = m), 0.05)));
          d.append(row('Rotation', numberField(e.rotation, (val) => this.edit('Rotation', () => (e.rotation = val)), { step: 15, suffix: '°' })));
        }
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'room': {
        this.header(root, 'Pièce', `${e.number} ${e.name}`);
        const id = this.section(root, 'Données d’identification');
        id.append(row('Numéro', textField(e.number, (val) => this.edit('Numéro', () => (e.number = val)))));
        id.append(row('Nom', textField(e.name, (val) => this.edit('Nom', () => (e.name = val)))));
        id.append(row('Commentaires', textField(e.comments ?? '', (val) => this.edit('Commentaires', () => (e.comments = val || undefined)))));
        const c = this.section(root, 'Contraintes');
        c.append(
          row(
            'Délimitée par les murs',
            checkField(!!e.seed, (val) => this.edit('Pièce délimitée', () => (e.seed = val ? polygonCentroid(e.points) : undefined))),
            'Le contour suit automatiquement les murs',
          ),
        );
        if (e.notEnclosed) c.append(h('div', { class: 'fe-errors' }, '⚠ Pièce non fermée : les murs ne délimitent plus un espace clos autour de son point d’insertion.'));
        const d = this.section(root, 'Cotes');
        d.append(row('Niveau', readonlyField(p.level(e.levelId)?.name ?? '')));
        d.append(row('Surface', readonlyField(`${Math.abs(polygonArea(e.points)).toFixed(2)} m²`)));
        d.append(row('Périmètre', readonlyField(formatLength(polygonPerimeter(e.points), u, true))));
        break;
      }
      case 'stair': {
        const n = stairRisers(e.height, e.maxRiser);
        this.header(root, 'Escalier', `${n} contremarches`);
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau de base', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Hauteur à franchir', L(e.height, (m) => (e.height = m), 0.2)));
        const d = this.section(root, 'Cotes');
        d.append(row('Largeur', L(e.width, (m) => (e.width = m), 0.5)));
        d.append(row('Hauteur max. de marche', L(e.maxRiser, (m) => (e.maxRiser = m), 0.1)));
        d.append(row('Nombre de contremarches', readonlyField(String(n))));
        d.append(row('Hauteur de marche', readonlyField(formatLength(e.height / n, u, true))));
        d.append(row('Giron', readonlyField(formatLength(dist(e.a, e.b) / n, u, true))));
        const g = (2 * e.height) / n + dist(e.a, e.b) / n;
        d.append(row('Blondel (2h+g)', readonlyField(`${formatLength(g, u, true)} ${g >= 0.6 && g <= 0.64 ? '✓' : '⚠'}`), 'Formule de Blondel : 60 à 64 cm'));
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'dimension': {
        this.header(root, 'Cote', formatLength(dist(e.a, e.b), u, true));
        const d = this.section(root, 'Cotes');
        d.append(row('Valeur', readonlyField(formatLength(dist(e.a, e.b), u, true))));
        d.append(row('Décalage', L(e.offset, (m) => (e.offset = m))));
        break;
      }
      case 'grid': {
        this.header(root, 'Quadrillage', e.label);
        const d = this.section(root, 'Données d’identification');
        d.append(row('Nom', textField(e.label, (val) => this.edit('Nom du quadrillage', () => (e.label = val)))));
        break;
      }
      case 'opening': {
        const host = p.get<'wall'>(e.hostId);
        this.header(root, 'Ouverture', `${formatLength(e.width, u)} × ${formatLength(e.height, u)} ${u}`);
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', readonlyField(host ? p.level(host.levelId)?.name ?? '' : '')));
        c.append(row('Distance depuis l’origine du mur', L(e.offset - e.width / 2, (m) => (e.offset = m + e.width / 2), 0)));
        c.append(row('Allège', L(e.sill, (m) => (e.sill = m), 0)));
        const d = this.section(root, 'Cotes');
        d.append(row('Largeur', L(e.width, (m) => (e.width = m), 0.05)));
        d.append(row('Hauteur', L(e.height, (m) => (e.height = m), 0.05)));
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'shaft': {
        this.header(root, 'Trémie', `${Math.abs(polygonArea(e.points)).toFixed(2)} m²`);
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau de base', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Hauteur', L(e.height, (m) => (e.height = m), 0)));
        c.append(h('div', { class: 'prop-empty' }, 'Perce les sols dont le dessus est compris entre la base et la hauteur.'));
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'ceiling': {
        this.header(root, 'Faux-plafond', `${Math.abs(polygonArea(e.points)).toFixed(2)} m²`);
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Hauteur sous plafond', L(e.height, (m) => (e.height = m), 0.5)));
        c.append(row('Épaisseur', L(e.thickness, (m) => (e.thickness = m), 0.005)));
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'railing': {
        let length = 0;
        for (let i = 0; i < e.points.length - 1; i++) length += dist(e.points[i], e.points[i + 1]);
        this.header(root, 'Garde-corps', formatLength(length, u, true));
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Décalage de la base', L(e.baseOffset, (m) => (e.baseOffset = m))));
        c.append(row('Hauteur', L(e.height, (m) => (e.height = m), 0.3)));
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'component': {
        const fam = p.family(e.family);
        const type = fam?.types.find((t) => t.id === e.typeId) ?? fam?.types[0];
        const g = p.componentGeometry(e);
        this.header(root, fam?.name ?? 'Famille manquante', type?.name);
        root.append(
          h('div', { class: 'type-selector' },
            selectField(e.family, p.families.map((f) => ({ value: f.id, label: `${f.category} — ${f.name}` })), (val) =>
              this.edit('Changer de famille', () => {
                e.family = val;
                e.typeId = p.family(val)?.types[0]?.id;
                e.params = undefined;
              }),
            ),
            fam ? selectField(type?.id ?? '', fam.types.map((t) => ({ value: t.id, label: t.name })), (val) => this.edit('Changer de type', () => (e.typeId = val))) : null,
            h('button', { class: 'btn small block', onclick: () => familyEditor(this.app, e.family) }, 'Modifier la famille…'),
          ),
        );
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Décalage', L(e.offset ?? 0, (m) => (e.offset = m))));
        c.append(row('Rotation', numberField(e.rotation, (val) => this.edit('Rotation', () => (e.rotation = val)), { step: 15, suffix: '°' })));
        if (fam) {
          const inst = fam.params.filter((q) => q.scope === 'instance' && !q.formula);
          if (inst.length) {
            const s = this.section(root, 'Paramètres d’occurrence');
            for (const q of inst) {
              s.append(row(q.name, paramField(q.kind, e.params?.[q.name] ?? g.values[q.name] ?? q.value, u, (v) => this.edit(q.name, () => (e.params = { ...(e.params ?? {}), [q.name]: v })))));
            }
          }
          const typeParams = fam.params.filter((q) => q.scope === 'type' && !q.formula);
          if (typeParams.length && type) {
            const s = this.section(root, `Paramètres de type — ${type.name} (toutes les occurrences)`);
            for (const q of typeParams) {
              s.append(row(q.name, paramField(q.kind, type.values[q.name] ?? q.value, u, (v) => this.edit(q.name, () => (type.values[q.name] = v)))));
            }
          }
          const computed = fam.params.filter((q) => q.formula);
          if (computed.length) {
            const s = this.section(root, 'Valeurs calculées (formules)');
            for (const q of computed) s.append(row(q.name, readonlyField(formatParam(q.kind, g.values[q.name], u)), q.formula));
          }
        }
        const b = g.bounds;
        this.section(root, 'Encombrement').append(row('Dimensions', readonlyField(`${formatLength(b.x1 - b.x0, u)} × ${formatLength(b.y1 - b.y0, u)} ${u}`)));
        if (g.errors.length) root.append(h('div', { class: 'fe-errors' }, ...g.errors.slice(0, 4).map((x) => h('div', {}, `⚠ ${x}`))));
        common(this.section(root, 'Données d’identification'));
        break;
      }
      case 'text': {
        this.header(root, 'Texte', e.text.slice(0, 40));
        const c = this.section(root, 'Texte');
        c.append(row('Contenu', textField(e.text, (val) => this.edit('Texte', () => (e.text = val || e.text)))));
        c.append(row('Taille (mm papier)', numberField(e.size, (val) => this.edit('Taille', () => (e.size = val)), { min: 1, max: 30, step: 0.5, suffix: 'mm' })));
        c.append(row('Rotation', numberField(e.rotation, (val) => this.edit('Rotation', () => (e.rotation = val)), { step: 15, suffix: '°' })));
        break;
      }
      case 'cad': {
        this.header(root, 'Import CAO', e.name);
        const c = this.section(root, 'Fond de plan');
        c.append(row('Nom', textField(e.name, (val) => this.edit('Nom', () => (e.name = val || e.name)))));
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Segments', readonlyField((e.lines.length / 4).toLocaleString('fr-FR'))));
        c.append(row('Couleur', colorField(e.color, (val) => this.edit('Couleur', () => (e.color = val)))));
        c.append(row('Rotation', numberField(e.rotation, (val) => this.edit('Rotation', () => (e.rotation = val)), { step: 1, suffix: '°' })));
        c.append(h('div', { class: 'prop-empty' }, 'Astuce : épinglez le fond de plan (PN) une fois calé, puis redessinez les murs en vous accrochant à ses lignes.'));
        break;
      }
      case 'detail': {
        this.header(root, 'Ligne de détail', formatLength(dist(e.a, e.b), u, true));
        const c = this.section(root, 'Graphismes');
        c.append(row('Style', selectField(e.style, Object.entries(LINE_STYLES).map(([value, st]) => ({ value: value as LineStyle, label: st.label })), (val) => this.edit('Style de ligne', () => (e.style = val)))));
        c.append(row('Longueur', readonlyField(formatLength(dist(e.a, e.b), u, true))));
        break;
      }
      case 'region': {
        this.header(root, 'Zone remplie', `${Math.abs(polygonArea(e.points)).toFixed(2)} m²`);
        const c = this.section(root, 'Graphismes');
        c.append(row('Motif', selectField(e.pattern, REGION_PATTERNS, (val) => this.edit('Motif', () => (e.pattern = val)))));
        c.append(row('Couleur', colorField(e.color, (val) => this.edit('Couleur', () => (e.color = val)))));
        c.append(row('Contour', checkField(e.border, (val) => this.edit('Contour', () => (e.border = val)))));
        c.append(row('Surface', readonlyField(`${Math.abs(polygonArea(e.points)).toFixed(2)} m²`)));
        break;
      }
      case 'section': {
        this.header(root, 'Coupe', e.name);
        const c = this.section(root, 'Données d’identification');
        c.append(row('Nom', textField(e.name, (val) => this.edit('Nom de la coupe', () => (e.name = val || e.name)))));
        c.append(row('Profondeur de vue', L(e.depth, (m) => (e.depth = m), 0.5)));
        c.append(row('Inverser la visée', checkField(e.flip, (val) => this.edit('Inverser la coupe', () => (e.flip = val)))));
        root.append(h('button', { class: 'btn primary block', onclick: () => this.app.setView({ kind: 'section', sectionId: e.id }) }, 'Ouvrir la vue en coupe'));
        break;
      }
    }
    root.append(h('button', { class: 'btn danger block', onclick: () => this.app.deleteSelection() }, 'Supprimer'));
  }

  private typeSelector(current: Id, types: { id: Id; name: string }[], set: (id: Id) => void): HTMLElement {
    return h(
      'div',
      { class: 'type-selector' },
      selectField(current, types.map((t) => ({ value: t.id, label: t.name })), (val) => this.edit('Changer de type', () => set(val))),
    );
  }

  /** Paramètres de type : ils s'appliquent à toutes les occurrences du type. */
  private typeSection(root: HTMLElement, kind: 'wall' | 'door' | 'window', typeId: Id): void {
    const p = this.app.project;
    const u = p.data.units;
    const s = this.section(root, 'Paramètres de type (toutes les occurrences)');
    const L = (v: number, set: (m: number) => void, min?: number) => lengthField(v, u, (m) => this.edit('Modifier le type', () => set(m)), { min });
    if (kind === 'wall') {
      const t = p.wallType(typeId);
      s.append(row('Nom du type', textField(t.name, (v) => this.edit('Renommer le type', () => (t.name = v || t.name)))));
      s.append(row('Épaisseur', t.layers?.length ? readonlyField(formatLength(t.thickness, u, true)) : L(t.thickness, (m) => (t.thickness = m), 0.01)));
      s.append(row('Fonction', selectField(t.function, [{ value: 'exterior', label: 'Extérieur' }, { value: 'interior', label: 'Intérieur' }], (v) => this.edit('Fonction', () => (t.function = v)))));
      s.append(row('Couleur', colorField(t.color, (v) => this.edit('Couleur', () => (t.color = v)))));
      s.append(row('Structure', h('button', { class: 'btn small', onclick: () => wallLayersDialog(this.app, t.id) }, t.layers?.length ? `${t.layers.length} couches — modifier…` : 'Modifier…')));
      s.append(row('Famille', selectField(t.family ?? 'basic', [{ value: 'basic', label: 'Mur de base' }, { value: 'curtain', label: 'Mur-rideau' }], (v) => this.edit('Famille de mur', () => (t.family = v)))));
      if (t.family === 'curtain') {
        s.append(row('Espacement des meneaux', L(t.curtainSpacing ?? 1.5, (m) => (t.curtainSpacing = m), 0.3)));
        s.append(row('Espacement des traverses', L(t.curtainRowSpacing ?? 1.5, (m) => (t.curtainRowSpacing = m), 0.3)));
      }
    } else if (kind === 'door') {
      const t = p.doorType(typeId);
      s.append(row('Nom du type', textField(t.name, (v) => this.edit('Renommer le type', () => (t.name = v || t.name)))));
      s.append(row('Largeur', L(t.width, (m) => (t.width = m), 0.3)));
      s.append(row('Hauteur', L(t.height, (m) => (t.height = m), 0.5)));
      s.append(row('Couleur', colorField(t.color, (v) => this.edit('Couleur', () => (t.color = v)))));
    } else {
      const t = p.windowType(typeId);
      s.append(row('Nom du type', textField(t.name, (v) => this.edit('Renommer le type', () => (t.name = v || t.name)))));
      s.append(row('Largeur', L(t.width, (m) => (t.width = m), 0.2)));
      s.append(row('Hauteur', L(t.height, (m) => (t.height = m), 0.2)));
      s.append(row('Allège par défaut', L(t.sill, (m) => (t.sill = m), 0)));
      s.append(row('Couleur du cadre', colorField(t.color, (v) => this.edit('Couleur', () => (t.color = v)))));
    }
  }
}
