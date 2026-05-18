import Database from 'better-sqlite3';
import { randomId } from '../../utils/ids';

export type LessonType = 'failure' | 'success' | 'retry' | 'pattern';

export interface LessonLearned {
  id: string;
  projectId: string | null;
  phase: string;
  lessonType: LessonType;
  content: string;
  score: number | null;
  retryCount: number;
  createdAt: string;
}

export class LessonsLearnedRepository {
  constructor(private readonly db: Database.Database) {}

  save(lesson: Omit<LessonLearned, 'id' | 'createdAt'>): LessonLearned {
    const id = randomId(16);
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO lessons_learned (id, projectId, phase, lessonType, content, score, retryCount, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, lesson.projectId ?? null, lesson.phase, lesson.lessonType, lesson.content,
           lesson.score ?? null, lesson.retryCount, createdAt);
    return { ...lesson, id, createdAt };
  }

  /** Returns the most recent N lessons across all projects, optionally filtered by type */
  findRecent(limit = 10, lessonType?: LessonType): LessonLearned[] {
    const rows = lessonType
      ? this.db.prepare(
          `SELECT * FROM lessons_learned WHERE lessonType = ? ORDER BY createdAt DESC LIMIT ?`
        ).all(lessonType, limit)
      : this.db.prepare(
          `SELECT * FROM lessons_learned ORDER BY createdAt DESC LIMIT ?`
        ).all(limit);
    return rows as LessonLearned[];
  }

  /** Returns lessons for a specific phase, most recent first */
  findByPhase(phase: string, limit = 5): LessonLearned[] {
    return this.db.prepare(
      `SELECT * FROM lessons_learned WHERE phase = ? ORDER BY createdAt DESC LIMIT ?`
    ).all(phase, limit) as LessonLearned[];
  }

  findByProjectId(projectId: string): LessonLearned[] {
    return this.db.prepare(
      `SELECT * FROM lessons_learned WHERE projectId = ? ORDER BY createdAt ASC`
    ).all(projectId) as LessonLearned[];
  }
}
