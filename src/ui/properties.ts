import type { App } from '../app';
import { flipSelectedDoors } from '../commands';
import { polygonArea, polygonPerimeter, stairRisers, wallLength, add, mul, wallDir, dist } from '../model/geometry';
import { formatLength, levelOf } from '../model/project';
import { KIND_LABELS, type Element, type ElementKind, type Id } from '../model/types';
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
      const titles = { '3d': 'Vue 3D', elevation: 'Élévation', schedule: 'Nomenclature' } as const;
      this.header(root, titles[v.kind]);
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
    };

    switch (e.kind) {
      case 'wall': {
        const t = p.wallType(e.typeId);
        this.header(root, 'Mur', t.name);
        root.append(this.typeSelector(e.typeId, p.data.wallTypes, (id) => (e.typeId = id)));
        const c = this.section(root, 'Contraintes');
        c.append(row('Niveau', levelSelect(e.levelId, (id) => (e.levelId = id))));
        c.append(row('Décalage inférieur', L(e.baseOffset, (m) => (e.baseOffset = m))));
        c.append(row('Hauteur non contrainte', L(e.height, (m) => (e.height = m), 0.1)));
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
      s.append(row('Épaisseur', L(t.thickness, (m) => (t.thickness = m), 0.01)));
      s.append(row('Fonction', selectField(t.function, [{ value: 'exterior', label: 'Extérieur' }, { value: 'interior', label: 'Intérieur' }], (v) => this.edit('Fonction', () => (t.function = v)))));
      s.append(row('Couleur', colorField(t.color, (v) => this.edit('Couleur', () => (t.color = v)))));
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
