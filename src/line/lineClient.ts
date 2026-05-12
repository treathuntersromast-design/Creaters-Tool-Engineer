import { loadConfig } from '../config/env';
import { logger } from '../utils/logger';

export class LineClient {
  private readonly channelAccessToken: string;

  constructor(channelAccessToken?: string) {
    this.channelAccessToken = channelAccessToken ?? loadConfig().line.channelAccessToken;
  }

  async sendReply(replyToken: string, text: string): Promise<void> {
    await this.post('/v2/bot/message/reply', {
      replyToken,
      messages: [{ type: 'text', text }],
    });
  }

  async sendPush(userId: string, text: string): Promise<void> {
    await this.post('/v2/bot/message/push', {
      to: userId,
      messages: [{ type: 'text', text }],
    });
  }

  async getProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string } | null> {
    try {
      const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      });
      if (!res.ok) return null;
      return (await res.json()) as { displayName: string; pictureUrl?: string };
    } catch {
      return null;
    }
  }

  private async post(path: string, body: unknown): Promise<void> {
    const url = `https://api.line.me${path}`;
    logger.debug('LINE API request', { path, bodyType: typeof body });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const responseText = await res.text();
      throw new Error(`LINE API error: ${res.status} ${responseText}`);
    }
  }
}
