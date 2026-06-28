export const SEED_ARG = '-seed';

export function normalizeExtraArgs(args: string[]): string[] {
  return args.map((arg) => arg.trim()).filter(Boolean);
}

function normalizeSeedValue(value: string): string {
  return value.replace(/\D/g, '');
}

export function getSeedValue(args: string[]): string {
  const normalizedArgs = normalizeExtraArgs(args);
  const seedIndex = normalizedArgs.indexOf(SEED_ARG);
  if (seedIndex === -1) {
    return '';
  }

  const value = normalizedArgs[seedIndex + 1];
  return value != null && !value.startsWith('-')
    ? normalizeSeedValue(value)
    : '';
}

export function removeSeedArg(args: string[]): string[] {
  const normalizedArgs = normalizeExtraArgs(args);
  const result: string[] = [];
  for (let i = 0; i < normalizedArgs.length; i += 1) {
    if (normalizedArgs[i] === SEED_ARG) {
      const nextArg = normalizedArgs[i + 1];
      if (nextArg != null && !nextArg.startsWith('-')) {
        i += 1;
      }
      continue;
    }
    result.push(normalizedArgs[i]);
  }
  return result;
}

export function normalizeLaunchArgs(args: string[]): string[] {
  const normalizedArgs = normalizeExtraArgs(args);
  const result: string[] = [];

  for (let i = 0; i < normalizedArgs.length; i += 1) {
    const arg = normalizedArgs[i];
    if (arg === SEED_ARG) {
      const nextArg = normalizedArgs[i + 1];
      if (nextArg != null && !nextArg.startsWith('-')) {
        const seedValue = normalizeSeedValue(nextArg);
        if (seedValue !== '') {
          result.push(SEED_ARG, seedValue);
        }
        i += 1;
      }
      continue;
    }
    result.push(arg);
  }

  return result;
}

export function parseExtraArgsText(value: string): string[] {
  return normalizeLaunchArgs(value.split(/\s+/));
}

export function hasExtraArg(args: string[], arg: string): boolean {
  return normalizeExtraArgs(args).includes(arg);
}

export function setExtraArgEnabled(
  args: string[],
  arg: string,
  enabled: boolean,
): string[] {
  const normalizedArgs = normalizeLaunchArgs(args);
  if (enabled) {
    return hasExtraArg(normalizedArgs, arg)
      ? normalizedArgs
      : [...normalizedArgs, arg];
  }
  return normalizedArgs.filter((value) => value !== arg);
}

export function setSeedValue(args: string[], value: string): string[] {
  const seedValue = normalizeSeedValue(value);
  const nextArgs = removeSeedArg(args);

  return seedValue === '' ? nextArgs : [...nextArgs, SEED_ARG, seedValue];
}
