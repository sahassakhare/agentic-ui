import { describe, expect, it } from 'vitest';
import { dockerArgs, BUILD_SCRIPT, type DockerOptions } from './build-runner.js';

const opts: DockerOptions = { image: 'node:20-bookworm', memory: '4g', cpus: '2', pidsLimit: 512, network: 'bridge', readOnlyRoot: true };

describe('dockerArgs', () => {
  const args = dockerArgs('/work/dir/kendo', 'kendo-buttons', opts);
  const joined = args.join(' ');

  it('is an ephemeral, cap-dropped, resource-capped container', () => {
    expect(joined).toContain('run --rm');
    expect(joined).toContain('--cap-drop ALL');
    expect(joined).toContain('--security-opt no-new-privileges');
    expect(joined).toContain('--memory 4g');
    expect(joined).toContain('--cpus 2');
    expect(joined).toContain('--pids-limit 512');
  });
  it('mounts only the workspace and keeps writes inside it', () => {
    expect(joined).toContain('-v /work/dir/kendo:/work');
    expect(joined).toContain('-w /work');
    expect(joined).toContain('-e HOME=/work');
    expect(joined).toContain('-e npm_config_cache=/work/.npm');
  });
  it('applies a read-only rootfs with a tmpfs when requested', () => {
    expect(joined).toContain('--read-only');
    expect(joined).toContain('--tmpfs /tmp:rw,exec');
    expect(dockerArgs('/w', 'r', { ...opts, readOnlyRoot: false }).join(' ')).not.toContain('--read-only');
  });
  it('runs the install+build script for the remote', () => {
    expect(args[args.length - 3]).toBe('sh');
    expect(args[args.length - 2]).toBe('-lc');
    expect(args[args.length - 1]).toBe(BUILD_SCRIPT('kendo-buttons'));
    expect(BUILD_SCRIPT('kendo-buttons')).toContain('ng build kendo-buttons');
    expect(BUILD_SCRIPT('kendo-buttons')).not.toContain('--configuration');   // native-federation build target has no prod config
  });
  it('supports a network-none (pre-fetched) mode', () => {
    expect(dockerArgs('/w', 'r', { ...opts, network: 'none' }).join(' ')).toContain('--network none');
  });
});
