export type Debounced<TArgs extends unknown[]> = ((...args: TArgs) => void) & {
  cancel: () => void;
};

export default function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  timeoutMs: number,
): Debounced<TArgs> {
  // TODO: figure out why we're using NodeJS types instead of DOM types in here
  let timeoutID: NodeJS.Timeout | null = null;
  const debounced = (...args: TArgs): void => {
    if (timeoutID != null) {
      clearTimeout(timeoutID);
    }
    timeoutID = setTimeout(() => {
      timeoutID = null;
      fn(...args);
    }, timeoutMs);
  };
  debounced.cancel = (): void => {
    if (timeoutID != null) {
      clearTimeout(timeoutID);
      timeoutID = null;
    }
  };
  return debounced;
}
