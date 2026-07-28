import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  discoveryUrl,
  domainAllowed,
  emailFromClaims,
  expectedIssuer,
  nameFromClaims,
  parseDomainList,
} from './entra';
import { challengeFor, createPkcePair, createRandomToken } from './pkce';

describe('discoveryUrl', () => {
  it('baut die Adresse zum Erkennungsdokument', () => {
    expect(discoveryUrl('contoso.onmicrosoft.com')).toBe(
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0/.well-known/openid-configuration',
    );
  });

  it('nimmt eine abweichende Autorität an (Behörden-Cloud, Testserver)', () => {
    expect(discoveryUrl('abc', 'https://login.example.test/')).toBe(
      'https://login.example.test/abc/v2.0/.well-known/openid-configuration',
    );
  });
});

describe('buildAuthorizeUrl', () => {
  const basis = {
    authorizationEndpoint: 'https://login.microsoftonline.com/t/oauth2/v2.0/authorize',
    clientId: 'client-1',
    redirectUri: 'https://klappe.example.org/v1/auth/microsoft/callback',
    state: 'zustand',
    nonce: 'einmal',
    codeChallenge: 'abzweig',
  };

  it('setzt alle Pflichtangaben des Code-Flusses', () => {
    const url = new URL(buildAuthorizeUrl(basis));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(basis.redirectUri);
    expect(url.searchParams.get('state')).toBe('zustand');
    expect(url.searchParams.get('nonce')).toBe('einmal');
  });

  it('verlangt PKCE mit S256', () => {
    const url = new URL(buildAuthorizeUrl(basis));
    expect(url.searchParams.get('code_challenge')).toBe('abzweig');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('fordert die Bereiche an, die Name und Adresse liefern', () => {
    const url = new URL(buildAuthorizeUrl(basis));
    expect(url.searchParams.get('scope')).toBe('openid profile email');
  });

  it('reicht einen Anmeldevorschlag durch, lässt ihn sonst weg', () => {
    expect(new URL(buildAuthorizeUrl({ ...basis, loginHint: 'a@b.de' })).searchParams.get('login_hint')).toBe(
      'a@b.de',
    );
    expect(new URL(buildAuthorizeUrl(basis)).searchParams.has('login_hint')).toBe(false);
  });
});

describe('expectedIssuer', () => {
  it('lässt einen festen Aussteller unangetastet', () => {
    const fest = 'https://login.microsoftonline.com/abc/v2.0';
    expect(expectedIssuer(fest, 'xyz')).toBe(fest);
  });

  it('setzt den Tenant aus dem Token in den Platzhalter ein', () => {
    expect(
      expectedIssuer('https://login.microsoftonline.com/{tenantid}/v2.0', 'tenant-7'),
    ).toBe('https://login.microsoftonline.com/tenant-7/v2.0');
  });

  it('lässt den Platzhalter stehen, wenn das Token keinen Tenant nennt – die Prüfung schlägt dann fehl', () => {
    expect(expectedIssuer('https://x/{tenantid}/v2.0', null)).toBe('https://x/{tenantid}/v2.0');
  });
});

describe('emailFromClaims', () => {
  it('nimmt zuerst email', () => {
    expect(
      emailFromClaims({ email: 'A@THD.de', preferred_username: 'b@thd.de', upn: 'c@thd.de' }),
    ).toBe('a@thd.de');
  });

  it('weicht auf preferred_username aus', () => {
    expect(emailFromClaims({ preferred_username: 'b@thd.de' })).toBe('b@thd.de');
  });

  it('weicht zuletzt auf upn aus', () => {
    expect(emailFromClaims({ upn: 'c@thd.de' })).toBe('c@thd.de');
  });

  it('ignoriert Werte ohne @ – preferred_username darf auch ein Anmeldename sein', () => {
    expect(emailFromClaims({ preferred_username: 'anna', upn: 'anna@thd.de' })).toBe('anna@thd.de');
    expect(emailFromClaims({ preferred_username: 'anna' })).toBeNull();
  });

  it('meldet null, wenn gar keine Adresse dabei ist', () => {
    expect(emailFromClaims({ name: 'Anna' })).toBeNull();
  });
});

describe('nameFromClaims', () => {
  it('nimmt den Namen aus dem Token', () => {
    expect(nameFromClaims({ name: 'Anna Meier' }, 'a@b.de')).toBe('Anna Meier');
  });

  it('baut sonst einen Namen aus der Adresse', () => {
    expect(nameFromClaims({}, 'anna.meier@thd.de')).toBe('Anna Meier');
    expect(nameFromClaims({}, 'anna_meier@thd.de')).toBe('Anna Meier');
  });

  it('behält die Adresse, wenn sich nichts Besseres bauen lässt', () => {
    expect(nameFromClaims({}, '@thd.de')).toBe('@thd.de');
  });
});

describe('domainAllowed', () => {
  it('erlaubt alles, solange keine Domäne eingetragen ist', () => {
    expect(domainAllowed('irgendwer@fremd.de', [])).toBe(true);
  });

  it('lässt eingetragene Domänen durch', () => {
    expect(domainAllowed('anna@thd.de', ['thd.de', 'beispiel.org'])).toBe(true);
  });

  it('weist fremde Domänen ab', () => {
    expect(domainAllowed('anna@fremd.de', ['thd.de'])).toBe(false);
  });

  it('achtet nicht auf Groß- und Kleinschreibung', () => {
    expect(domainAllowed('anna@THD.de', ['thd.de'])).toBe(true);
  });

  it('lässt sich nicht mit einer Sub-Domäne austricksen', () => {
    expect(domainAllowed('anna@böse-thd.de', ['thd.de'])).toBe(false);
    expect(domainAllowed('anna@thd.de.fremd.de', ['thd.de'])).toBe(false);
  });
});

describe('parseDomainList', () => {
  it('trennt an Komma, Semikolon und Leerraum', () => {
    expect(parseDomainList('thd.de, @beispiel.org; dritte.de')).toEqual([
      'thd.de',
      'beispiel.org',
      'dritte.de',
    ]);
  });

  it('macht aus leerer Eingabe eine leere Liste', () => {
    expect(parseDomainList('')).toEqual([]);
    expect(parseDomainList(null)).toEqual([]);
    expect(parseDomainList('  ,  ')).toEqual([]);
  });
});

describe('PKCE', () => {
  it('Challenge ist der SHA-256-Abdruck des Verifiers', () => {
    const { verifier, challenge } = createPkcePair();
    expect(challengeFor(verifier)).toBe(challenge);
  });

  it('erzeugt bei jedem Aufruf ein neues Paar', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });

  it('bleibt in der URL-tauglichen Zeichenmenge', () => {
    expect(createPkcePair().verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(createRandomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('liefert einen ausreichend langen Verifier (43–128 Zeichen laut RFC)', () => {
    const { verifier } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });
});
