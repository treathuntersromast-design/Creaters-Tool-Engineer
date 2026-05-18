import { Agent, AgentResult, AgentContext } from './Agent';
import { AiClient } from '../ai/aiClient';
import { withPhasedPreamble, withLessonsContext, withRevisionContext } from './phasedPreamble';

/**
 * Pattern 2 – Outcomes Loop scoring rubric (0-100).
 * Score < 80 triggers automatic retry of the implementation phase.
 */
const SCORE_RUBRIC = `
## 品質スコア採点基準（0〜100点）

以下の5項目を各20点満点で採点し、合計点をSCORE行に出力してください。

1. 要件充足度（0-20）: 要件定義書の要件を満たしているか
2. 設計整合性（0-20）: 設計書と実装が一致しているか
3. コード品質（0-20）: TypeScript型安全性・命名規則・構造
4. テストカバレッジ（0-20）: テストが主要ロジックをカバーしているか
5. セキュリティ（0-20）: SQLインジェクション・XSS等のリスクがないか

レポートの末尾に必ず以下の形式で出力すること:
SCORE: <合計点数>
RETRY_NEEDED: <true/false>  ← スコアが80未満なら true
`;

const BASE_SYSTEM_PROMPT = `あなたはシニアソフトウェアエンジニアのコードレビュアーです。
生成された設計書・実装コード・テストを総合的にレビューし、改善点をレポートしてください。

レビューレポートの形式:
# レビューレポート

## 総合評価
（A〜Dで評価し、理由を記述）

## 良い点
- 箇条書きで

## 改善点・懸念事項
- 箇条書きで優先度高い順に

## セキュリティ観点
- セキュリティリスクや対策

## 次のステップ
- 推奨アクションを箇条書きで

${SCORE_RUBRIC}

日本語で記述すること。`;

const SYSTEM_PROMPT = withPhasedPreamble(BASE_SYSTEM_PROMPT, 'コードレビュー');

/** Extracts numeric score from AI-generated review text */
function extractScore(content: string): number | undefined {
  const match = content.match(/SCORE:\s*(\d+)/i);
  if (!match) return undefined;
  const score = parseInt(match[1], 10);
  return Number.isNaN(score) ? undefined : Math.min(100, Math.max(0, score));
}

/**
 * Issue 8 fix: コンテンツベースのヒューリスティックスコア（モック時）。
 * ファイル数だけでなく、設計書・テストコード・実装コードの有無で採点。
 */
function mockScore(results: AgentResult[]): number {
  const files = results.flatMap((r) => r.files ?? []);
  let score = 0;

  // 要件定義・設計書の有無（各10点）
  if (files.some((f) => f.path.includes('requirements'))) score += 10;
  if (files.some((f) => f.path.includes('basic-design')))  score += 10;
  if (files.some((f) => f.path.includes('detailed-design'))) score += 10;

  // 実装コードの有無・内容（30点）
  const implFiles = files.filter((f) => f.path.startsWith('src/'));
  if (implFiles.length > 0) score += 15;
  if (implFiles.some((f) => f.content.length > 200)) score += 15;

  // テストの有無・内容（30点）
  const testFiles = files.filter((f) => f.path.startsWith('tests/') || f.path.includes('.test.'));
  if (testFiles.length > 0) score += 15;
  if (testFiles.some((f) => /describe|it\(|test\(/.test(f.content))) score += 15;

  // テスト結果レポートの有無（10点）
  if (files.some((f) => f.path.includes('test-result'))) score += 10;

  return Math.min(100, score);
}

export class ReviewAgent implements Agent {
  readonly name = 'ReviewAgent';
  readonly role = 'review';

  constructor(private readonly aiClient?: AiClient) {}

  async run(context: AgentContext): Promise<AgentResult> {
    if (this.aiClient) {
      try {
        const allFiles = (context.previousResults ?? [])
          .flatMap((r) => r.files ?? [])
          .map((f) => `---FILE: ${f.path}---\n${f.content}`)
          .join('\n\n');

        const retryNote = context.retryCount && context.retryCount > 0
          ? `\n⚠️ これは再試行 #${context.retryCount} 後のレビューです。前回より厳密に採点してください。`
          : '';

        const basePrompt = [
          `プロジェクト名: ${context.project.name}`,
          `技術スタック: ${context.hearingAnswers?.techStack ?? '未定'}`,
          retryNote,
          '',
          allFiles ? `## 生成されたファイル一覧\n${allFiles}` : 'ファイルなし',
        ].filter(Boolean).join('\n');

        const withRevision = withRevisionContext(basePrompt, context.revisionContent);
        const userPrompt = withLessonsContext(withRevision, context.lessonsLearned ?? []);
        const content = await this.aiClient.generate(SYSTEM_PROMPT, userPrompt);
        const score = extractScore(content);

        return {
          ok: true,
          summary: 'AIによるコードレビューが完了しました',
          files: [{ path: 'logs/review-report.md', content }],
          data: { review: content, score },
          score,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: 'レビューの生成に失敗しました', error: msg };
      }
    }

    const score = mockScore(context.previousResults ?? []);

    const summary = [
      `## レビュー完了: ${context.project.name}`,
      '',
      '### 確認項目',
      '- [x] 要件定義書: 作成済み',
      '- [x] 基本設計書: 作成済み',
      '- [x] 詳細設計書: 作成済み',
      '- [x] 実装（モック）: 完了',
      '- [x] テスト: 完了',
      '',
      '### 所見',
      '全フェーズが正常に完了しました。ユーザー承認をお待ちしています。',
      '',
      `SCORE: ${score}`,
      `RETRY_NEEDED: ${score < 80}`,
    ].join('\n');

    return {
      ok: true,
      summary: 'レビューが完了しました',
      score,
      data: { review: summary, score },
    };
  }
}
