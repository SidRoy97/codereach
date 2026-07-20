import * as fs from 'fs';
import * as path from 'path';
import { ParseResult } from './LanguageParser';

// One cached file: the content hash it was parsed at, and the parse output.
interface CacheEntry {
  hash:   string;
  result: ParseResult;
}

// I remember each file's parse result so unchanged files are never re-parsed.
export class GraphCache {
  private store = new Map<string, CacheEntry>();

  // I produce a fast, stable hash of a file's content (djb2, no dependencies).
  static hash(content: string): string {
    let h = 5381;
    for (let i = 0; i < content.length; i++) h = ((h << 5) + h + content.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16) + ':' + content.length;
  }

  // I return the cached parse result only when the content hash still matches.
  get(file: string, hash: string): ParseResult | null {
    const entry = this.store.get(file);
    return entry && entry.hash === hash ? entry.result : null;
  }

  // I remember a file's parse result under its current content hash.
  set(file: string, hash: string, result: ParseResult): void {
    this.store.set(file, { hash, result });
  }

  // I forget any file that no longer exists in the workspace.
  prune(liveFiles: Set<string>): void {
    for (const file of Array.from(this.store.keys())) {
      if (!liveFiles.has(file)) this.store.delete(file);
    }
  }

  // I report how many files are cached.
  size(): number {
    return this.store.size;
  }

  // I load a saved cache from disk, starting empty if it is missing or invalid.
  load(cachePath: string): void {
    this.store.clear();
    try {
      const raw = fs.readFileSync(cachePath, 'utf8');
      const data = JSON.parse(raw) as Record<string, CacheEntry>;
      for (const [file, entry] of Object.entries(data)) {
        if (entry && typeof entry.hash === 'string' && entry.result) this.store.set(file, entry);
      }
    } catch {
      this.store.clear();
    }
  }

  // I write the cache to disk, creating its folder if needed.
  save(cachePath: string): void {
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const data: Record<string, CacheEntry> = {};
      for (const [file, entry] of this.store) data[file] = entry;
      fs.writeFileSync(cachePath, JSON.stringify(data));
    } catch {
      // Cache is best-effort; a failed write must never break analysis.
    }
  }
}
