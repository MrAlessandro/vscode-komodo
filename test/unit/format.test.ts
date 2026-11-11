import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatContainerLog,
  formatDuration,
  formatGb,
  formatPercent,
  formatRate,
  formatUpdate,
  memoryUsed,
  operationLabel,
  parseExitCode,
  parseHealth,
  percent,
  relativeTime,
  shortStatus,
  stripAnsi,
} from '../../src/model/format';
import { update } from './fixtures';

describe('number formatting', () => {
  it('formats percentages', () => {
    expect(formatPercent(undefined)).toBe('–');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.42)).toBe('0.4%');
    expect(formatPercent(9.94)).toBe('9.9%');
    expect(formatPercent(54.6)).toBe('55%');
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBeUndefined();
  });

  it('formats sizes and rates', () => {
    expect(formatGb(0.5)).toBe('512 MB');
    expect(formatGb(3.7)).toBe('3.7 GB');
    expect(formatGb(250)).toBe('250 GB');
    expect(formatGb(2048)).toBe('2.0 TB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_390_165)).toBe('1.3 MB');
    expect(formatRate(2048)).toBe('2.0 KB/s');
  });

  it('formats durations and relative times', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(12_340)).toBe('12.3s');
    expect(formatDuration(125_000)).toBe('2m 05s');
    const now = 1_700_000_000_000;
    expect(relativeTime(now - 2_000, now)).toBe('just now');
    expect(relativeTime(now - 42_000, now)).toBe('42s ago');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('docker status parsing', () => {
  it('extracts the health from the status', () => {
    expect(parseHealth('Up 2 weeks (healthy)')).toBe('healthy');
    expect(parseHealth('Up 4 weeks (unhealthy)')).toBe('unhealthy');
    expect(parseHealth('Up 3 seconds (health: starting)')).toBe('starting');
    expect(parseHealth('Up 2 months')).toBeUndefined();
  });

  it('extracts exit codes', () => {
    expect(parseExitCode('Exited (255) 4 months ago')).toBe(255);
    expect(parseExitCode('Exited (0) 3 hours ago')).toBe(0);
    expect(parseExitCode('Up 2 weeks')).toBeUndefined();
  });

  it('shortens docker strings', () => {
    expect(memoryUsed('1.016GiB / 3.747GiB')).toBe('1.016GiB');
    expect(memoryUsed(undefined)).toBeUndefined();
    expect(shortStatus('Up 2 weeks (healthy)')).toBe('up 2 weeks (healthy)');
  });
});

describe('text', () => {
  it('labels operations', () => {
    expect(operationLabel('DeployStackIfChanged')).toBe('Deploy Stack If Changed');
    expect(operationLabel('GlobalAutoUpdate')).toBe('Global Auto Update');
  });

  it('strips ANSI escape codes', () => {
    expect(stripAnsi('\u001b[32mINFO\u001b[0m started \u001b]0;title\u0007ok')).toBe('INFO started ok');
  });

  it('renders update logs', () => {
    const text = formatUpdate(update(), 'stack “shop”');
    expect(text).toContain('Restart Stack · stack “shop”');
    expect(text).toContain('✔ Success');
    expect(text).toContain('Duration 4.5s');
    expect(text).toContain('━━ Compose Restart ✔ (4.3s)');
    expect(text).toContain('$ docker compose -p shop restart');
    expect(text).toContain('Container shop-backend-1  Started');
  });

  it('renders container logs and surfaces failures', () => {
    const ok = { stage: 'log', command: 'docker logs x', stdout: 'a\nb\n', stderr: '', success: true, start_ts: 0, end_ts: 0 };
    expect(formatContainerLog(ok)).toBe('a\nb\n');
    const failed = { ...ok, stdout: '', stderr: 'no such container', success: false };
    expect(formatContainerLog(failed)).toContain('failed');
    expect(formatContainerLog(failed)).toContain('no such container');
  });
});
