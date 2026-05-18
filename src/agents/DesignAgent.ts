import { Agent, AgentResult, AgentContext, ArchitectureContext } from './Agent';
import { generateBasicDesign, generateDetailedDesign } from '../documents/documentGenerator';
import { AiClient } from '../ai/aiClient';
import { withPhasedPreamble, withLessonsContext, withRevisionContext } from './phasedPreamble';

const BASE_BASIC_SYSTEM_PROMPT = `あなたはソフトウェアアーキテクトです。
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

const BASE_DETAILED_SYSTEM_PROMPT = `あなたはシニアソフトウェアエンジニアです。
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

const BASIC_SYSTEM_PROMPT = withPhasedPreamble(BASE_BASIC_SYSTEM_PROMPT, '基本設計（アーキテクト）');
const DETAILED_SYSTEM_PROMPT = withPhasedPreamble(BASE_DETAILED_SYSTEM_PROMPT, '詳細設計（実装準備）');

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
        let basePrompt: string;

        if (isBasic) {
          const reqDoc = getPreviousDoc(context.previousResults ?? [], 'requirements');
          basePrompt = reqDoc
            ? `プロジェクト名: ${context.project.name}\n\n# 要件定義書\n${reqDoc}`
            : `プロジェクト名: ${context.project.name}\n技術スタック: ${context.hearingAnswers?.techStack ?? '未定'}`;
        } else {
          // Pattern 3 – prefer explicit architectureContext over doc search
          const archCtx = context.architectureContext;
          const basicDoc = archCtx?.decisions
            || getPreviousDoc(context.previousResults ?? [], 'basic-design');
          basePrompt = basicDoc
            ? `プロジェクト名: ${context.project.name}\n\n# 基本設計書・アーキテクチャ決定\n${basicDoc}`
            : `プロジェクト名: ${context.project.name}`;
        }

        const withRevision = withRevisionContext(basePrompt, context.revisionContent);
        const userPrompt = withLessonsContext(withRevision, context.lessonsLearned ?? []);
        const content = await this.aiClient.generate(systemPrompt, userPrompt);
        const filePath = isBasic ? 'docs/basic-design.md' : 'docs/detailed-design.md';

        // Pattern 3 – build ArchitectureContext from basic design output
        const architectureContext: ArchitectureContext | undefined = isBasic ? {
          decisions: content,
          techStack: context.hearingAnswers?.techStack ?? '未定',
        } : undefined;

        return {
          ok: true,
          summary: `${isBasic ? '基本設計書' : '詳細設計書'}をAIで作成しました`,
          files: [{ path: filePath, content }],
          data: architectureContext ? { architectureContext } : undefined,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: '設計書の生成に失敗しました', error: msg };
      }
    }

    const doc = isBasic
      ? generateBasicDesign(context.hearingAnswers, context.project.name)
      : generateDetailedDesign(context.hearingAnswers, context.project.name);

    // Issue 4 fix: mock時も architectureContext を data に乗せる
    const mockArchCtx: ArchitectureContext | undefined = isBasic ? {
      decisions: doc.content,
      techStack: context.hearingAnswers?.techStack ?? '未定',
    } : undefined;

    return {
      ok: true,
      summary: `${isBasic ? '基本設計書' : '詳細設計書'}を作成しました`,
      files: [doc],
      data: mockArchCtx ? { architectureContext: mockArchCtx } : undefined,
    };
  }
}
