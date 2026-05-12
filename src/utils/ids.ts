import crypto from 'crypto';

export function generateId(): string {
  return crypto.randomUUID();
}

export function randomId(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
