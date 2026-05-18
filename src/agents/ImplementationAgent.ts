import { Agent, AgentResult, AgentContext } from './Agent';
import { CodeExecutor } from '../executors/CodeExecutor';
import { AiClient } from '../ai/aiClient';
import { GeneratedDocument } from '../documents/documentGenerator';
import { withPhasedPreamble, withLessonsContext, withRevisionContext } from './phasedPreamble';

const BASE_SYSTEM_PROMPT = `あなたはプロフェッショナルなTypeScript開発者です。
詳細設計書を元に、TypeScriptのソースコードを生成してください。

出力形式（必ずこの形式で出力すること）:
---FILE: src/index.ts---
<ここにindex.tsのコード>
---FILE: src/app.ts---
<ここにapp.tsのコード>

制約:
- TypeScript strict modeで型エラーのないコード
- 日本語コメントを適切に含める
- 実際に動作するコードを生成すること
- import文は正確に記述すること`;

const SYSTEM_PROMPT = withPhasedPreamble(BASE_SYSTEM_PROMPT, '実装（インプリメンター）');

function parseFiles(raw: string): GeneratedDocument[] {
  const files: GeneratedDocument[] = [];
  const pattern = /---FILE:\s*(.+?)---\n([\s\S]*?)(?=---FILE:|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    if (filePath && content) {
      files.push({ path: filePath, content });
    }
  }

  return files;
}

export class ImplementationAgent implements Agent {
  readonly name = 'ImplementationAgent';
  readonly role = 'implementation';

  constructor(
    private readonly executor: CodeExecutor,
    private readonly aiClient?: AiClient,
  ) {}

  async run(context: AgentContext): Promise<AgentResult> {
    if (this.aiClient) {
      try {
        const detailedDoc = (context.previousResults ?? [])
          .flatMap((r) => r.files ?? [])
          .find((f) => f.path.includes('detailed-design'))?.content ?? '';

        // Pattern 3 – Architect-Implementer Split: use explicit architecture decisions if available
        const archDecisions = context.architectureContext?.decisions ?? '';
        const retryNote = context.retryCount && context.retryCount > 0
          ? `\n⚠️ これは再試行 #${context.retryCount} です。前回の実装の品質スコアが基準未満でした。より完全で堅牢なコードを生成してください。`
          : '';

        const basePrompt = [
          `プロジェクト名: ${context.project.name}`,
          `技術スタック: ${context.hearingAnswers?.techStack ?? 'TypeScript'}`,
          retryNote,
          '',
          archDecisions ? `## アーキテクチャ決定（アーキテクトより）\n${archDecisions}` : '',
          detailedDoc ? `## 詳細設計書\n${detailedDoc}` : '詳細設計書なし',
        ].filter(Boolean).join('\n');

        const withRevision = withRevisionContext(basePrompt, context.revisionContent);
        const userPrompt = withLessonsContext(withRevision, context.lessonsLearned ?? []);

        const raw = await this.aiClient.generate(SYSTEM_PROMPT, userPrompt);
        const files = parseFiles(raw);

        if (files.length === 0) {
          return { ok: false, summary: 'ファイルの解析に失敗しました', error: 'No files parsed from AI response' };
        }

        return {
          ok: true,
          summary: `実装コードをAIで生成しました（${files.length}ファイル）`,
          files,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: '実装コードの生成に失敗しました', error: msg };
      }
    }

    const result = await this.executor.execute({
      description: context.project.name,
      fileName: 'index.ts',
      projectName: context.project.name,
    });

    return {
      ok: result.success,
      summary: result.success ? '実装（モック）が完了しました' : '実装に失敗しました',
      files: result.files,
      data: { logs: result.logs },
      error: result.error,
    };
  }
}
