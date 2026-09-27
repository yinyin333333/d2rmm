import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

export function isSelectionControl(
  target: EventTarget,
  currentTarget: EventTarget,
) {
  if (!(target instanceof Element)) return false;
  const control = target.closest(
    'input, textarea, button, a, [role="button"], [contenteditable="true"], [role="textbox"]',
  );
  return (
    control != null &&
    control !== currentTarget &&
    currentTarget instanceof Element &&
    currentTarget.contains(control)
  );
}

export default function useListSelection(ids: string[], scope = '') {
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const signature = JSON.stringify([scope, ids]);
  useEffect(() => {
    setSelected([]);
    anchor.current = null;
  }, [signature]);
  const clear = () => {
    setSelected([]);
    anchor.current = null;
  };
  const select = (id: string, event: MouseEvent<HTMLElement>) => {
    if (isSelectionControl(event.target, event.currentTarget)) return;
    event.currentTarget.focus();
    const additive = event.ctrlKey || event.metaKey;
    if (
      event.shiftKey &&
      anchor.current != null &&
      ids.includes(anchor.current)
    ) {
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelected((previous) =>
        additive ? Array.from(new Set([...previous, ...range])) : range,
      );
    } else {
      anchor.current = id;
      setSelected((previous) =>
        additive
          ? previous.includes(id)
            ? previous.filter((value) => value !== id)
            : [...previous, id]
          : [id],
      );
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, toggle: () => void) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, button, a, [contenteditable="true"], [role="textbox"]',
      )
    )
      return;
    if (event.key === ' ' && selected.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggle();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'a'
    ) {
      event.preventDefault();
      event.stopPropagation();
      setSelected(ids);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  };
  const onBackgroundClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(
        '[data-selection-item], li, input, textarea, button, a, [role="button"], [contenteditable="true"], [role="textbox"]',
      )
    )
      return;
    clear();
  };
  return { selected, select, clear, onKeyDown, onBackgroundClick };
}
