import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.store-cache.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

let memory = null;

function load() {
  if (memory) return memory;
  try {
    memory = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    memory = {};
  }
  return memory;
}

function save() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(memory, null, 2));
}

export function getCachedStore(id) {
  const entry = load()[id];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) return null;
  return entry.store;
}

export function setCachedStore(id, store) {
  load()[id] = { store, cachedAt: Date.now() };
  save();
}
