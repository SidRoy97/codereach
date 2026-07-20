// One near-duplicate pair: two unit ids and their estimated similarity (0..1).
export interface DuplicatePair {
  a:          string;
  b:          string;
  similarity: number;
}

// A code unit to compare: a display id and its source text.
export interface DuplicateItem {
  id:   string;
  text: string;
}

// I find near-duplicate code by comparing MinHash signatures of token shingles.
export class DuplicateDetector {
  private readonly coeffA: number[];
  private readonly coeffB: number[];
  private readonly prime = 4294967311;

  constructor(private readonly shingleSize = 3, private readonly numHashes = 64) {
    this.coeffA = this.seededCoefficients(1);
    this.coeffB = this.seededCoefficients(2);
  }

  // I return every pair of items whose estimated similarity meets the threshold.
  findNearDuplicates(items: DuplicateItem[], threshold = 0.85): DuplicatePair[] {
    const signatures = items.map(item => this.signature(item.text));
    const pairs: DuplicatePair[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const similarity = this.estimate(signatures[i], signatures[j]);
        if (similarity >= threshold) pairs.push({ a: items[i].id, b: items[j].id, similarity });
      }
    }
    return pairs.sort((x, y) => y.similarity - x.similarity);
  }

  // I build a MinHash signature: the smallest hash per function over all shingles.
  private signature(text: string): number[] {
    const shingles = this.shingles(text);
    const sig = new Array(this.numHashes).fill(Number.MAX_SAFE_INTEGER);
    for (const shingle of shingles) {
      for (let h = 0; h < this.numHashes; h++) {
        const value = (this.coeffA[h] * shingle + this.coeffB[h]) % this.prime;
        if (value < sig[h]) sig[h] = value;
      }
    }
    return sig;
  }

  // I turn text into a set of hashed k-word shingles after normalizing it.
  private shingles(text: string): Set<number> {
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const set = new Set<number>();
    if (tokens.length < this.shingleSize) {
      if (tokens.length > 0) set.add(this.hash(tokens.join(' ')));
      return set;
    }
    for (let i = 0; i + this.shingleSize <= tokens.length; i++) {
      set.add(this.hash(tokens.slice(i, i + this.shingleSize).join(' ')));
    }
    return set;
  }

  // I estimate Jaccard similarity as the fraction of matching signature slots.
  private estimate(a: number[], b: number[]): number {
    let equal = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) equal++;
    return equal / a.length;
  }

  // I hash a shingle string to a positive integer (djb2).
  private hash(text: string): number {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  // I generate deterministic hash coefficients so results are reproducible.
  private seededCoefficients(seed: number): number[] {
    const out: number[] = [];
    let state = seed * 2654435761;
    for (let i = 0; i < this.numHashes; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      out.push((state % (this.prime - 1)) + 1);
    }
    return out;
  }
}
