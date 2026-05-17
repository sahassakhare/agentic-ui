import { describe, expect, it } from 'vitest';
import { satisfies, isValidSemver } from './semver-match';

describe('semver-match', () => {
  describe('isValidSemver', () => {
    it.each([
      ['1.0.0', true],
      ['1.2.3', true],
      ['10.20.30', true],
      ['0.0.0', true],
      ['1.0', false],
      ['1', false],
      ['v1.2.3', false],
      ['1.2.3-beta', false],
      ['1.2.3+build', false],
      ['', false],
      ['abc', false],
    ])('%s → %s', (input, expected) => {
      expect(isValidSemver(input)).toBe(expected);
    });
  });

  describe('satisfies — exact (= or implicit)', () => {
    it.each([
      ['1.2.3', '1.2.3', true],
      ['1.2.3', '=1.2.3', true],
      ['1.2.3', '1.2.4', false],
      ['1.2.3', '2.2.3', false],
      ['1.2.3', '1.3.3', false],
    ])('%s satisfies %s → %s', (v, range, expected) => {
      expect(satisfies(v, range)).toBe(expected);
    });
  });

  describe('satisfies — caret (^)', () => {
    it.each([
      ['1.2.3', '^1.0.0', true],
      ['1.2.3', '^1.2.0', true],
      ['1.2.3', '^1.2.3', true],
      ['1.5.10', '^1.0.0', true],
      ['2.0.0', '^1.0.0', false],
      ['0.9.0', '^1.0.0', false],
      ['1.1.0', '^1.2.0', false],  // version too low for compatible match
    ])('%s satisfies %s → %s', (v, range, expected) => {
      expect(satisfies(v, range)).toBe(expected);
    });
  });

  describe('satisfies — tilde (~)', () => {
    it.each([
      ['1.2.3', '~1.2.3', true],
      ['1.2.5', '~1.2.3', true],
      ['1.2.10', '~1.2.0', true],
      ['1.3.0', '~1.2.3', false],
      ['2.2.3', '~1.2.3', false],
      ['1.2.2', '~1.2.3', false],   // patch < target patch
    ])('%s satisfies %s → %s', (v, range, expected) => {
      expect(satisfies(v, range)).toBe(expected);
    });
  });

  describe('satisfies — comparison operators', () => {
    it.each([
      ['1.2.3', '>=1.2.3', true],
      ['1.2.4', '>=1.2.3', true],
      ['2.0.0', '>=1.2.3', true],
      ['1.2.2', '>=1.2.3', false],

      ['1.2.3', '>1.2.3', false],
      ['1.2.4', '>1.2.3', true],

      ['1.2.3', '<=1.2.3', true],
      ['1.2.2', '<=1.2.3', true],
      ['1.2.4', '<=1.2.3', false],

      ['1.2.3', '<2.0.0', true],
      ['1.9.99', '<2.0.0', true],
      ['2.0.0', '<2.0.0', false],
      ['2.0.1', '<2.0.0', false],
    ])('%s satisfies %s → %s', (v, range, expected) => {
      expect(satisfies(v, range)).toBe(expected);
    });
  });

  describe('satisfies — unsupported syntax returns false', () => {
    it.each([
      ['1.2.3', '>=1.0.0 <2.0.0'],   // compound range
      ['1.2.3', '^1 || ^2'],         // alternation
      ['1.2.3', '1.2.x'],            // x-range
      ['1.2.3', '1.x'],              // x-range
      ['1.2.3', 'latest'],           // dist-tag
      ['1.2.3', '1.2'],              // two-part
      ['1.2.3', ''],                 // empty
      ['1.2.3', '~1.2'],             // tilde with two parts
      ['', '^1.0.0'],                // invalid version
      ['abc', '^1.0.0'],             // garbage version
    ])('%s satisfies %s → false', (v, range) => {
      expect(satisfies(v, range)).toBe(false);
    });
  });
});
