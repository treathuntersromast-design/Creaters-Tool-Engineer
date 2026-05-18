import { Agent, AgentResult, AgentContext } from './Agent';
import { generateRequirements } from '../documents/documentGenerator';
import { AiClient } from '../ai/aiClient';
import { HearingAnswer } from '../db/repositories/hearingAnswerRepository';
import { withPhasedPreamble, withLessonsContext, withRevisionContext } from './phasedPreamble';

const BASE_SYSTEM_PROMPT = `あなたはソフトウェア開発プロジェクトの要件定義専門家です。
ユーザーのヒアリング回答を元に、詳細な要件定義書をMarkdown形式で日本語作成してください。

以下のセクションを必ず含めること:
# 要件定義書
## 1. プロジェクト概要
## 2. 背景と目的
## 3. 想定ユーザー
## 4. 機能要件（具体的なユースケースを箇条書きで）
## 5. 非機能要件（パフォーマンス・セキュリティ・可用性）
## 6. UI/UX要件
## 7. 技術スタック
## 8. 納期・優先順位
## 9. デプロイ先
## 10. テスト範囲
## 11. 制約・リスク

内容は具体的かつ実装可能なレベルで記述すること。`;

const SYSTEM_PROMPT = withPhasedPreamble(BASE_SYSTEM_PROMPT, '要件定義');

function formatAnswers(answers: HearingAnswer, projectName: string): string {
  return `プロジェクト名: ${projectName}

ヒアリング回答:
- 目的: ${answers.purpose ?? '未回答'}
- ターゲットユーザー: ${answers.targetUsers ?? '未回答'}
- 必要機能: ${answers.requiredFeatures ?? '未回答'}
- 画面: ${answers.screens ?? '未回答'}
- 技術スタック: ${answers.techStack ?? '未回答'}
- 優先順位/納期: ${answers.priority ?? '未回答'}
- デプロイ先: ${answers.deployment ?? '未回答'}
- テスト範囲: ${answers.testScope ?? '未回答'}`;
}

export class RequirementAgent implements Agent {
  readonly name = 'RequirementAgent';
  readonly role = 'requirements';

  constructor(private readonly aiClient?: AiClient) {}

  async run(context: AgentContext): Promise<AgentResult> {
    if (!context.hearingAnswers) {
      return { ok: false, summary: 'ヒアリング回答がありません', error: 'No hearing answers' };
    }

    if (this.aiClient) {
      try {
        const basePrompt = formatAnswers(context.hearingAnswers, context.project.name);
        const withRevision = withRevisionContext(basePrompt, context.revisionContent);
        const userPrompt = withLessonsContext(withRevision, context.lessonsLearned ?? []);
        const content = await this.aiClient.generate(SYSTEM_PROMPT, userPrompt);
        return {
          ok: true,
          summary: '要件定義書をAIで作成しました',
          files: [{ path: 'docs/requirements.md', content }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: '要件定義書の生成に失敗しました', error: msg };
      }
    }

    const doc = generateRequirements(context.hearingAnswers, context.project.name);
    return {
      ok: true,
      summary: '要件定義書を作成しました',
      files: [doc],
    };
  }
}
