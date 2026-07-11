import { readFileSync } from 'fs';
import path from 'path';
import packageManifest from '../../package.json';

describe('release quality gate', () => {
  it('defines one local verification command using existing project checks', () => {
    expect(packageManifest.scripts.verify).toBe(
      'npm test -- --runInBand && npm run typecheck && npm run lint',
    );
  });

  it.each([
    ['build-windows:', 'build-macos:'],
    ['build-macos:', 'build-linux:'],
    ['build-linux:', 'release:'],
  ])('runs verification before packaging in %s', (jobName, nextJobName) => {
      const workflow = readFileSync(
        path.resolve('.github', 'workflows', 'main.yml'),
        'utf8',
      );
      const jobStart = workflow.indexOf(`  ${jobName}`);
      const nextJob = workflow.indexOf(`\n  ${nextJobName}`, jobStart + 1);
      const job = workflow.slice(jobStart, nextJob);

      expect(jobStart).toBeGreaterThanOrEqual(0);
      expect(job.indexOf('run: npm run verify')).toBeGreaterThanOrEqual(0);
      expect(job.indexOf('run: npm run verify')).toBeLessThan(
        job.indexOf('run: npm run package'),
      );
    });
});
