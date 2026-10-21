/** Keeps the `k` highest-scoring items of a stream (binary min-heap on the score). */
export class TopK<T> {
  private readonly heap: { score: number; item: T }[] = [];

  constructor(private readonly k: number) {}

  push(score: number, item: T): void {
    if (this.k <= 0) return;
    const heap = this.heap;
    if (heap.length < this.k) {
      heap.push({ score, item });
      this.up(heap.length - 1);
    } else if (score > heap[0]!.score) {
      heap[0] = { score, item };
      this.down(0);
    }
  }

  /** Highest score first. */
  sorted(): { score: number; item: T }[] {
    return [...this.heap].sort((a, b) => b.score - a.score);
  }

  private up(index: number): void {
    const heap = this.heap;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent]!.score <= heap[index]!.score) return;
      [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
      index = parent;
    }
  }

  private down(index: number): void {
    const heap = this.heap;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left]!.score < heap[smallest]!.score) smallest = left;
      if (right < heap.length && heap[right]!.score < heap[smallest]!.score) smallest = right;
      if (smallest === index) return;
      [heap[smallest], heap[index]] = [heap[index]!, heap[smallest]!];
      index = smallest;
    }
  }
}
