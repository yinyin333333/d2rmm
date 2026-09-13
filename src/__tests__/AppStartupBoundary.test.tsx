import AppStartupBoundary, {
  AppStartupReady,
} from 'renderer/react/AppStartupBoundary';
import {
  act,
  lazy,
  ReactNode,
  StrictMode,
  Suspense,
  useEffect,
  useLayoutEffect,
} from 'react';
import { createRoot, Root } from 'react-dom/client';

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const onReady = jest.fn<Promise<void>, []>();

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  frames = new Map();
  nextFrame = 0;
  onReady.mockReset().mockResolvedValue(undefined);
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

async function render(children: ReactNode): Promise<void> {
  await act(async () => {
    root.render(
      <AppStartupBoundary onReady={onReady}>{children}</AppStartupBoundary>,
    );
  });
}

async function paint(): Promise<void> {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}

function RenderFailure(): never {
  throw new Error('Initial render failed');
}

function EffectFailure({ layout = false }: { layout?: boolean }): null {
  useLayoutEffect(() => {
    if (layout) throw new Error('Initial layout effect failed');
  }, [layout]);
  useEffect(() => {
    if (!layout) throw new Error('Initial passive effect failed');
  }, [layout]);
  return null;
}

test('confirms a healthy committed UI once, including StrictMode effect replay', async () => {
  const content = (
    <StrictMode>
      <span>Healthy application</span>
      <AppStartupReady />
    </StrictMode>
  );
  await render(content);
  expect(container.textContent).toBe('Healthy application');
  expect(onReady).not.toHaveBeenCalled();
  await paint();
  await render(content);
  await paint();
  expect(onReady).toHaveBeenCalledTimes(1);
});

test('waits for local startup data to finish loading', async () => {
  await render(<AppStartupReady ready={false} />);
  await paint();
  expect(onReady).not.toHaveBeenCalled();
  await render(<AppStartupReady ready={true} />);
  await paint();
  expect(onReady).toHaveBeenCalledTimes(1);
});

test('does not confirm an initial render failure caught by ErrorBoundary', async () => {
  await render(
    <>
      <AppStartupReady />
      <RenderFailure />
    </>,
  );
  await paint();
  expect(container.textContent).toContain('Initial render failed');
  expect(onReady).not.toHaveBeenCalled();
});

test.each([false, true])(
  'does not confirm an initial effect failure (layout=%s)',
  async (layout) => {
    await render(
      <>
        <AppStartupReady />
        <EffectFailure layout={layout} />
      </>,
    );
    await paint();
    expect(container.textContent).toContain(
      layout ? 'Initial layout effect failed' : 'Initial passive effect failed',
    );
    expect(onReady).not.toHaveBeenCalled();
  },
);

test('does not confirm an effect failure in newly loaded startup content', async () => {
  await render(<AppStartupReady ready={false} />);
  await paint();
  await render(
    <>
      <AppStartupReady ready={true} />
      <EffectFailure />
    </>,
  );
  await paint();
  expect(container.textContent).toContain('Initial passive effect failed');
  expect(onReady).not.toHaveBeenCalled();
});

test('cancels a queued confirmation when the committed UI fails before the callback', async () => {
  await render(<AppStartupReady />);
  expect(frames.size).toBe(1);
  await render(
    <>
      <AppStartupReady />
      <RenderFailure />
    </>,
  );
  await paint();
  expect(onReady).not.toHaveBeenCalled();
});

test('cancels a queued confirmation when its content unmounts', async () => {
  await render(<AppStartupReady />);
  await render(null);
  await paint();
  expect(onReady).not.toHaveBeenCalled();
});

test('waits for the visible Suspense content instead of confirming its fallback', async () => {
  let resolve!: (value: { default: () => JSX.Element }) => void;
  const LazyContent = lazy(
    () =>
      new Promise<{ default: () => JSX.Element }>((done) => {
        resolve = done;
      }),
  );
  await render(
    <Suspense fallback={<span>Loading</span>}>
      <LazyContent />
      <AppStartupReady />
    </Suspense>,
  );
  await paint();
  expect(container.textContent).toBe('Loading');
  expect(onReady).not.toHaveBeenCalled();
  await act(async () =>
    resolve({ default: () => <span>Loaded application</span> }),
  );
  await paint();
  expect(container.textContent).toBe('Loaded application');
  expect(onReady).toHaveBeenCalledTimes(1);
});

test('does not confirm when loading the visible lazy content fails', async () => {
  let reject!: (error: Error) => void;
  const LazyContent = lazy(
    () =>
      new Promise<{ default: () => JSX.Element }>((_resolve, fail) => {
        reject = fail;
      }),
  );
  await render(
    <Suspense fallback={<span>Loading</span>}>
      <LazyContent />
      <AppStartupReady />
    </Suspense>,
  );
  await act(async () => reject(new Error('Startup chunk failed')));
  await paint();
  expect(container.textContent).toContain('Startup chunk failed');
  expect(onReady).not.toHaveBeenCalled();
});

test('cancels confirmation while Suspense hides content, then confirms after it returns', async () => {
  let resolve!: () => void;
  let suspended = false;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  function Content(): JSX.Element {
    if (suspended) throw pending;
    return <span>Application</span>;
  }
  const content = () => (
    <Suspense fallback={<span>Loading</span>}>
      <Content />
      <AppStartupReady />
    </Suspense>
  );
  await render(content());
  suspended = true;
  await render(content());
  await paint();
  expect(onReady).not.toHaveBeenCalled();
  await act(async () => {
    suspended = false;
    resolve();
  });
  await paint();
  expect(onReady).toHaveBeenCalledTimes(1);
});
