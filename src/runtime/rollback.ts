export type RollbackOptions = { enabled?: boolean; limit?: number };

/** Private, bounded canonical driver saves; never accepts imported rollback history. */
export class RollbackHistory {
  readonly enabled: boolean;
  private readonly limit: number;
  private points: string[] = [];
  private size = 0;
  constructor(options: RollbackOptions = {}) {
    if (options.enabled !== undefined && typeof options.enabled !== 'boolean') throw new Error('Invalid rollback enabled flag');
    this.enabled = options.enabled !== false; this.limit = options.limit ?? 80;
    if (!Number.isSafeInteger(this.limit) || this.limit < 1 || this.limit > 200) throw new Error('Rollback limit must be between 1 and 200');
  }
  get depth() { return Math.max(0, this.points.length - 1); }
  clear() { this.points = []; this.size = 0; }
  capture(value: unknown) {
    if (!this.enabled) return;
    const point = JSON.stringify(value);
    if (point === undefined || point.length > 4_000_000) { this.clear(); return; }
    this.points.push(point); this.size += point.length;
    while (this.points.length > this.limit + 1 || this.size > 8_000_000) this.size -= this.points.shift()!.length;
  }
  target(steps: number): unknown {
    if (!this.enabled || !Number.isSafeInteger(steps) || steps < 1 || steps > this.depth) return undefined;
    return JSON.parse(this.points[this.points.length - 1 - steps]);
  }
  rewind(steps: number) { for (let i = 0; i < steps; i++) this.size -= this.points.pop()!.length; }
}
