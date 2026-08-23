import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { StarterGalleryComponent } from './starter-gallery.component';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { STARTER_TEMPLATES, type StarterTemplate } from '../starters';

type Testable = {
  groups: () => ReadonlyArray<{ kind: string }>;
  use: (t: StarterTemplate) => void;
};

describe('StarterGalleryComponent', () => {
  let create: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  function make(): Testable {
    create = vi.fn((input: Record<string, unknown>) => of({ id: 'new-id', ...input }));
    navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: CapabilityCatalogService, useValue: { create } },
        { provide: Router, useValue: { navigate } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    return TestBed.createComponent(StarterGalleryComponent).componentInstance as unknown as Testable;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('groups templates by kind', () => {
    const kinds = make().groups().map((g) => g.kind);
    expect(kinds).toContain('form');
    expect(kinds).toContain('page');
  });

  it('use() clones the template into a draft and navigates to its designer', () => {
    const c = make();
    const t = STARTER_TEMPLATES.find((x) => x.kind === 'form')!;
    c.use(t);
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as { kind: string; name: string; tags: string[] };
    expect(arg.kind).toBe('form');
    expect(arg.name).toContain(t.nameBase);
    expect(arg.tags).toContain('starter');
    expect(navigate).toHaveBeenCalledWith(['/', 'forms', 'new-id', 'design']);
  });
});
