import path from 'path';
import { isPathInside } from '../main/worker/pathSafety';

describe('worker path containment', () => {
  const root = path.resolve('safe-root');

  it('accepts the root and its descendants', () => {
    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(root, path.join(root, 'child', 'file.txt'))).toBe(true);
  });

  it('rejects a sibling whose name starts with the root name', () => {
    expect(isPathInside(root, `${root}-sibling`)).toBe(false);
  });
});
