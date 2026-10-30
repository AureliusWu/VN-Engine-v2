/** A result belongs to its latest request and the editor context captured when it began. */
export function createAsyncOperation(context) {
  let sequence = 0;
  return {
    invalidate() { sequence++; },
    begin() {
      const selected = ++sequence, initial = context();
      const current = () => {
        if (selected !== sequence) return false;
        const latest = context();
        return initial.length === latest.length && initial.every((value, index) => Object.is(value, latest[index]));
      };
      return { current, commit(apply) { if (!current()) return false; apply(); return true; } };
    }
  };
}
