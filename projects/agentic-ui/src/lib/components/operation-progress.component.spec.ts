import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { OperationRegistry } from '../internal';
import { OperationProgressComponent } from './operation-progress.component';

describe('OperationProgressComponent (Capability F5)', () => {
  let registry: OperationRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(OperationRegistry);
    registry.clear();
  });

  it('renders the missing-op placeholder when the id is unknown', () => {
    const fixture = TestBed.createComponent(OperationProgressComponent);
    fixture.componentRef.setInput('opId', 'never-registered');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.missing')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.op')).toBeNull();
  });

  it('renders the started state with progress bar at 0%', () => {
    const opId = registry.start({ toolName: 'runTAR', description: 'TAR pass' });
    const fixture = TestBed.createComponent(OperationProgressComponent);
    fixture.componentRef.setInput('opId', opId);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.op[data-status="started"]')).toBeTruthy();
    const bar = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('updates reactively as reportProgress fires', () => {
    const opId = registry.start({ toolName: 'runTAR', description: 'TAR' });
    const fixture = TestBed.createComponent(OperationProgressComponent);
    fixture.componentRef.setInput('opId', opId);
    fixture.detectChanges();

    registry.reportProgress(opId, { pct: 42, phase: 'scoring batch 8/20' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.op[data-status="progress"]')).toBeTruthy();
    const status = fixture.nativeElement.querySelector('.status-line') as HTMLElement;
    expect(status.textContent).toContain('42%');
    expect(status.textContent).toContain('scoring batch 8/20');
    const bar = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });

  it('renders terminal-success with duration', () => {
    const opId = registry.start({ toolName: 'runTAR', description: 'TAR' });
    registry.complete(opId, { scored: 50000 });
    const fixture = TestBed.createComponent(OperationProgressComponent);
    fixture.componentRef.setInput('opId', opId);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.op[data-status="finished"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.status-line.ok')?.textContent).toContain('Completed');
  });

  it('renders terminal-failure with code + message', () => {
    const opId = registry.start({ toolName: 'runTAR', description: 'TAR' });
    registry.fail(opId, { code: 'QUOTA_EXCEEDED', message: 'out of monthly tokens' });
    const fixture = TestBed.createComponent(OperationProgressComponent);
    fixture.componentRef.setInput('opId', opId);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.op[data-status="failed"]')).toBeTruthy();
    const err = fixture.nativeElement.querySelector('.status-line.error') as HTMLElement;
    expect(err.textContent).toContain('QUOTA_EXCEEDED');
    expect(err.textContent).toContain('out of monthly tokens');
  });
});
