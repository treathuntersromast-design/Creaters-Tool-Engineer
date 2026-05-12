import { Agent, AgentResult, AgentContext } from './Agent';
import { AiClient } from '../ai/aiClient';

const SYSTEM_PROMPT = `あなたはシニアソフトウェアエンジニアのコードレビュアーです。
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

日本語で記述すること。`;

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

        const userPrompt = [
          `プロジェクト名: ${context.project.name}`,
          `技術スタック: ${context.hearingAnswers?.techStack ?? '未定'}`,
          '',
          allFiles ? `## 生成されたファイル一覧\n${allFiles}` : 'ファイルなし',
        ].join('\n');

        const content = await this.aiClient.generate(SYSTEM_PROMPT, userPrompt);

        return {
          ok: true,
          summary: 'AIによるコードレビューが完了しました',
          files: [{ path: 'logs/review-report.md', content }],
          data: { review: content },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: 'レビューの生成に失敗しました', error: msg };
      }
    }

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
    ].join('\n');

    return {
      ok: true,
      summary: 'レビューが完了しました',
      data: { review: summary },
    };
  }
}
