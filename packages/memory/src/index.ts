export class RingBuffer<T> {
  readonly #items: Array<T | undefined>;
  #head = 0;
  #size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("capacity must be positive");
    this.#items = new Array<T | undefined>(capacity);
  }

  get size(): number { return this.#size; }

  push(value: T): void {
    this.#items[this.#head] = value;
    this.#head = (this.#head + 1) % this.capacity;
    this.#size = Math.min(this.#size + 1, this.capacity);
  }

  recent(count: number): readonly T[] {
    const result: T[] = [];
    const n = Math.min(Math.max(0, count), this.#size);
    for (let i = n; i > 0; i--) {
      const index = (this.#head - i + this.capacity) % this.capacity;
      const item = this.#items[index];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  snapshot(): readonly T[] { return this.recent(this.#size); }

  /** Replaces the newest item matching `match`; returns false when it has already been evicted. */
  update(match: (item: T) => boolean, next: (item: T) => T): boolean {
    for (let i = 1; i <= this.#size; i++) {
      const index = (this.#head - i + this.capacity) % this.capacity;
      const item = this.#items[index];
      if (item !== undefined && match(item)) { this.#items[index] = next(item); return true; }
    }
    return false;
  }
}
