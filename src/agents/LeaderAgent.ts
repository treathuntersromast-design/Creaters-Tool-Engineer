import { Agent, AgentResult, AgentContext } from './Agent';
import { HEARING_QUESTIONS } from '../hearing/hearingQuestions';
import { parseHearingReply } from '../hearing/hearingParser';
import { LessonLearned } from '../db/repositories/lessonsLearnedRepository';

/**
 * Pattern 4 – Memory + Dreaming
 *
 * LeaderAgent injects past lessons into its coordination summary so downstream
 * agents (via context.lessonsLearned) can avoid known failure patterns.
 *
 * "Dreaming" = synthesizing lessons from multiple projects into a coherent
 * heuristic that shapes the entire pipeline's approach.
 */
function buildDreamingSummary(lessons: LessonLearned[]): string {
  if (lessons.length === 0) return '';

  const failures = lessons.filter((l) => l.lessonType === 'failure');
  const patterns = lessons.filter((l) => l.lessonType === 'pattern' || l.lessonType === 'success');
  const retries = lessons.filter((l) => l.lessonType === 'retry');

  const lines: string[] = ['【過去プロジェクトからの洞察（Dreaming）】'];

  if (patterns.length > 0) {
    lines.push('✅ 成功パターン:');
    patterns.slice(0, 3).forEach((l) => lines.push(`  - [${l.phase}] ${l.content}`));
  }
  if (failures.length > 0) {
    lines.push('⚠️ 過去の失敗パターン（回避すること）:');
    failures.slice(0, 3).forEach((l) => lines.push(`  - [${l.phase}] ${l.content}`));
  }
  if (retries.length > 0) {
    lines.push(`🔄 再試行が必要だったケース: ${retries.length}件`);
  }

  return lines.join('\n');
}

export class LeaderAgent implements Agent {
  readonly name = 'LeaderAgent';
  readonly role = 'leader';

  getHearingQuestions(): string {
    return HEARING_QUESTIONS;
  }

  parseHearingReply(text: string): ReturnType<typeof parseHearingReply> {
    return parseHearingReply(text);
  }

  /**
   * Pattern 4 – builds the LINE message sent at project start with lessons injected.
   * Pattern 5 – includes a brief phased plan in the kickoff message.
   */
  buildKickoffMessage(projectName: string, lessons: LessonLearned[]): string {
    const dreamingNote = buildDreamingSummary(lessons);
    return [
      `🚀 ${projectName} の開発を開始します。`,
      '',
      '【実行計画（Phased Preamble）】',
      'フェーズ1: 要件定義（ヒアリング内容を整理）',
      'フェーズ2: 基本設計 → 詳細設計（アーキテクト担当）',
      'フェーズ3: 実装（インプリメンター担当）+ テスト並列実行',
      'フェーズ4: コードレビュー → 品質スコア評価 → 必要なら再試行',
      '',
      dreamingNote,
    ].filter(Boolean).join('\n');
  }

  async run(context: AgentContext): Promise<AgentResult> {
    const answers = context.hearingAnswers;
    const lessons = context.lessonsLearned ?? [];
    const dreamingSummary = buildDreamingSummary(lessons);

    return {
      ok: true,
      summary: [
        'LeaderAgent: ヒアリング完了。要件定義フェーズへ移行します。',
        dreamingSummary,
      ].filter(Boolean).join('\n'),
      data: { answers, lessonsApplied: lessons.length },
    };
  }
}
