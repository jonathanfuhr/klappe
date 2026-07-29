import { describe, expect, it } from 'vitest';
import {
  renderCommentDigestMail,
  renderCommentMail,
  renderGuestCodeMail,
  renderProjectFileMail,
  renderTestMail,
} from './templates';

const basis = {
  recipientName: 'Anna Meier',
  authorName: 'Jonathan Fuhr',
  projectName: 'THD Imagefilm',
  videoName: 'Schnittfassung',
  versionLabel: 'v2',
  timecode: '10:00:04:00',
  body: 'Ab hier wackelt die Kamera.',
  mentioned: false,
  isReply: false,
  url: 'https://klappe.example/videos/abc',
  unsubscribeUrl: 'https://klappe.example/abmelden?token=xyz',
};

describe('renderGuestCodeMail', () => {
  it('stellt den Code in den Betreff, damit er in der Vorschau lesbar ist', () => {
    const mail = renderGuestCodeMail({ code: '482913', targetName: 'Imagefilm', minutesValid: 15 });
    expect(mail.subject).toContain('482913');
    expect(mail.text).toContain('482913');
    expect(mail.html).toContain('482913');
  });

  it('nennt die Gültigkeitsdauer', () => {
    const mail = renderGuestCodeMail({ code: '000001', targetName: 'X', minutesValid: 15 });
    expect(mail.text).toContain('15 Minuten');
  });
});

describe('renderCommentMail', () => {
  it('unterscheidet Kommentar, Antwort und Erwähnung im Betreff', () => {
    expect(renderCommentMail(basis).subject).toContain('Neuer Kommentar');
    expect(renderCommentMail({ ...basis, isReply: true }).subject).toContain('Neue Antwort');
    expect(renderCommentMail({ ...basis, mentioned: true }).subject).toContain('erwähnt');
  });

  it('nennt Projekt, Fassung, Timecode und Text', () => {
    const mail = renderCommentMail(basis);
    for (const wert of ['THD Imagefilm', 'v2', '10:00:04:00', 'Ab hier wackelt die Kamera.']) {
      expect(mail.text).toContain(wert);
      expect(mail.html).toContain(wert);
    }
  });

  it('kommt ohne Timecode aus', () => {
    const mail = renderCommentMail({ ...basis, timecode: null });
    expect(mail.text).toContain('[ohne Zeitbezug]');
  });

  it('enthält den Link zum Player und zum Abbestellen', () => {
    const mail = renderCommentMail(basis);
    expect(mail.html).toContain(basis.url);
    expect(mail.html).toContain(basis.unsubscribeUrl);
    expect(mail.text).toContain(basis.unsubscribeUrl);
  });

  it('maskiert HTML aus dem Kommentartext', () => {
    const mail = renderCommentMail({
      ...basis,
      body: '<img src=x onerror="alert(1)">',
      authorName: 'Böse<script>',
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;img src=x');
  });

  it('maskiert auch Anführungszeichen in Links', () => {
    const mail = renderCommentMail({ ...basis, url: 'https://x.example/"onmouseover="alert(1)' });
    expect(mail.html).not.toContain('"onmouseover="');
  });
});

describe('renderCommentDigestMail', () => {
  const sammel = {
    recipientName: 'Anna Meier',
    projectName: 'THD Imagefilm',
    videoName: 'Schnittfassung',
    url: 'https://klappe.example/videos/abc',
    unsubscribeUrl: 'https://klappe.example/abmelden?token=xyz',
    entries: [
      {
        authorName: 'Jonathan Fuhr',
        versionLabel: 'v2',
        timecode: '10:00:04:00',
        body: 'Ab hier wackelt die Kamera.',
        mentioned: false,
      },
      {
        authorName: 'Jonathan Fuhr',
        versionLabel: 'v2',
        timecode: '10:00:12:03',
        body: 'Ton setzt zu spät ein.',
        mentioned: false,
      },
      {
        authorName: 'Kunde GmbH',
        versionLabel: 'v3',
        timecode: null,
        body: 'Sonst passt alles.',
        mentioned: false,
      },
    ],
  };

  it('zählt die Kommentare im Betreff', () => {
    expect(renderCommentDigestMail(sammel).subject).toBe(
      '3 neue Kommentare zu „Schnittfassung“',
    );
  });

  it('nennt jeden Autor genau einmal', () => {
    const mail = renderCommentDigestMail(sammel);
    expect(mail.text).toContain('Jonathan Fuhr und Kunde GmbH haben');
    // Im Fließtext steht der Name einmal, dazu je Kommentar in der Kopfzeile.
    expect(mail.text.match(/Jonathan Fuhr/g)).toHaveLength(3);
  });

  it('führt jeden Kommentar mit Fassung und Timecode auf', () => {
    const mail = renderCommentDigestMail(sammel);
    for (const wert of [
      'v2',
      'v3',
      '10:00:04:00',
      '10:00:12:03',
      'Ab hier wackelt die Kamera.',
      'Ton setzt zu spät ein.',
      'Sonst passt alles.',
    ]) {
      expect(mail.text).toContain(wert);
      expect(mail.html).toContain(wert);
    }
    expect(mail.text).toContain('[ohne Zeitbezug]');
  });

  // Der Grund, warum jemand sofort hineinschaut – das darf nicht untergehen.
  it('hebt eine Erwähnung im Betreff hervor', () => {
    const mail = renderCommentDigestMail({
      ...sammel,
      entries: [sammel.entries[0], { ...sammel.entries[1], mentioned: true }],
    });
    expect(mail.subject).toBe('Du wurdest erwähnt – 2 neue Kommentare zu „Schnittfassung“');
    expect(mail.html).toContain('dich erwähnt');
  });

  it('formuliert bei einem einzelnen Kommentar im Singular', () => {
    const mail = renderCommentDigestMail({ ...sammel, entries: [sammel.entries[0]] });
    expect(mail.subject).toBe('Ein neuer Kommentar zu „Schnittfassung“');
    expect(mail.text).toContain('Jonathan Fuhr hat');
  });

  it('maskiert HTML aus Text und Namen', () => {
    const mail = renderCommentDigestMail({
      ...sammel,
      entries: [
        { ...sammel.entries[0], body: '<img src=x onerror="alert(1)">', authorName: 'Böse<script>' },
      ],
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<script>');
  });

  it('enthält den Link zum Player und zum Abbestellen', () => {
    const mail = renderCommentDigestMail(sammel);
    expect(mail.html).toContain(sammel.url);
    expect(mail.html).toContain(sammel.unsubscribeUrl);
    expect(mail.text).toContain(sammel.unsubscribeUrl);
  });
});

describe('renderProjectFileMail', () => {
  it('nennt Datei, Größe und Projekt', () => {
    const mail = renderProjectFileMail({
      recipientName: 'Jonathan',
      uploaderName: 'Kunde GmbH',
      projectName: 'THD Imagefilm',
      filename: 'Logo.png',
      sizeLabel: '2,4 MB',
      url: 'https://klappe.example/projekte/1',
      unsubscribeUrl: 'https://klappe.example/abmelden?token=xyz',
    });
    expect(mail.subject).toContain('THD Imagefilm');
    expect(mail.text).toContain('Logo.png');
    expect(mail.text).toContain('2,4 MB');
    expect(mail.html).toContain('Kunde GmbH');
  });
});

describe('renderTestMail', () => {
  it('nennt Server und Absender und weist auf SPF/DKIM hin', () => {
    const mail = renderTestMail({ host: 'smtp-relay.brevo.com', fromEmail: 'review@thd.example' });
    expect(mail.text).toContain('smtp-relay.brevo.com');
    expect(mail.text).toContain('review@thd.example');
    expect(mail.text).toContain('DKIM');
  });
});
