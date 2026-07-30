import { describe, expect, it } from 'vitest';
import { ms365TokenUrl } from './ms365-oauth';

describe('ms365TokenUrl', () => {
  it('baut die Adresse zum Token-Endpunkt', () => {
    expect(ms365TokenUrl('contoso.onmicrosoft.com')).toBe(
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
    );
  });

  it('nimmt eine abweichende Autorität an (Behörden-Cloud, Testserver)', () => {
    expect(ms365TokenUrl('abc', 'https://login.example.test/')).toBe(
      'https://login.example.test/abc/oauth2/v2.0/token',
    );
  });

  it('kodiert Sonderzeichen in der Tenant-ID', () => {
    expect(ms365TokenUrl('tenant mit leerzeichen')).toBe(
      'https://login.microsoftonline.com/tenant%20mit%20leerzeichen/oauth2/v2.0/token',
    );
  });
});
