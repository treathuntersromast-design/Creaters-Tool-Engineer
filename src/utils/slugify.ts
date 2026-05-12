import { randomId } from './ids';

const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function createProjectSlug(name: string): string {
  const normalized = name.normalize('NFKC').toLowerCase();

  let base = normalized
    .replace(/[\s　]+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (!base) {
    base = 'project';
  }

  if (WIN_RESERVED.test(base)) {
    base = `proj-${base}`;
  }

  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${base}-${ts}-${randomId(6)}`;
}
