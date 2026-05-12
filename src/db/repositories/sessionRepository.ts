import Database from 'better-sqlite3';

export type SessionStatus = 'INACTIVE' | 'PENDING_OTP' | 'ACTIVE';

export interface AppSession {
  id: number;
  selectedUserId: string | null;
  otp: string | null;
  otpExpiry: string | null;
  status: SessionStatus;
  updatedAt: string;
}

export class SessionRepository {
  constructor(private readonly db: Database.Database) {}

  get(): AppSession {
    return this.db.prepare('SELECT * FROM app_session WHERE id = 1').get() as AppSession;
  }

  startPendingOtp(userId: string, otp: string, otpExpiry: string): void {
    this.db.prepare(`
      UPDATE app_session
      SET selectedUserId = ?, otp = ?, otpExpiry = ?, status = 'PENDING_OTP', updatedAt = ?
      WHERE id = 1
    `).run(userId, otp, otpExpiry, new Date().toISOString());
  }

  activate(userId: string): void {
    this.db.prepare(`
      UPDATE app_session
      SET status = 'ACTIVE', otp = NULL, otpExpiry = NULL, updatedAt = ?
      WHERE id = 1 AND selectedUserId = ?
    `).run(new Date().toISOString(), userId);
  }

  end(): void {
    this.db.prepare(`
      UPDATE app_session
      SET selectedUserId = NULL, otp = NULL, otpExpiry = NULL, status = 'INACTIVE', updatedAt = ?
      WHERE id = 1
    `).run(new Date().toISOString());
  }

  isActive(userId: string): boolean {
    const s = this.get();
    return s.status === 'ACTIVE' && s.selectedUserId === userId;
  }

  cleanupExpiredOtp(): void {
    const s = this.get();
    if (s.status === 'PENDING_OTP' && s.otpExpiry && new Date(s.otpExpiry) < new Date()) {
      this.end();
    }
  }
}
