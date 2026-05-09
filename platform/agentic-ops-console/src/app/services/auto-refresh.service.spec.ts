import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AutoRefreshService } from './auto-refresh.service';

describe('AutoRefreshService', () => {
  let svc: AutoRefreshService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(AutoRefreshService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts ticking immediately on construction', () => {
    const ticker = vi.fn();
    svc.register(ticker);
    vi.advanceTimersByTime(8000);
    expect(ticker).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(8000);
    expect(ticker).toHaveBeenCalledTimes(2);
  });

  it('multiple subscribers all get ticked', () => {
    const a = vi.fn();
    const b = vi.fn();
    svc.register(a);
    svc.register(b);
    vi.advanceTimersByTime(8000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unregister removes the ticker', () => {
    const ticker = vi.fn();
    const unregister = svc.register(ticker);
    vi.advanceTimersByTime(8000);
    expect(ticker).toHaveBeenCalledTimes(1);
    unregister();
    vi.advanceTimersByTime(8000);
    expect(ticker).toHaveBeenCalledTimes(1);
  });

  it('disabled flag pauses ticking globally', () => {
    const ticker = vi.fn();
    svc.register(ticker);
    svc.setEnabled(false);
    vi.advanceTimersByTime(8000);
    expect(ticker).not.toHaveBeenCalled();
    expect(svc.running()).toBe(false);
    svc.setEnabled(true);
    vi.advanceTimersByTime(8000);
    expect(ticker).toHaveBeenCalledTimes(1);
    expect(svc.running()).toBe(true);
  });

  it('one ticker throwing does not break the others', () => {
    const a = vi.fn(() => { throw new Error('boom'); });
    const b = vi.fn();
    svc.register(a);
    svc.register(b);
    vi.advanceTimersByTime(8000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('setIntervalMs reschedules to the new cadence', () => {
    const ticker = vi.fn();
    svc.register(ticker);
    svc.setIntervalMs(2000);
    vi.advanceTimersByTime(2000);
    expect(ticker).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(ticker).toHaveBeenCalledTimes(2);
  });

  it('rejects setIntervalMs values below 1s', () => {
    const before = svc.intervalMs();
    svc.setIntervalMs(500);
    expect(svc.intervalMs()).toBe(before);
  });
});
