import { URL } from 'url';

export type NxmProtocolDelivery =
  | {
      eventID: 'nexus-mods-open-url';
      payload: {
        expires: number | null;
        key: string | null;
        nexusFileID: number;
        nexusModID: string;
      };
    }
  | {
      eventID: 'nexus-mods-open-collection-url';
      payload: {
        collectionSlug: string;
        revisionNumber: number;
      };
    };

export type NxmProtocolSend = (
  eventID: NxmProtocolDelivery['eventID'],
  payload: NxmProtocolDelivery['payload'],
) => Promise<void> | void;

function parsePositiveSafeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodePathSegments(pathname: string): string[] | null {
  const rawSegments = pathname.split('/');
  if (rawSegments.shift() !== '') return null;
  try {
    const segments = rawSegments.map((segment) => decodeURIComponent(segment));
    return segments.some(
      (segment) =>
        segment.includes('/') ||
        segment.includes('\\') ||
        segment.includes('\0'),
    )
      ? null
      : segments;
  } catch {
    return null;
  }
}

export function parseNxmProtocolUrl(url: string): NxmProtocolDelivery | null {
  if (url.trim() !== url) return null;
  try {
    decodeURIComponent(url);
  } catch {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'nxm:' ||
    parsed.hostname !== 'diablo2resurrected' ||
    parsed.host !== 'diablo2resurrected' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    return null;
  }

  const segments = decodePathSegments(parsed.pathname);
  if (segments == null || segments.length !== 4) return null;

  if (segments[0] === 'mods' && segments[2] === 'files') {
    const nexusModID = parsePositiveSafeInteger(segments[1]);
    const nexusFileID = parsePositiveSafeInteger(segments[3]);
    if (nexusModID == null || nexusFileID == null) return null;

    const expiresValues = parsed.searchParams.getAll('expires');
    let expires: number | null = null;
    if (expiresValues.length > 1) return null;
    if (expiresValues.length === 1) {
      expires = parsePositiveSafeInteger(expiresValues[0]);
      if (expires == null) return null;
    }
    return {
      eventID: 'nexus-mods-open-url',
      payload: {
        expires,
        key: parsed.searchParams.get('key'),
        nexusFileID,
        nexusModID: String(nexusModID),
      },
    };
  }

  if (segments[0] === 'collections' && segments[2] === 'revisions') {
    const collectionSlug = segments[1];
    const revisionNumber = parsePositiveSafeInteger(segments[3]);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(collectionSlug) ||
      revisionNumber == null
    ) {
      return null;
    }
    return {
      eventID: 'nexus-mods-open-collection-url',
      payload: { collectionSlug, revisionNumber },
    };
  }

  return null;
}

export class NxmProtocolQueue {
  private readonly pending: NxmProtocolDelivery[] = [];
  private isRendererReady = false;

  public constructor(
    private readonly send: NxmProtocolSend,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  public enqueue(url: string): boolean {
    const delivery = parseNxmProtocolUrl(url);
    if (delivery == null) return false;
    if (this.isRendererReady) {
      void this.dispatch(delivery);
    } else {
      this.pending.push(delivery);
    }
    return true;
  }

  public markRendererUnavailable(): void {
    this.isRendererReady = false;
  }

  public async markRendererReady(): Promise<void> {
    if (this.isRendererReady) return;
    this.isRendererReady = true;
    const pending = this.pending.splice(0);
    await Promise.all(pending.map((delivery) => this.dispatch(delivery)));
  }

  private async dispatch(delivery: NxmProtocolDelivery): Promise<void> {
    try {
      await this.send(delivery.eventID, delivery.payload);
    } catch (error) {
      this.onError(error);
    }
  }
}
