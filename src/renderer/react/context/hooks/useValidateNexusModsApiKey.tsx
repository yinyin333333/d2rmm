import ModUpdaterAPI from 'renderer/ModUpdaterAPI';
import {
  INexusAuthState,
  ISetNexusAuthState,
} from 'renderer/react/context/NexusModsContext';
import deferUntilAfterFirstPaint from 'renderer/utils/deferUntilAfterFirstPaint';
import { startupMark, startupMeasure } from 'shared/startupProfiler';
import { useCallback, useEffect, useRef } from 'react';

export default function useValidateNexusModsApiKey(
  authState: INexusAuthState,
  setAuthState: ISetNexusAuthState,
): () => void {
  const apiKey = authState.apiKey;
  const latestApiKey = useRef(apiKey);
  const latestValidation = useRef(0);
  const isMounted = useRef(false);
  latestApiKey.current = apiKey;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const validateKey = useCallback(() => {
    if (apiKey == null) {
      startupMark('renderer', 'Nexus API key validation skipped');
      return;
    }
    const requestedApiKey = apiKey;
    const validation = latestValidation.current + 1;
    latestValidation.current = validation;
    startupMeasure('renderer', 'Nexus API key validation', () =>
      ModUpdaterAPI.validateNexusApiKey(requestedApiKey),
    )
      .then(({ name, email, isValid, isPremium }) => {
        startupMark(
          'renderer',
          `Nexus API key validation completed: ${String(isValid)}`,
        );
        if (
          !isMounted.current ||
          validation !== latestValidation.current ||
          latestApiKey.current !== requestedApiKey
        ) {
          return;
        }

        setAuthState((oldAuthState) => {
          if (
            !isMounted.current ||
            validation !== latestValidation.current ||
            oldAuthState.apiKey !== requestedApiKey
          ) {
            return oldAuthState;
          }
          if (!isValid) {
            console.warn(
              `Nexus Mods auth session is invalid. Please log in again.`,
            );
            return { apiKey: null };
          }
          return {
            ...oldAuthState,
            name,
            email,
            isPremium,
          };
        });
      })
      .catch((error) => {
        if (
          isMounted.current &&
          validation === latestValidation.current &&
          latestApiKey.current === requestedApiKey
        ) {
          console.error(error);
        }
      });
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
