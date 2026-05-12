import { ProjectStatus } from '../db/repositories/projectRepository';

export type TransitionResult =
  | { ok: true; next: ProjectStatus }
  | { ok: false; reason: string };

const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  CREATED:            ['HEARING'],
  HEARING:            ['REQUIREMENTS'],
  REQUIREMENTS:       ['BASIC_DESIGN'],
  BASIC_DESIGN:       ['DETAILED_DESIGN'],
  DETAILED_DESIGN:    ['IMPLEMENTATION'],
  IMPLEMENTATION:     ['TESTING'],
  TESTING:            ['REVIEW'],
  REVIEW:             ['WAITING_APPROVAL'],
  WAITING_APPROVAL:   ['COMPLETED', 'REVISION_REQUESTED'],
  REVISION_REQUESTED: ['REQUIREMENTS'],
  COMPLETED:          ['REVISION_REQUESTED'],
  STOPPED:            [],
  FAILED:             [],
};

const STOPPABLE = new Set<ProjectStatus>([
  'HEARING', 'REQUIREMENTS', 'BASIC_DESIGN', 'DETAILED_DESIGN',
  'IMPLEMENTATION', 'TESTING', 'REVIEW', 'WAITING_APPROVAL',
  'REVISION_REQUESTED',
]);

const RESUMABLE = new Set<ProjectStatus>(['STOPPED']);

const NON_RESUMABLE_PREVIOUS = new Set<ProjectStatus>([
  'WAITING_APPROVAL', 'COMPLETED', 'FAILED',
]);

export class StateMachine {
  canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  transition(from: ProjectStatus, to: ProjectStatus): TransitionResult {
    if (!this.canTransition(from, to)) {
      return { ok: false, reason: `Cannot transition from ${from} to ${to}` };
    }
    return { ok: true, next: to };
  }

  canStop(current: ProjectStatus): boolean {
    return STOPPABLE.has(current);
  }

  canResume(current: ProjectStatus, previousStatus?: string | null): boolean {
    if (!RESUMABLE.has(current)) return false;
    if (!previousStatus) return false;
    if (NON_RESUMABLE_PREVIOUS.has(previousStatus as ProjectStatus)) return false;
    return true;
  }

  phaseFromStatus(status: ProjectStatus): string | null {
    const map: Partial<Record<ProjectStatus, string>> = {
      REQUIREMENTS:    'requirements',
      BASIC_DESIGN:    'basic_design',
      DETAILED_DESIGN: 'detailed_design',
      IMPLEMENTATION:  'implementation',
      TESTING:         'testing',
      REVIEW:          'review',
    };
    return map[status] ?? null;
  }

  getPipelineStatuses(): ProjectStatus[] {
    return [
      'REQUIREMENTS', 'BASIC_DESIGN', 'DETAILED_DESIGN',
      'IMPLEMENTATION', 'TESTING', 'REVIEW', 'WAITING_APPROVAL',
    ];
  }
}
