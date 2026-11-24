import { describe, expect, it } from 'vitest';

import { PRIVACY_POLICY, SUPPORT_EMAIL, WEB_REMINDERS_NOTE, backupSheetCopy, supportContact, validSupportEmail } from '@/domain/settingsContent';

describe('support contact (never invented)', () => {
  it('nothing is configured in the test build, so no address is shown', () => expect(SUPPORT_EMAIL).toBe(''));

  it.each(['help@example.com', 'a.b+c@sub.example.org', '  support@example.com  '])('accepts the address %j', (v) => expect(validSupportEmail(v)).toBe(v.trim()));
  it.each([undefined, '', '   ', 'support', 'a@b', '@example.com', 'a b@example.com', 'a@@example.com', '<x@example.com>', 'javascript:alert(1)', `${'a'.repeat(260)}@example.com`])('rejects %j', (v) => expect(validSupportEmail(v)).toBe(''));

  it('with an address, the row shows it and opens a mail link', () => {
    expect(supportContact('help@example.com')).toEqual({ sub: 'help@example.com', href: 'mailto:help@example.com', message: null });
  });

  it('without one it says so truthfully: no link, no promise, no made-up address', () => {
    const c = supportContact('');
    expect(c.href).toBeNull();
    expect(c.sub).toBe('No support address yet');
    expect(c.message).toMatch(/hasn't been set up yet/);
    expect(`${c.sub} ${c.message}`).not.toMatch(/@|soon|we will|we'll|contact us at/i);
  });

  it('the default uses the configured value (none here)', () => expect(supportContact().href).toBeNull());
});

describe('"Back Up Your Progress" copy', () => {
  it('while guest import is off it explains the account and never promises that guest habits move', () => {
    const c = backupSheetCopy(false);
    expect(c.intro).toMatch(/Firebase/);
    expect(c.intro).toMatch(/any device/);
    // nothing that suggests the guest habits will be imported, migrated or backed up
    expect(`${c.intro} ${c.detail}`).not.toMatch(/import|migrat|choose which habits|can be saved to your account|their history|back(ed)? up/i);
    expect(c.detail).toMatch(/stay here and are not moved/);
    expect(c.detail).toMatch(/Habits you create while signed in are saved/);
  });

  it('with import on (development builds only) it keeps the Kotlin wording', () => {
    const c = backupSheetCopy(true);
    expect(c.intro).toMatch(/habits and their history can be saved/);
    expect(c.detail).toMatch(/choose which habits to import/);
  });
});

describe('web reminders note', () => {
  it('is one plain statement', () => expect(WEB_REMINDERS_NOTE).toBe("Reminders aren't available on the web yet."));
});

describe('privacy policy (web accuracy)', () => {
  const text = PRIVACY_POLICY.map(([t, b]) => `${t}\n${b}`).join('\n\n');
  const body = (title: string) => PRIVACY_POLICY.find(([t]) => t === title)?.[1] ?? '';

  it('keeps the six sections and their order', () => {
    expect(PRIVACY_POLICY.map(([t]) => t)).toEqual(['What we store', 'Stored only on this device', 'Guest mode', 'Services we use', "What we don't do", 'Deleting your data']);
  });
  it('describes the web, not Android: no "Skip for Now", no "scheduled by Android", no uninstall wording', () => {
    expect(text).not.toMatch(/Skip for Now|shown locally by Android|uninstall/i);
    expect(body('Guest mode')).toMatch(/Continue as Guest/);
    expect(body('Guest mode')).toMatch(/browser/);
  });
  it('says plainly that the web app sends no reminders', () => expect(body('Stored only on this device')).toMatch(/does not send reminders or notifications/));
  it('lists calendar notes among the data it stores', () => expect(body('What we store')).toMatch(/Calendar notes/));
  it('the deletion promise is true: Settings > Delete Account, password, notes included, guest data separate', () => {
    const d = body('Deleting your data');
    expect(d).toMatch(/Settings → Delete Account/);
    expect(d).toMatch(/password/);
    expect(d).toMatch(/calendar notes included/);
    expect(d).toMatch(/Guest data on this device is not part of your account/);
  });
  it('promises nothing the web does not have: no support address is claimed', () => expect(text).not.toMatch(/@[a-z0-9-]+\./i));
});
