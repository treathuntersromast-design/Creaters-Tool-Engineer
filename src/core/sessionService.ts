import crypto from 'crypto';
import { SessionRepository } from '../db/repositories/sessionRepository';
import { LineClient } from '../line/lineClient';
import { logger } from '../utils/logger';

const OTP_EXPIRY_MS = 10 * 60 * 1000;

function generateOtp(): string {
  // crypto.randomInt is cryptographically secure, unlike Math.random
  return String(crypto.randomInt(100000, 1000000));
}

export class SessionService {
  private otpTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly lineClient: LineClient,
  ) {}

  async initiateSession(userId: string): Promise<{ ok: boolean; message: string }> {
    const current = this.sessionRepo.get();

    if (current.status === 'ACTIVE') {
      return { ok: false, message: '既にセッションが稼働中です' };
    }
    if (current.status === 'PENDING_OTP') {
      return { ok: false, message: 'OTP送信済みです。LINEでコードを確認してください' };
    }

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

    this.sessionRepo.startPendingOtp(userId, otp, otpExpiry);

    if (this.otpTimer) clearTimeout(this.otpTimer);
    this.otpTimer = setTimeout(() => {
      const session = this.sessionRepo.get();
      if (session.status === 'PENDING_OTP' && session.selectedUserId === userId) {
        this.sessionRepo.end();
        logger.info('OTP expired, session cancelled', { userId });
      }
    }, OTP_EXPIRY_MS);

    try {
      await this.lineClient.sendPush(
        userId,
        '🔐 開発アシスタントを起動しようとしています。\n\n' +
        `認証コード: ${otp}\n\n` +
        'このコードを10分以内に返信してください。\n' +
        '時間内に返信がない場合は自動的にキャンセルされます。',
      );
      logger.info('OTP sent', { userId });
      return { ok: true, message: 'OTPをLINEに送信しました。10分以内に返信してください。' };
    } catch (err) {
      this.sessionRepo.end();
      if (this.otpTimer) { clearTimeout(this.otpTimer); this.otpTimer = null; }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send OTP via LINE', { userId, err: msg });
      return { ok: false, message: `LINE送信に失敗しました: ${msg}` };
    }
  }

  async verifyOtp(userId: string, input: string): Promise<boolean> {
    const session = this.sessionRepo.get();

    if (session.status !== 'PENDING_OTP') return false;
    if (session.selectedUserId !== userId) return false;
    if (!session.otp || !session.otpExpiry) return false;

    if (new Date(session.otpExpiry) < new Date()) {
      this.sessionRepo.end();
      await this.lineClient.sendPush(
        userId,
        '⏰ 認証コードの有効期限が切れました。\nPCで再度「認証して起動」をクリックしてください。',
      ).catch(() => {});
      return false;
    }

    const expected = Buffer.from(session.otp, 'utf8');
    const actual   = Buffer.from(input.trim(), 'utf8');
    const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!match) {
      await this.lineClient.sendPush(userId, '❌ 認証コードが違います。もう一度入力してください。').catch(() => {});
      return false;
    }

    if (this.otpTimer) { clearTimeout(this.otpTimer); this.otpTimer = null; }

    this.sessionRepo.activate(userId);
    await this.lineClient.sendPush(
      userId,
      '✅ 認証成功！開発アシスタントが起動しました。\n\n' +
      '【プロジェクト管理】\n' +
      '・新規プロジェクト: <名前>\n' +
      '・進捗 / 承認\n' +
      '・修正: <内容>\n' +
      '・停止 / 再開\n\n' +
      '【Git 操作】\n' +
      '・リポジトリ一覧\n' +
      '・<名前>を選択\n' +
      '・ステータス確認 / ログ確認\n' +
      '・フェッチ / プル / プッシュ\n' +
      '・ブランチ一覧 / <branch>に切り替え\n\n' +
      '・今日は終わってください（セッション終了）',
    ).catch(() => {});

    logger.info('Session activated via OTP', { userId });
    return true;
  }

  async endSession(notifyUser = true): Promise<void> {
    const session = this.sessionRepo.get();
    if (session.status === 'INACTIVE') return;

    if (this.otpTimer) { clearTimeout(this.otpTimer); this.otpTimer = null; }

    const targetUserId = session.selectedUserId;
    this.sessionRepo.end();

    if (notifyUser && targetUserId) {
      await this.lineClient.sendPush(
        targetUserId,
        '👋 お疲れ様でした！セッションを終了しました。',
      ).catch(() => {});
    }

    logger.info('Session ended', { userId: targetUserId });
  }

  isAuthenticated(userId: string): boolean {
    return this.sessionRepo.isActive(userId);
  }

  isPendingOtp(userId: string): boolean {
    const s = this.sessionRepo.get();
    return s.status === 'PENDING_OTP' && s.selectedUserId === userId;
  }

  getSessionInfo() {
    return this.sessionRepo.get();
  }
}
