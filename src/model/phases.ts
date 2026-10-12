// Phases (existant / démolition / neuf) : statut d'un élément dans une phase
// donnée et rendu selon le filtre de phase de la vue.
import type { Project } from './project';
import type { Element, Id, Phase, PhaseFilter, ViewSettings } from './types';

export type PhaseStatus = 'existing' | 'demolished' | 'new' | 'future' | 'gone';
export type PhaseDisplay = 'normal' | 'existing' | 'demolished' | 'new' | 'hidden';

export const DEFAULT_PHASES: Phase[] = [
  { id: 'ph-existing', name: 'Existant' },
  { id: 'ph-new', name: 'Nouvelle construction' },
];

export const PHASE_FILTERS: { value: PhaseFilter; label: string }[] = [
  { value: 'complete', label: 'Afficher complet' },
  { value: 'all', label: 'Afficher tout (existant / démoli / neuf)' },
  { value: 'proposed', label: 'État projeté (précédent + nouveau)' },
  { value: 'demolition', label: 'Démolitions (précédent + démoli)' },
  { value: 'existing', label: 'État existant' },
  { value: 'new', label: 'Nouveau uniquement' },
];

/** Catégories soumises aux phases (les annotations ne le sont pas). */
const PHASED = new Set<Element['kind']>(['wall', 'door', 'window', 'opening', 'floor', 'roof', 'column', 'stair', 'railing', 'component', 'ceiling', 'shaft', 'room']);

export function isPhased(e: Element): boolean {
  return PHASED.has(e.kind);
}

export function phaseIndex(p: Project, id: Id | null | undefined): number {
  const phases = p.phases;
  if (!id) return -1;
  return phases.findIndex((ph) => ph.id === id);
}

/** Statut d'un élément vu depuis une phase. */
export function phaseStatus(p: Project, e: Element, phaseId: Id): PhaseStatus {
  const view = phaseIndex(p, phaseId);
  const created = Math.max(0, phaseIndex(p, e.phaseCreated ?? p.phases[0]?.id));
  const demolished = e.phaseDemolished ? phaseIndex(p, e.phaseDemolished) : -1;
  if (created > view) return 'future';
  if (demolished >= 0 && demolished < view) return 'gone';
  if (demolished === view) return 'demolished';
  return created === view ? 'new' : 'existing';
}

export function phaseDisplay(status: PhaseStatus, filter: PhaseFilter): PhaseDisplay {
  if (status === 'future' || status === 'gone') return 'hidden';
  switch (filter) {
    case 'complete':
      return 'normal';
    case 'all':
      return status;
    case 'proposed':
      return status === 'demolished' ? 'hidden' : status === 'existing' ? 'existing' : 'normal';
    case 'demolition':
      return status === 'new' ? 'hidden' : status === 'demolished' ? 'demolished' : 'existing';
    case 'existing':
      return status === 'new' ? 'hidden' : 'normal';
    case 'new':
      return status === 'new' ? 'normal' : 'hidden';
  }
}

/** Phase et filtre effectifs d'une vue. */
export function viewPhase(p: Project, settings: ViewSettings | undefined): { phase: Id; filter: PhaseFilter } {
  const phases = p.phases;
  const phase = settings?.phase && phases.some((ph) => ph.id === settings.phase) ? settings.phase : phases[phases.length - 1].id;
  return { phase, filter: settings?.phaseFilter ?? 'complete' };
}

/** Rendu d'un élément dans une vue (phases appliquées). */
export function elementDisplay(p: Project, e: Element, settings: ViewSettings | undefined): PhaseDisplay {
  if (!isPhased(e)) return 'normal';
  const { phase, filter } = viewPhase(p, settings);
  return phaseDisplay(phaseStatus(p, e, phase), filter);
}

/** Couleurs de remplacement des éléments selon leur statut (convention française). */
export const PHASE_COLORS: Record<'existing' | 'demolished' | 'new', { stroke: string; fill: string; solid: string }> = {
  existing: { stroke: '#7d838a', fill: '#d9dcdf', solid: '#c4c8cc' },
  demolished: { stroke: '#c79a00', fill: 'rgba(242,194,0,0.35)', solid: '#f2c200' },
  new: { stroke: '#c62828', fill: 'rgba(229,57,53,0.30)', solid: '#e57373' },
};
