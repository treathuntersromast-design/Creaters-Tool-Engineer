export const HEARING_QUESTIONS = `開発のヒアリングを行います。以下8つの質問にすべてお答えください。

1. アプリの目的・概要は？
2. 想定ユーザーは？
3. 必須機能を教えてください
4. 画面（UI）はありますか？（あり/なし）
5. 技術スタックの希望はありますか？（例: Node.js、React等）
6. 納期・優先順位を教えてください
7. デプロイ先は？（例: AWS、Vercel、ローカル、未定）
8. テストの必要範囲は？（例: 単体テストのみ、E2Eも含む）

すべてを1つのメッセージにまとめて返信してください。`;

export const FIELD_LABELS: Record<string, string> = {
  purpose:          '1. アプリの目的・概要',
  targetUsers:      '2. 想定ユーザー',
  requiredFeatures: '3. 必須機能',
  screens:          '4. 画面（UI）の有無',
  techStack:        '5. 技術スタック',
  priority:         '6. 納期・優先順位',
  deployment:       '7. デプロイ先',
  testScope:        '8. テスト範囲',
};

export function buildMissingFieldsQuestion(missingFields: string[]): string {
  const labels = missingFields.map((f) => FIELD_LABELS[f] ?? f);
  return `以下の情報がまだ不足しています。追加で教えてください。\n\n${labels.join('\n')}`;
}
