type TimerId = number | object;

export class ChatDebugExpiryTimer {
  private timer: TimerId | undefined;

  schedule(earliestMs: number | undefined, onExpire: () => void): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer as number);
      this.timer = undefined;
    }
    if (earliestMs === undefined) return;
    const delay = Math.max(0, earliestMs - Date.now());
    this.timer = setTimeout(onExpire, delay);
  }

  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer as number);
      this.timer = undefined;
    }
  }
}
