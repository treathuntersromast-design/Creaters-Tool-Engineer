import { Agent, AgentResult, AgentContext } from './Agent';
import { generateTestResult, generateSampleTest } from '../documents/documentGenerator';
import { AiClient } from '../ai/aiClient';
import { GeneratedDocument } from '../documents/documentGenerator';
import { withPhasedPreamble, withLessonsContext, withRevisionContext } from './phasedPreamble';

const BASE_SYSTEM_PROMPT = `あなたはTypeScriptのテストエンジニアです。
実装コードを元に、Jestを使ったユニットテストを作成してください。

出力形式（必ずこの形式で出力すること）:
---FILE: tests/sample.test.ts---
<ここにテストコード>
---FILE: logs/test-result.md---
<ここにテスト結果レポート（Markdown形式）>

テストコードの制約:
- Jest + TypeScriptで動作するコード
- describe/it/expect を使用
- 主要な関数・クラスのテストを含める
- モックが必要な場合は jest.mock() を使用`;

const SYSTEM_PROMPT = withPhasedPreamble(BASE_SYSTEM_PROMPT, 'テスト実装');

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

export class TestAgent implements Agent {
  readonly name = 'TestAgent';
  readonly role = 'testing';

  constructor(private readonly aiClient?: AiClient) {}

  async run(context: AgentContext): Promise<AgentResult> {
    if (this.aiClient) {
      try {
        const implFiles = (context.previousResults ?? [])
          .flatMap((r) => r.files ?? [])
          .filter((f) => f.path.startsWith('src/'))
          .map((f) => `---FILE: ${f.path}---\n${f.content}`)
          .join('\n\n');

        const basePrompt = [
          `プロジェクト名: ${context.project.name}`,
          `テスト範囲: ${context.hearingAnswers?.testScope ?? '単体テスト'}`,
          '',
          implFiles ? `## 実装コード\n${implFiles}` : '実装コードなし',
        ].join('\n');

        const withRevision = withRevisionContext(basePrompt, context.revisionContent);
        const userPrompt = withLessonsContext(withRevision, context.lessonsLearned ?? []);

        const raw = await this.aiClient.generate(SYSTEM_PROMPT, userPrompt);
        const files = parseFiles(raw);

        if (files.length === 0) {
          return { ok: false, summary: 'テストファイルの解析に失敗しました', error: 'No files parsed' };
        }

        return {
          ok: true,
          summary: `テストコードをAIで生成しました（${files.length}ファイル）`,
          files,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, summary: 'テストコードの生成に失敗しました', error: msg };
      }
    }

    const testResult = generateTestResult(context.project.name);
    const sampleTest = generateSampleTest(context.project.name);

    return {
      ok: true,
      summary: 'テスト（モック）が完了しました',
      files: [testResult, sampleTest],
    };
  }
}
