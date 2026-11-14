// skill.md handling: the agent reads the live skill.md from aiprove.fun on
// every run (per the brief), with a bundled copy as offline fallback.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export async function readSkill(apiBase) {
  const url = `${apiBase.replace(/\/$/, '')}/skill.md`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('Authenticate') || text.length < 1000) {
      throw new Error('skill.md body looks wrong');
    }
    return { source: 'live', url, text };
  } catch (err) {
    const text = await readFile(join(here, '..', 'skill.md'), 'utf8');
    return { source: 'bundled-fallback', url, text, error: String(err?.message || err) };
  }
}
