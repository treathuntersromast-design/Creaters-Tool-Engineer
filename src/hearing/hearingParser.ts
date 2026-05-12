import { HearingAnswerFields } from '../db/repositories/hearingAnswerRepository';

const NUMBER_PREFIX = /^[\d①-⑨【】()\[\]]+[.)、。\s]*\s*/;

function stripNumberPrefix(line: string): string {
  return line.replace(NUMBER_PREFIX, '').trim();
}

function extractByIndex(lines: string[], index: number): string | null {
  const line = lines[index];
  if (!line) return null;
  const value = stripNumberPrefix(line);
  return value || null;
}

export function parseHearingReply(text: string): Partial<HearingAnswerFields> & { rawText: string } {
  const lines = text
    .split(/\n|。(?=\s)/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: Partial<HearingAnswerFields> & { rawText: string } = { rawText: text };

  // Try to detect numbered format: "1. ...", "2. ..."
  const numberedLines = lines.filter((l) => /^[\d①-⑨]/.test(l));

  if (numberedLines.length >= 3) {
    // Sort and extract by detected number
    const sorted = [...numberedLines].sort();
    result.purpose          = extractByIndex(sorted, 0) ?? undefined;
    result.targetUsers      = extractByIndex(sorted, 1) ?? undefined;
    result.requiredFeatures = extractByIndex(sorted, 2) ?? undefined;
    result.screens          = extractByIndex(sorted, 3) ?? undefined;
    result.techStack        = extractByIndex(sorted, 4) ?? undefined;
    result.priority         = extractByIndex(sorted, 5) ?? undefined;
    result.deployment       = extractByIndex(sorted, 6) ?? undefined;
    result.testScope        = extractByIndex(sorted, 7) ?? undefined;
  } else {
    // Fallback: sequential assignment
    result.purpose          = extractByIndex(lines, 0) ?? undefined;
    result.targetUsers      = extractByIndex(lines, 1) ?? undefined;
    result.requiredFeatures = extractByIndex(lines, 2) ?? undefined;
    result.screens          = extractByIndex(lines, 3) ?? undefined;
    result.techStack        = extractByIndex(lines, 4) ?? undefined;
    result.priority         = extractByIndex(lines, 5) ?? undefined;
    result.deployment       = extractByIndex(lines, 6) ?? undefined;
    result.testScope        = extractByIndex(lines, 7) ?? undefined;
  }

  return result;
}

export function getMissingFieldLabels(fields: string[]): string[] {
  const labels: Record<string, string> = {
    purpose:          'アプリの目的・概要',
    targetUsers:      '想定ユーザー',
    requiredFeatures: '必須機能',
    screens:          '画面（UI）の有無',
    techStack:        '技術スタック',
    priority:         '納期・優先順位',
    deployment:       'デプロイ先',
    testScope:        'テスト範囲',
  };
  return fields.map((f) => labels[f] ?? f);
}
