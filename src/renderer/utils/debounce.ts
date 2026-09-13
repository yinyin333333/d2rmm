export type Debounced<TArgs extends unknown[]> = ((...args: TArgs) => void) & {
  cancel: () => void;
  flush: () => void;
};

export default function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  timeoutMs: number,
): Debounced<TArgs> {
  // TODO: figure out why we're using NodeJS types instead of DOM types in here
  let timeoutID: NodeJS.Timeout | null = null;
  let pending: TArgs | null = null;
  const debounced = (...args: TArgs): void => {
    pending = args;
    if (timeoutID != null) {
      clearTimeout(timeoutID);
    }
    timeoutID = setTimeout(() => {
      timeoutID = null;
      pending = null;
      fn(...args);
    }, timeoutMs);
  };
  debounced.cancel = (): void => {
    pending = null;
    if (timeoutID != null) {
      clearTimeout(timeoutID);
      timeoutID = null;
    }
  };
  debounced.flush = (): void => {
    const args = pending;
    debounced.cancel();
    if (args != null) fn(...args);
  };
  return debounced;
}
