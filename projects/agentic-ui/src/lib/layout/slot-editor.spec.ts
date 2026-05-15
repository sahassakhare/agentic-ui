import { describe, expect, it } from 'vitest';
import { slotEdits } from './slot-editor';
import type { SlotDef } from './types';

const docPreview: SlotDef = { component: 'documentPreview' };
const tagPanel: SlotDef = { component: 'tagPanel' };
const footer: SlotDef = { component: 'chainOfCustody' };

describe('slotEdits.add', () => {
  it('adds a slot to an empty map', () => {
    const result = slotEdits.add(null, 'primary', docPreview);
    expect(result).toEqual({ primary: docPreview });
  });

  it('preserves existing slots', () => {
    const base = { primary: docPreview };
    const result = slotEdits.add(base, 'sidebar', tagPanel);
    expect(result).toEqual({ primary: docPreview, sidebar: tagPanel });
  });

  it('is a no-op when slot already exists (returns same reference)', () => {
    const base = { primary: docPreview };
    const result = slotEdits.add(base, 'primary', tagPanel);
    expect(result).toBe(base);
  });
});

describe('slotEdits.remove', () => {
  it('drops the named slot', () => {
    const base = { primary: docPreview, sidebar: tagPanel };
    const result = slotEdits.remove(base, 'sidebar');
    expect(result).toEqual({ primary: docPreview });
  });

  it('is a no-op when slot does not exist', () => {
    const base = { primary: docPreview };
    const result = slotEdits.remove(base, 'sidebar');
    expect(result).toBe(base);
  });

  it('returns empty when input is null', () => {
    expect(slotEdits.remove(null, 'primary')).toEqual({});
  });
});

describe('slotEdits.replace', () => {
  it('overwrites when slot exists', () => {
    const base = { primary: docPreview };
    const result = slotEdits.replace(base, 'primary', tagPanel);
    expect(result).toEqual({ primary: tagPanel });
  });

  it('inserts when slot does not exist (equivalent to add)', () => {
    const base = { primary: docPreview };
    const result = slotEdits.replace(base, 'sidebar', tagPanel);
    expect(result).toEqual({ primary: docPreview, sidebar: tagPanel });
  });
});

describe('slotEdits.merge', () => {
  it('applies evictions THEN additions', () => {
    const base = { primary: docPreview, sidebar: tagPanel };
    const result = slotEdits.merge(base, { footer }, ['sidebar']);
    expect(result).toEqual({ primary: docPreview, footer });
  });

  it('handles empty additions + empty evictions', () => {
    const base = { primary: docPreview };
    const result = slotEdits.merge(base, {}, []);
    // No changes — but a new reference is produced when additions
    // contains keys (current impl returns the input for no-op).
    expect(result).toEqual(base);
  });

  it('starts from null base + adds slots', () => {
    const result = slotEdits.merge(null, { primary: docPreview, footer });
    expect(result).toEqual({ primary: docPreview, footer });
  });
});
