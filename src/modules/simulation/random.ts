/** Independent keyed streams keep arrivals and service draws stable across capacity changes. */
export function randomStream(seed: number, key: string): () => number {
  let state = seed >>> 0;
  for (let i = 0; i < key.length; i++) state = Math.imul(state ^ key.charCodeAt(i), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

/** A binary heap avoids sorting the entire event calendar after each arrival. */
export class MinHeap<T> {
  private readonly values: T[] = [];
  constructor(private readonly compare: (left: T, right: T) => number) {}
  push(value: T): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.values[parent], value) <= 0) break;
      this.values[index] = this.values[parent]; index = parent;
    }
    this.values[index] = value;
  }
  pop(): T | undefined {
    const root = this.values[0], last = this.values.pop();
    if (!this.values.length || last === undefined) return root;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      const left = index * 2 + 1, right = left + 1;
      const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0 ? right : left;
      if (this.compare(last, this.values[child]) <= 0) break;
      this.values[index] = this.values[child]; index = child;
    }
    this.values[index] = last;
    return root;
  }
}
