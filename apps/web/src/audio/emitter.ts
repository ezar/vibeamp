/** The smallest event emitter that satisfies Webamp's `IMedia.on`. */
export class Emitter {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, callback: (...args: unknown[]) => void): () => void {
    const existing = this.listeners.get(event) ?? new Set();
    existing.add(callback);
    this.listeners.set(event, existing);
    return () => {
      existing.delete(callback);
    };
  }

  emit(event: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(event) ?? []) callback(...args);
  }

  dispose(): void {
    this.listeners.clear();
  }
}
