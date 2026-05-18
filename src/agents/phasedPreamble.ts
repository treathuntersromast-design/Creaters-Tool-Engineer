/**
 * Pattern 5 – Phased Preamble Prompting
 *
 * Prepends a structured 4-phase execution contract to every agent system prompt.
 * This primes the LLM to think sequentially: confirm → plan → execute → verify.
 */
export function withPhasedPreamble(systemPrompt: string, phaseName: string): string {
  const preamble = `【実行プロトコル: ${phaseName}】
あなたは以下の4フェーズで厳密に行動します。

フェーズ1 受領確認: 入力内容・制約・成功条件を箇条書きで列挙してください。
フェーズ2 実行計画: 何をどの順序で行うか、簡潔な計画を示してください（3〜5項目）。
フェーズ3 実行: 計画に従い成果物を生成してください。省略・手抜きは禁止です。
フェーズ4 完了確認: 生成した成果物が要件を満たしているか自己チェックし、不足があれば補完してください。

---
`;
  return preamble + systemPrompt;
}

/** Injects lessons_learned context before the user prompt */
export function withLessonsContext(userPrompt: string, lessons: Array<{ phase: string; content: string }>): string {
  if (lessons.length === 0) return userPrompt;
  const lessonText = lessons
    .slice(0, 5)
    .map((l, i) => `${i + 1}. [${l.phase}] ${l.content}`)
    .join('\n');
  return `【過去プロジェクトからの学習（Memory）】\n${lessonText}\n\n---\n${userPrompt}`;
}

/**
 * 修正依頼の内容をプロンプトの先頭に差し込む。
 * revisionContent が undefined のとき（新規プロジェクト）は何もしない。
 */
export function withRevisionContext(userPrompt: string, revisionContent: string | undefined): string {
  if (!revisionContent) return userPrompt;
  return (
    `【修正依頼（必ず反映すること）】\n` +
    `${revisionContent}\n\n` +
    `上記の修正依頼を踏まえ、以下の内容で作業してください。\n` +
    `既存の要件は維持しつつ、修正内容を正確に組み込んでください。\n\n---\n` +
    userPrompt
  );
}
