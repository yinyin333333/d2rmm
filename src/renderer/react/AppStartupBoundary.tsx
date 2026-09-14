import ErrorBoundary from 'renderer/react/ErrorBoundary';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

const StartupContext = createContext<(() => void) | null>(null);

export default function AppStartupBoundary({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady: () => Promise<void>;
}): JSX.Element {
  const failed = useRef(false);
  const confirmed = useRef(false);
  const confirm = useCallback(() => {
    if (failed.current || confirmed.current) return;
    confirmed.current = true;
    void onReady().catch(console.error);
  }, [onReady]);

  return (
    <ErrorBoundary
      onError={() => {
        failed.current = true;
      }}
    >
      <StartupContext.Provider value={confirm}>
        {children}
      </StartupContext.Provider>
    </ErrorBoundary>
  );
}

// Place this inside the visible content's Suspense boundary, after its local
// data has loaded. A render call or a committed loading fallback is not ready.
export function AppStartupReady({ ready = true }: { ready?: boolean }): null {
  const confirm = useContext(StartupContext);
  const [visibleCommit, setVisibleCommit] = useState(0);
  const cancelFrame = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    // Suspense replays layout effects when revealing hidden content, without
    // replaying passive effects. Start a fresh passive confirmation then, too.
    setVisibleCommit((commit) => commit + 1);
    return () => cancelFrame.current?.();
  }, []);
  useEffect(() => {
    if (!ready || visibleCommit === 0 || confirm == null) return undefined;
    // Start after passive effects, including those of newly loaded content.
    // The frame allows React to handle effect failures before confirmation.
    const frame = requestAnimationFrame(confirm);
    const cancel = () => cancelAnimationFrame(frame);
    cancelFrame.current = cancel;
    return cancel;
  }, [confirm, ready, visibleCommit]);
  return null;
}
