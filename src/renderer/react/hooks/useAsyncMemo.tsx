import { useEffect, useState } from 'react';

export function useAsyncMemo<T>(getValue: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let isCurrent = true;
    getValue()
      .then((result) => {
        if (isCurrent) {
          setValue(result);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          console.error(error);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [getValue]);
  return value;
}
