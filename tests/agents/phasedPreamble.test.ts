import { withPhasedPreamble, withLessonsContext, withRevisionContext } from '../../src/agents/phasedPreamble';

describe('withPhasedPreamble', () => {
  it('prepends the 4-phase protocol prefix', () => {
    const result = withPhasedPreamble('base prompt', 'テスト');
    expect(result).toContain('フェーズ1 受領確認');
    expect(result).toContain('フェーズ2 実行計画');
    expect(result).toContain('フェーズ3 実行');
    expect(result).toContain('フェーズ4 完了確認');
  });

  it('injects the phase name into the header', () => {
    const result = withPhasedPreamble('base', '要件定義');
    expect(result).toContain('実行プロトコル: 要件定義');
  });

  it('preserves the original system prompt after the preamble', () => {
    const original = 'あなたはプロフェッショナルです。';
    const result = withPhasedPreamble(original, 'テスト');
    expect(result).toContain(original);
    // preamble comes BEFORE the original
    expect(result.indexOf('フェーズ1')).toBeLessThan(result.indexOf(original));
  });

  it('does not modify an empty base prompt', () => {
    const result = withPhasedPreamble('', 'dummy');
    expect(result).toContain('フェーズ1');
    expect(result.length).toBeGreaterThan(0);
  });

  it('works with different phase names without corruption', () => {
    const phases = ['実装（インプリメンター）', 'コードレビュー', '基本設計（アーキテクト）'];
    for (const phase of phases) {
      const r = withPhasedPreamble('prompt', phase);
      expect(r).toContain(phase);
      expect(r).toContain('prompt');
    }
  });
});

describe('withLessonsContext', () => {
  const lessons = [
    { phase: 'requirements', content: 'ユーザー認証を要件に含めること' },
    { phase: 'implementation', content: 'SQLインジェクション対策を忘れない' },
    { phase: 'review', content: 'テストカバレッジ 80% 以上を目標に' },
  ];

  it('returns the prompt unchanged when lessons array is empty', () => {
    const prompt = 'original prompt';
    expect(withLessonsContext(prompt, [])).toBe(prompt);
  });

  it('prepends lessons block before the original prompt', () => {
    const result = withLessonsContext('original', lessons);
    expect(result).toContain('過去プロジェクトからの学習');
    expect(result).toContain('original');
    expect(result.indexOf('学習')).toBeLessThan(result.indexOf('original'));
  });

  it('formats lessons with index and phase label', () => {
    const result = withLessonsContext('prompt', lessons);
    expect(result).toContain('[requirements]');
    expect(result).toContain('ユーザー認証を要件に含めること');
    expect(result).toContain('[implementation]');
  });

  it('truncates to 5 lessons when more than 5 are provided', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      phase: `phase-${i}`,
      content: `lesson ${i}`,
    }));
    const result = withLessonsContext('prompt', many);
    // lessons 5-7 should not appear
    expect(result).not.toContain('lesson 5');
    expect(result).not.toContain('lesson 7');
    // lessons 0-4 should appear
    expect(result).toContain('lesson 0');
    expect(result).toContain('lesson 4');
  });

  it('preserves the separator line between lessons and prompt', () => {
    const result = withLessonsContext('my prompt', lessons);
    expect(result).toContain('---');
    expect(result).toContain('my prompt');
  });
});

describe('withRevisionContext', () => {
  it('returns the prompt unchanged when revisionContent is undefined', () => {
    const prompt = 'original prompt';
    expect(withRevisionContext(prompt, undefined)).toBe(prompt);
  });

  it('returns the prompt unchanged when revisionContent is empty string', () => {
    const prompt = 'original prompt';
    // Empty string is falsy — treated the same as undefined
    expect(withRevisionContext(prompt, '')).toBe(prompt);
  });

  it('prepends revision block before the original prompt', () => {
    const result = withRevisionContext('original', 'ログイン機能を追加');
    expect(result).toContain('修正依頼');
    expect(result).toContain('ログイン機能を追加');
    expect(result).toContain('original');
    expect(result.indexOf('修正依頼')).toBeLessThan(result.indexOf('original'));
  });

  it('includes instruction to preserve existing requirements', () => {
    const result = withRevisionContext('prompt', '修正内容');
    expect(result).toContain('既存の要件は維持');
  });

  it('includes separator between revision block and original prompt', () => {
    const result = withRevisionContext('my prompt', '修正内容');
    expect(result).toContain('---');
    expect(result).toContain('my prompt');
  });

  it('handles multi-line revision content correctly', () => {
    const multiLine = '# 修正依頼 #2\nライン1\nライン2\nライン3';
    const result = withRevisionContext('prompt', multiLine);
    expect(result).toContain('ライン1');
    expect(result).toContain('ライン3');
    expect(result).toContain('prompt');
  });
});
