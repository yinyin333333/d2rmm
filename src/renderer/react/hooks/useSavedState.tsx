import { useEffect, useRef, useState } from 'react';

function defaultSerialize<T>(value: T): string {
  return String(value);
}

function defaultDeserialize<T>(value: string): T {
  // TODO: just use JSON.stringify / JSON.parse for all saved state
  //       but needs a migration path for existing users

  // hack around stringified null and undefined values since the string
  // versions of these values aren't actually valid for any existing use case
  if (value === 'null') {
    return null as unknown as T;
  }
  if (value === 'undefined') {
    return undefined as unknown as T;
  }

  return value as unknown as T;
}

export default function useSavedState<T>(
  key: string,
  initialValue: T,
  serialize: (value: T) => string = defaultSerialize,
  deserialize: (value: string) => T = defaultDeserialize,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const serializeRef = useRef(serialize);
  const [value, setValue] = useState<T>(() => {
    try {
      const savedValue = localStorage.getItem(key);
      return savedValue != null ? deserialize(savedValue) : initialValue;
    } catch (e) {
      console.error(e);
      return initialValue;
    }
  });

  useEffect(() => {
    serializeRef.current = serialize;
  }, [serialize]);

  useEffect(() => {
    try {
      localStorage.setItem(key, serializeRef.current(value));
    } catch (e) {
      console.error(e);
    }
  }, [key, value]);

  return [value, setValue];
}

function defaultSerializeJSON<T>(value: T): string {
  return JSON.stringify(value);
}

function defaultDeserializeJSON<T>(value: string): T {
  return JSON.parse(value) as unknown as T;
}

export function useSavedStateJSON<T>(
  key: string,
  initialValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  return useSavedState(
    key,
    initialValue,
    defaultSerializeJSON,
    defaultDeserializeJSON,
  );
}
