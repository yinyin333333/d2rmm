import type { AsAsyncSerializableAPI, AsyncSerializableAPI } from 'bridge/API';
import releaseAsyncVariant from '@jitl/quickjs-wasmfile-release-asyncify';
import { readFileSync } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import {
  QuickJSAsyncContext,
  QuickJSHandle,
  QuickJSAsyncWASMModule,
  Scope,
  newQuickJSAsyncWASMModuleFromVariant,
  newVariant,
} from 'quickjs-emscripten-core';
import { getIsPackaged, getResourcesPath } from './AppInfoAPI';

let loadedQuickJSAsyncWASMModule: QuickJSAsyncWASMModule | null;

// This budget applies only while QuickJS is executing JavaScript. Async host
// calls refresh the deadline immediately before control returns to the VM.
export const QUICKJS_CONTINUOUS_EXECUTION_TIMEOUT_MS = 5 * 60_000;

export interface QuickJSExecutionWatchdog {
  dispose(): void;
  refresh(): void;
}

type QuickJSInterruptRuntime = Pick<
  QuickJSAsyncContext['runtime'],
  'removeInterruptHandler' | 'setInterruptHandler'
>;

export function installQuickJSExecutionWatchdog(
  runtime: QuickJSInterruptRuntime,
  options: {
    budgetMs?: number;
    now?: () => number;
  } = {},
): QuickJSExecutionWatchdog {
  const budgetMs = options.budgetMs ?? QUICKJS_CONTINUOUS_EXECUTION_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error('The QuickJS execution budget must be positive.');
  }

  let deadline = now() + budgetMs;
  let disposed = false;
  runtime.setInterruptHandler(() => !disposed && now() >= deadline);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      runtime.removeInterruptHandler();
    },
    refresh: () => {
      if (!disposed) deadline = now() + budgetMs;
    },
  };
}

export async function initQuickJS(): Promise<void> {
  const modulePath = path.join(
    getResourcesPath(),
    'app.asar.unpacked/node_modules',
    '@jitl/quickjs-wasmfile-release-asyncify/dist',
  );

  // issue: https://github.com/electron/asar/issues/249
  // fix: https://github.com/electron/electron/pull/37535
  // lots of blockers prevent upgrading electron & NodeJS versions :(
  const variant = getIsPackaged()
    ? newVariant(
        {
          ...releaseAsyncVariant,
          importModuleLoader: () => {
            const mjsSourceCode = readFileSync(
              path.join(modulePath, 'emscripten-module.mjs'),
            )
              .toString()
              .replace(
                /import.meta.url/g,
                `"file:///${modulePath.replace(/\\/g, '/')}"`,
              )
              .replace('export default ', '');
            return eval(mjsSourceCode);
          },
        },
        {
          wasmBinary: readFileSync(
            path.join(modulePath, 'emscripten-module.wasm'),
          ),
        },
      )
    : releaseAsyncVariant;

  loadedQuickJSAsyncWASMModule =
    await newQuickJSAsyncWASMModuleFromVariant(variant);
}

export function getQuickJS(): QuickJSAsyncWASMModule {
  if (loadedQuickJSAsyncWASMModule == null) {
    throw new Error('QuickJS module not loaded');
  }
  return loadedQuickJSAsyncWASMModule;
}

// Configuration seam only. BridgeAPI intentionally uses getQuickJS().newContext()
// until a compatible production memory policy is backed by installation data.
export function createQuickJSContextWithMemoryLimit(
  module: Pick<QuickJSAsyncWASMModule, 'newContext'>,
  memoryLimit: number,
): QuickJSAsyncContext {
  if (!Number.isSafeInteger(memoryLimit) || memoryLimit <= 0) {
    throw new Error(
      'The QuickJS memory limit must be a positive safe integer.',
    );
  }
  const context = module.newContext();
  try {
    context.runtime.setMemoryLimit(memoryLimit);
    return context;
  } catch (error) {
    context.dispose();
    throw error;
  }
}

export function getQuickJSProxyAPI<T extends AsyncSerializableAPI<T>>(
  vm: QuickJSAsyncContext,
  scope: Scope,
  api: AsAsyncSerializableAPI<T>,
  watchdog?: Pick<QuickJSExecutionWatchdog, 'refresh'>,
): QuickJSHandle {
  const handle = scope.manage(vm.newObject());
  for (const key in api) {
    vm.setProp(
      handle,
      key,
      scope.manage(
        vm.newAsyncifiedFunction(key, async (...args) => {
          try {
            return getHandleForValue(
              vm,
              // @ts-ignore: TypeScript can't recurse deeply enough for this
              await api[key](...args.map(vm.dump)),
            );
          } finally {
            // Time spent awaiting Node APIs must not consume the pure-JS
            // execution budget. Refresh just before asyncify resumes the VM.
            watchdog?.refresh();
          }
        }),
      ),
    );
  }
  return handle;
}

function getHandleForValue<T>(
  vm: QuickJSAsyncContext,
  value: T,
): QuickJSHandle {
  return Scope.withScope((valueScope) =>
    getScopedHandleForValue(vm, valueScope, value).dup(),
  );
}

function getScopedHandleForValue<T>(
  vm: QuickJSAsyncContext,
  scope: Scope,
  value: T,
): QuickJSHandle {
  if (value === null) {
    return vm.null;
  } else if (value instanceof Error) {
    return scope.manage(vm.newError(value.message));
  } else if (typeof value === 'boolean') {
    return value ? vm.true : vm.false;
  } else if (typeof value === 'number') {
    return scope.manage(vm.newNumber(value));
  } else if (typeof value === 'string') {
    return scope.manage(vm.newString(value));
  } else if (Array.isArray(value)) {
    const arrayHandle = scope.manage(vm.newArray());
    for (let i = 0; i < value.length; i++) {
      vm.setProp(arrayHandle, i, getScopedHandleForValue(vm, scope, value[i]));
    }
    return arrayHandle;
  } else if (typeof value === 'object') {
    const objectHandle = scope.manage(vm.newObject());
    for (const key in value) {
      vm.setProp(
        objectHandle,
        key,
        getScopedHandleForValue(vm, scope, value[key]),
      );
    }
    return objectHandle;
  } else {
    return vm.undefined;
  }
}
