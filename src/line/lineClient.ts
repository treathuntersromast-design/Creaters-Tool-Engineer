import { loadConfig } from '../config/env';
import { logger } from '../utils/logger';

export class LineClient {
  private readonly channelAccessToken: string;
  /** ローカルチャット用コレクター: userId → callback。登録中はLINE APIを呼ばず収集する */
  private readonly collectors = new Map<string, (text: string) => void>();

  constructor(channelAccessToken?: string) {
    this.channelAccessToken = channelAccessToken ?? loadConfig().line.channelAccessToken;
  }

  addCollector(userId: string, fn: (text: string) => void): void {
    this.collectors.set(userId, fn);
  }

  removeCollector(userId: string): void {
    this.collectors.delete(userId);
  }

  async sendReply(replyToken: string, text: string): Promise<void> {
    await this.post('/v2/bot/message/reply', {
      replyToken,
      messages: [{ type: 'text', text }],
    });
  }

  async sendPush(userId: string, text: string): Promise<void> {
    const collector = this.collectors.get(userId);
    if (collector) {
      collector(text);
      return; // ローカルチャット中はLINE APIを呼ばない
    }
    await this.post('/v2/bot/message/push', {
      to: userId,
      messages: [{ type: 'text', text }],
    });
  }

  /**
   * LINE に画像を送信する。
   * ローカルチャット中はコレクター経由でファイルパスをテキスト通知する。
   * @param localPath PCアプリ向けローカルパス（コレクター登録時のみ使用）
   */
  async sendImage(
    userId: string,
    originalUrl: string,
    previewUrl: string,
    localPath?: string,
  ): Promise<void> {
    const collector = this.collectors.get(userId);
    if (collector) {
      collector(localPath
        ? `📸 スクリーンショット保存先:\n${localPath}`
        : '📸 スクリーンショットを撮影しました（LINE 送信には ngrok が必要です）',
      );
      return;
    }
    await this.post('/v2/bot/message/push', {
      to: userId,
      messages: [{ type: 'image', originalContentUrl: originalUrl, previewImageUrl: previewUrl }],
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
