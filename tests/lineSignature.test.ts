import crypto from 'crypto';
import { verifyLineSignature } from '../src/line/webhookHandler';

const SECRET = 'test-channel-secret';

function makeSignature(body: string, secret: string): string {
  return crypto.createHmac('SHA256', secret).update(Buffer.from(body, 'utf-8')).digest('base64');
}

describe('verifyLineSignature', () => {
  test('returns true for valid signature', () => {
    const body = '{"events":[]}';
    const rawBody = Buffer.from(body, 'utf-8');
    const sig = makeSignature(body, SECRET);
    expect(verifyLineSignature(rawBody, sig, SECRET)).toBe(true);
  });

  test('returns false for invalid signature', () => {
    const body = '{"events":[]}';
    const rawBody = Buffer.from(body, 'utf-8');
    expect(verifyLineSignature(rawBody, 'invalid-signature', SECRET)).toBe(false);
  });

  test('returns false for wrong secret', () => {
    const body = '{"events":[]}';
    const rawBody = Buffer.from(body, 'utf-8');
    const sig = makeSignature(body, 'wrong-secret');
    expect(verifyLineSignature(rawBody, sig, SECRET)).toBe(false);
  });

  test('returns false for signature with different length - no exception thrown', () => {
    const body = '{"events":[]}';
    const rawBody = Buffer.from(body, 'utf-8');
    const shortSig = 'abc';
    expect(() => verifyLineSignature(rawBody, shortSig, SECRET)).not.toThrow();
    expect(verifyLineSignature(rawBody, shortSig, SECRET)).toBe(false);
  });

  test('returns false for empty signature', () => {
    const body = '{"events":[]}';
    const rawBody = Buffer.from(body, 'utf-8');
    expect(() => verifyLineSignature(rawBody, '', SECRET)).not.toThrow();
    expect(verifyLineSignature(rawBody, '', SECRET)).toBe(false);
  });

  test('validates using raw body bytes, not parsed JSON', () => {
    // The signature must match the raw Buffer, not a re-serialized object
    const rawBodyStr = '{"events":[],"destination":"Utest"}';
    const rawBody = Buffer.from(rawBodyStr, 'utf-8');
    const correctSig = makeSignature(rawBodyStr, SECRET);

    // Signature based on re-serialized object may differ
    const reParsed = JSON.stringify(JSON.parse(rawBodyStr));
    const wrongSig = makeSignature(reParsed, SECRET);

    expect(verifyLineSignature(rawBody, correctSig, SECRET)).toBe(true);
    // If formatting differs, the wrong sig should fail
    if (rawBodyStr !== reParsed) {
      expect(verifyLineSignature(rawBody, wrongSig, SECRET)).toBe(false);
    }
  });
});
