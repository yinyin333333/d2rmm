import ModUpdaterAPI from 'renderer/ModUpdaterAPI';
import {
  INexusAuthState,
  ISetNexusAuthState,
} from 'renderer/react/context/NexusModsContext';
import deferUntilAfterFirstPaint from 'renderer/utils/deferUntilAfterFirstPaint';
import { startupMark, startupMeasure } from 'shared/startupProfiler';
import { useCallback, useEffect } from 'react';

export default function useValidateNexusModsApiKey(
  authState: INexusAuthState,
  setAuthState: ISetNexusAuthState,
): () => void {
  const apiKey = authState.apiKey;

  const validateKey = useCallback(() => {
    if (apiKey == null) {
      startupMark('renderer', 'Nexus API key validation skipped');
      return;
    }
    startupMeasure('renderer', 'Nexus API key validation', () =>
      ModUpdaterAPI.validateNexusApiKey(apiKey),
    )
      .then(({ name, email, isValid, isPremium }) => {
        startupMark(
          'renderer',
          `Nexus API key validation completed: ${String(isValid)}`,
        );
        if (!isValid) {
          console.warn(
            `Nexus Mods auth session is invalid. Please log in again.`,
          );
          setAuthState({ apiKey: null });
        } else {
          setAuthState((oldAuthState) => ({
            ...oldAuthState,
            name,
            email,
            isPremium,
          }));
        }
      })
      .catch(console.error);
  }, [apiKey, setAuthState]);

  useEffect(() => {
    startupMark(
      'renderer',
      'Nexus API key validation scheduled after first paint',
    );
    const cancel = deferUntilAfterFirstPaint(() => {
      startupMark('renderer', 'Nexus API key validation deferred start');
      validateKey();
    });
    return cancel;
  }, [validateKey]);

  return validateKey;
}
