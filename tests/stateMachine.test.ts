import { StateMachine } from '../src/core/stateMachine';
import { ProjectStatus } from '../src/db/repositories/projectRepository';

describe('StateMachine', () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine();
  });

  describe('valid forward transitions', () => {
    const forwardTransitions: [ProjectStatus, ProjectStatus][] = [
      ['CREATED',          'HEARING'],
      ['HEARING',          'REQUIREMENTS'],
      ['REQUIREMENTS',     'BASIC_DESIGN'],
      ['BASIC_DESIGN',     'DETAILED_DESIGN'],
      ['DETAILED_DESIGN',  'IMPLEMENTATION'],
      ['IMPLEMENTATION',   'TESTING'],
      ['TESTING',          'REVIEW'],
      ['REVIEW',           'WAITING_APPROVAL'],
      ['WAITING_APPROVAL', 'COMPLETED'],
      ['WAITING_APPROVAL', 'REVISION_REQUESTED'],
      ['COMPLETED',        'REVISION_REQUESTED'],
      ['REVISION_REQUESTED', 'REQUIREMENTS'],
    ];

    test.each(forwardTransitions)('%s → %s is valid', (from, to) => {
      expect(sm.canTransition(from, to)).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    const invalidTransitions: [ProjectStatus, ProjectStatus][] = [
      ['COMPLETED', 'HEARING'],
      ['COMPLETED', 'CREATED'],
      ['FAILED',    'HEARING'],
      ['FAILED',    'REQUIREMENTS'],
      ['REQUIREMENTS', 'COMPLETED'],
      ['HEARING',   'COMPLETED'],
      ['STOPPED',   'COMPLETED'],
    ];

    test.each(invalidTransitions)('%s → %s is invalid', (from, to) => {
      expect(sm.canTransition(from, to)).toBe(false);
    });
  });

  describe('transition() returns Result type', () => {
    test('returns ok:true for valid transition', () => {
      const result = sm.transition('CREATED', 'HEARING');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.next).toBe('HEARING');
      }
    });

    test('returns ok:false for invalid transition', () => {
      const result = sm.transition('COMPLETED', 'HEARING');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBeTruthy();
      }
    });

    test('does not throw for invalid transition', () => {
      expect(() => sm.transition('FAILED', 'HEARING')).not.toThrow();
    });
  });

  describe('canStop', () => {
    test('returns true for stoppable states', () => {
      const stoppable: ProjectStatus[] = [
        'HEARING', 'REQUIREMENTS', 'BASIC_DESIGN', 'DETAILED_DESIGN',
        'IMPLEMENTATION', 'TESTING', 'REVIEW', 'WAITING_APPROVAL', 'REVISION_REQUESTED'
      ];
      stoppable.forEach((s) => expect(sm.canStop(s)).toBe(true));
    });

    test('returns false for terminal/stopped states', () => {
      const notStoppable: ProjectStatus[] = ['COMPLETED', 'FAILED', 'STOPPED', 'CREATED'];
      notStoppable.forEach((s) => expect(sm.canStop(s)).toBe(false));
    });
  });

  describe('canResume', () => {
    test('can resume from STOPPED with valid previous', () => {
      expect(sm.canResume('STOPPED', 'REQUIREMENTS')).toBe(true);
    });

    test('cannot resume from non-STOPPED state', () => {
      expect(sm.canResume('HEARING', 'REQUIREMENTS')).toBe(false);
    });

    test('cannot resume if previousStatus was WAITING_APPROVAL', () => {
      expect(sm.canResume('STOPPED', 'WAITING_APPROVAL')).toBe(false);
    });

    test('cannot resume if previousStatus was COMPLETED', () => {
      expect(sm.canResume('STOPPED', 'COMPLETED')).toBe(false);
    });

    test('cannot resume if previousStatus is null', () => {
      expect(sm.canResume('STOPPED', null)).toBe(false);
    });
  });

  describe('REVISION_REQUESTED', () => {
    test('can transition from WAITING_APPROVAL to REVISION_REQUESTED', () => {
      expect(sm.canTransition('WAITING_APPROVAL', 'REVISION_REQUESTED')).toBe(true);
    });

    test('can transition from COMPLETED to REVISION_REQUESTED', () => {
      expect(sm.canTransition('COMPLETED', 'REVISION_REQUESTED')).toBe(true);
    });

    test('can transition from REVISION_REQUESTED to REQUIREMENTS', () => {
      expect(sm.canTransition('REVISION_REQUESTED', 'REQUIREMENTS')).toBe(true);
    });
  });
});
