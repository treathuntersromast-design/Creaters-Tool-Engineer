import { Agent, AgentResult, AgentContext } from './Agent';
import { HEARING_QUESTIONS } from '../hearing/hearingQuestions';
import { parseHearingReply } from '../hearing/hearingParser';

export class LeaderAgent implements Agent {
  readonly name = 'LeaderAgent';
  readonly role = 'leader';

  getHearingQuestions(): string {
    return HEARING_QUESTIONS;
  }

  parseHearingReply(text: string): ReturnType<typeof parseHearingReply> {
    return parseHearingReply(text);
  }

  async run(context: AgentContext): Promise<AgentResult> {
    const answers = context.hearingAnswers;
    return {
      ok: true,
      summary: 'LeaderAgent: ヒアリング完了。要件定義フェーズへ移行します。',
      data: answers,
    };
  }
}
