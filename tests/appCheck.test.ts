import { describe, expect, it } from 'vitest';

import { planAppCheck, startAppCheck } from '@/services/appCheck';

describe('App Check plan (Phase 11B)', () => {
  it('does nothing without a site key: the current state, so nothing changes for anyone', () => {
    for (const siteKey of [undefined, '', '   ']) expect(planAppCheck({ siteKey, dev: false })).toEqual({ enabled: false, reason: 'no site key configured' });
    expect(planAppCheck({ siteKey: undefined, dev: true, debugToken: 'abc' }).enabled).toBe(false);
  });

  it('uses reCAPTCHA Enterprise by default, and v3 when asked', () => {
    expect(planAppCheck({ siteKey: 'KEY', dev: false })).toMatchObject({ enabled: true, provider: 'enterprise', siteKey: 'KEY' });
    expect(planAppCheck({ siteKey: 'KEY', provider: 'v3', dev: false })).toMatchObject({ provider: 'v3' });
    expect(planAppCheck({ siteKey: 'KEY', provider: ' V3 ', dev: false })).toMatchObject({ provider: 'v3' });
  });

  it('refuses an unknown provider instead of guessing', () => {
    expect(planAppCheck({ siteKey: 'KEY', provider: 'recaptcha', dev: false })).toEqual({ enabled: false, reason: 'unknown provider "recaptcha" (use "enterprise" or "v3")' });
  });

  it('the debug provider exists in development only: a token, or an SDK-generated one', () => {
    expect(planAppCheck({ siteKey: 'KEY', dev: true, debugToken: 'tok-123' })).toMatchObject({ debugToken: 'tok-123' });
    expect(planAppCheck({ siteKey: 'KEY', dev: true })).toMatchObject({ debugToken: true });
    expect(planAppCheck({ siteKey: 'KEY', dev: true, debugToken: '  ' })).toMatchObject({ debugToken: true });
  });

  it('a production build ignores a debug token even if one is set', () => {
    expect(planAppCheck({ siteKey: 'KEY', dev: false, debugToken: 'tok-123' })).toMatchObject({ enabled: true, debugToken: null });
  });

  it('start does nothing (and sets nothing) when disabled, and never throws when the SDK cannot start', () => {
    const win: { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean } = {};
    expect(startAppCheck({} as never, { dev: true }, win)).toBeNull();
    expect(win.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
    // an invalid app object makes the SDK throw: it must be swallowed (sign-in must not depend on App Check while it is not enforced)
    expect(() => startAppCheck({} as never, { siteKey: 'KEY', dev: true, debugToken: 'tok' }, win)).not.toThrow();
    expect(win.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe('tok');
    const prod: { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean } = {};
    expect(() => startAppCheck({} as never, { siteKey: 'KEY', dev: false, debugToken: 'tok' }, prod)).not.toThrow();
    expect(prod.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });
});
