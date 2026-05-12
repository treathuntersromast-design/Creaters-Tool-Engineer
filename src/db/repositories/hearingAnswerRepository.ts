import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface HearingAnswer {
  id: string;
  projectId: string;
  purpose: string | null;
  targetUsers: string | null;
  requiredFeatures: string | null;
  screens: string | null;
  techStack: string | null;
  priority: string | null;
  deployment: string | null;
  testScope: string | null;
  rawText: string | null;
  updatedAt: string;
}

export type HearingAnswerFields = Omit<HearingAnswer, 'id' | 'projectId' | 'updatedAt'>;

export function getMissingFields(answer: HearingAnswer): string[] {
  const required: (keyof HearingAnswerFields)[] = [
    'purpose', 'targetUsers', 'requiredFeatures', 'screens',
    'techStack', 'priority', 'deployment', 'testScope'
  ];
  return required.filter((k) => !answer[k]);
}

export function isComplete(answer: HearingAnswer): boolean {
  return getMissingFields(answer).length === 0;
}

export class HearingAnswerRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(data: { projectId: string } & Partial<HearingAnswerFields>): HearingAnswer {
    const existing = this.findByProjectId(data.projectId);
    const now = new Date().toISOString();

    if (existing) {
      const fields = [
        'purpose', 'targetUsers', 'requiredFeatures', 'screens',
        'techStack', 'priority', 'deployment', 'testScope', 'rawText'
      ] as const;
      const setClauses = fields
        .filter((f) => data[f] !== undefined)
        .map((f) => `${f} = ?`);
      const values = fields.filter((f) => data[f] !== undefined).map((f) => data[f] ?? null);

      if (setClauses.length > 0) {
        this.db.prepare(`
          UPDATE hearing_answers SET ${setClauses.join(', ')}, updatedAt = ? WHERE projectId = ?
        `).run(...values, now, data.projectId);
      }
      return this.findByProjectId(data.projectId)!;
    } else {
      const id = generateId();
      this.db.prepare(`
        INSERT INTO hearing_answers (id, projectId, purpose, targetUsers, requiredFeatures, screens, techStack, priority, deployment, testScope, rawText, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, data.projectId,
        data.purpose ?? null, data.targetUsers ?? null, data.requiredFeatures ?? null,
        data.screens ?? null, data.techStack ?? null, data.priority ?? null,
        data.deployment ?? null, data.testScope ?? null, data.rawText ?? null, now
      );
      return this.findByProjectId(data.projectId)!;
    }
  }

  findByProjectId(projectId: string): HearingAnswer | undefined {
    return this.db.prepare('SELECT * FROM hearing_answers WHERE projectId = ?').get(projectId) as HearingAnswer | undefined;
  }

  findById(id: string): HearingAnswer | undefined {
    return this.db.prepare('SELECT * FROM hearing_answers WHERE id = ?').get(id) as HearingAnswer | undefined;
  }

  update(projectId: string, data: Partial<HearingAnswerFields>): HearingAnswer {
    return this.upsert({ projectId, ...data });
  }
}
