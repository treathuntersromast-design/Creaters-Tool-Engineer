import { Agent, AgentResult, AgentContext } from './Agent';
import { generateBasicDesign, generateDetailedDesign } from '../documents/documentGenerator';
import { AiClient } from '../ai/aiClient';

const BASIC_SYSTEM_PROMPT = `あなたはソフトウェアアーキテクトです。
要件定義書を元に、基本設計書をMarkdown形式で日本語作成してください。

以下のセクションを必ず含めること:
# 基本設計書
## 1. システム概要
## 2. アーキテクチャ設計（図示またはテキストで）
## 3. 主要コンポーネントと責務
## 4. データモデル概要
## 5. API設計概要（エンドポイント一覧）
## 6. 画面構成
## 7. 外部連携
## 8. セキュリティ方針
## 9. 技術スタック詳細

具体的なコンポーネント名・インターフェース・データ型を含めること。`;

const DETAILED_SYSTEM_PROMPT = `あなたはシニアソフトウェアエンジニアです。
基本設計書を元に、詳細設計書をMarkdown形式で日本語作成してください。

以下のセクションを必ず含めること:
# 詳細設計書
## 1. ディレクトリ構成
## 2. モジュール・クラス設計（主要クラスのメソッド一覧）
## 3. API仕様（リクエスト/レスポンス形式）
## 4. DB設計（テーブル定義・インデックス）
## 5. シーケンス図（主要フロー）
## 6. エラーハンドリング方針
## 7. テスト方針

実装に直結するレベルの具体性で記述すること。`;

function getPreviousDoc(previousResults: AgentResult[], phase: string): string {
  const result = previousResults.find((r) => r.files?.some((f) => f.path.includes(phase)));
  return result?.files?.find((f) => f.path.includes(phase))?.content ?? '';
}

export class DesignAgent implements Agent {
  readonly name: string;
  readonly role: string;

  constructor(
    mode: 'basic_design' | 'detailed_design',
    private readonly aiClient?: AiClient,
  ) {
    this.role = mode;
    this.name = mode === 'basic_design' ? 'BasicDesignAgent' : 'DetailedDesignAgent';
  }

  async run(context: AgentContext): Promise<AgentResult> {
    if (!context.hearingAnswers) {
      return { ok: false, summary: 'ヒアリング回答がありません', error: 'No hearing answers' };
    }

    const isBasic = this.role === 'basic_design';

    if (this.aiClient) {
      try {
        const systemPrompt = isBasic ? BASIC_SYSTEM_PROMPT : DETAILED_SYSTEM_PROMPT;
        let userPrompt: string;

        if (isBasic) {
          const reqDoc = getPreviousDoc(context.previousResults ?? [], 'requirements');
          userPrompt = reqDoc
            ? `プロジェクト名: ${context.project.name}\n\n# 要件定義書\n${reqDoc}`
            : `プロジェクト名: ${context.project.name}\n技術スタック: ${context.hearingAnswers?.techStack ?? '未定'}`;
        } else {
          const basicDoc = getPreviousDoc(context.previousResults ?? [], 'basic-design');
          userPrompt = basicDoc
            ? `プロジェクト名: ${context.project.name}\n\n# 基本設計書\n${basicDoc}`
            : `プロジェクト名: ${context.project.name}`;
        }

        const content = await this.aiClient.generate(systemPrompt, userPrompt);
        const filePath = isBasic ? 'docs/basic-design.md' : 'docs/detailed-design.md';
        return {
          ok: true,
          summary: `${isBasic ? '基本設計書' : '詳細設計書'}をAIで作成しました`,
          files: [{ path: filePath, content }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: '設計書の生成に失敗しました', error: msg };
      }
    }

    const doc = isBasic
      ? generateBasicDesign(context.hearingAnswers, context.project.name)
      : generateDetailedDesign(context.hearingAnswers, context.project.name);

    return {
      ok: true,
      summary: `${isBasic ? '基本設計書' : '詳細設計書'}を作成しました`,
      files: [doc],
    };
  }
}
