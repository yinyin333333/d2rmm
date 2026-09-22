export async function fetchUpdate(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const { app, net } = await import('electron');
  await app.whenReady();
  options.signal?.throwIfAborted();
  return net.fetch(url, options);
}

function safeText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
      try {
        return new URL(url).origin;
      } catch {
        return '[URL]';
      }
    })
    .replace(
      /(authorization|proxy-authorization|cookie|token|secret|password)\s*[:=]\s*[^\r\n]+/gi,
      '$1=[redacted]',
    )
    .slice(0, 2000);
}

export function updateFailure(error: unknown, context: string): Error {
  const seen = new Set<unknown>();
  const lines: string[] = [];
  const visit = (value: unknown, label: string, depth: number) => {
    if (depth > 6 || lines.length >= 24) return;
    if (value == null || typeof value !== 'object') {
      lines.push(`${label}${safeText(value) || 'Unknown error'}`);
      return;
    }
    if (seen.has(value)) {
      lines.push(`${label}[circular error]`);
      return;
    }
    seen.add(value);
    const read = (key: string): unknown => {
      try {
        return (value as Record<string, unknown>)[key];
      } catch {
        return undefined;
      }
    };
    const code = safeText(read('code'));
    lines.push(
      `${label}${safeText(read('name')) || 'Error'}${code ? ` [${code}]` : ''}: ${safeText(read('message')) || 'Unknown error'}`,
    );
    const cause = read('cause');
    if (cause !== undefined) visit(cause, 'cause: ', depth + 1);
    const errors = read('errors');
    try {
      if (Array.isArray(errors))
        errors
          .slice(0, 8)
          .forEach((child) => visit(child, 'error: ', depth + 1));
    } catch {
      lines.push('error: [unreadable aggregate errors]');
    }
  };
  visit(error, '', 0);
  return new Error(`${context}\n${lines.join('\n')}`);
}
