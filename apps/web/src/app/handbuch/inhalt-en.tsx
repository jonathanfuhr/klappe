'use client';

import Link from 'next/link';

/**
 * The manual in English (Phase 26) – the counterpart to `inhalt-de.tsx`.
 *
 * Kept as a whole language version rather than as dictionary fragments; see the
 * note in the German file for the reasoning.
 */
export const ABSCHNITTE_EN = [
  { id: 'anmelden', label: 'Signing in', href: '#anmelden' },
  { id: 'oberflaeche', label: 'The interface', href: '#oberflaeche' },
  { id: 'projekte', label: 'Projects, videos, versions', href: '#projekte' },
  { id: 'hochladen', label: 'Uploading', href: '#hochladen' },
  { id: 'player', label: 'The player', href: '#player' },
  { id: 'kommentieren', label: 'Comments & drawing', href: '#kommentieren' },
  { id: 'freigeben', label: 'Sharing', href: '#freigeben' },
  { id: 'gast', label: 'As a guest in Klappe', href: '#gast' },
  { id: 'ablage', label: 'Client folder', href: '#ablage' },
  { id: 'downloads', label: 'Downloading', href: '#downloads' },
  { id: 'benachrichtigungen', label: 'Notifications', href: '#benachrichtigungen' },
  { id: 'konto', label: 'My account', href: '#konto' },
  { id: 'geraete', label: 'Connecting devices', href: '#geraete' },
  { id: 'einstellungen', label: 'Settings (team)', href: '#einstellungen' },
  { id: 'faq', label: 'Frequently asked', href: '#faq' },
] as const;

export function HandbuchEn() {
  return (
    <>
      <section id="anmelden" className="card manual__section">
        <h2>Signing in</h2>
        <p>
          <strong>Team members</strong> sign in with their email address and password, or – if it
          has been set up – via the Microsoft 365 button on the sign-in page.
        </p>
        <p>
          <strong>Guests</strong> need neither an account nor a password. There are two ways in:
        </p>
        <ol>
          <li>
            <strong>Via a share link.</strong> One click leads to a page that first asks for the
            email address. An email with a six-digit code follows – enter it, done. The name is
            only asked for on the very first visit and never again. Anyone still signed in passes
            straight through the next time they click the same link.
          </li>
          <li>
            <strong>Via guest access on the sign-in page</strong>, in case the link is not at hand.
            Here too the email address and a code are enough. This does not create a new account –
            for an address without a share Klappe sends no email, and the refusal appears right in
            the browser.
          </li>
        </ol>
        <p>
          A sign-in code is valid for a few minutes. If no email arrives, the spam folder is worth
          a look.
        </p>
      </section>

      <section id="oberflaeche" className="card manual__section">
        <h2>The interface at a glance</h2>
        <p>The header is the same everywhere:</p>
        <ul>
          <li>
            <strong>Logo/title</strong> on the left leads to the project list.
          </li>
          <li>
            <strong>Projects</strong> shows every project you have access to.
          </li>
          <li>
            <strong>Manual</strong> and <strong>About this software</strong> – these two pages.
          </li>
          <li>
            <strong>Settings</strong> is available to team members and admins only.
          </li>
          <li>
            On the right the bell for the notification centre, next to it your own name (leading to{' '}
            <strong>My account</strong>) and the sign-out button.
          </li>
        </ul>
        <p>
          A project opens the list of its videos; a video opens the player with the newest version.
          From there you can switch between versions at any time.
        </p>
      </section>

      <section id="projekte" className="card manual__section">
        <h2>Projects, videos and versions</h2>
        <p>
          The structure is always <strong>project → video → version</strong>. A video can carry any
          number of versions (v1, v2, v2.5, v3 …) – a new version is uploaded for each new cut, and
          the old one stays available for comparison.
        </p>
        <p>
          In the project list the <strong>client is shown large above the project name</strong>;
          depending on the setup, individual custom fields such as a project number also appear on
          the tile.
        </p>
        <p>
          A version can be marked as a <strong>final version</strong>. If it is not, Klappe shows a
          clear notice while watching that this is an interim state.
        </p>
        <p>
          Independently of that there is the <strong>internal</strong> tick: it keeps a version in
          house until someone from the team releases it. Until then guests do not see it anywhere –
          not in the version list, not as the newest version, not in the download dialog. The tick
          can be set while uploading (for each file separately) and changed at any time afterwards.
          <strong> Anyone on the team</strong> may release it, not just an admin; afterwards the
          version shows who released it and when.
        </p>
        <p>
          An archived project stays visible and playable, but shows only the newest finished
          version per video, and commenting is no longer possible.
        </p>
      </section>

      <section id="hochladen" className="card manual__section">
        <h2>Uploading</h2>
        <p>
          The upload window sits at the bottom right and can be collapsed and reopened. It accepts
          any number of files at once – whole folders by drag &amp; drop too – and simply keeps
          running when you change pages.
        </p>
        <p>
          The transfer runs in small blocks. If the connection breaks off midway, the next attempt
          continues at exactly the point where it stopped.
        </p>
        <p>
          Klappe suggests project, video and version number from the filename – every suggestion is
          clearly marked <em>please check</em> and is only created once you actively click{' '}
          <strong>Save</strong>.
        </p>
        <p>
          <strong>Who may upload?</strong> Team members always. Guests only if a share link
          explicitly allows it.
        </p>
      </section>

      <section id="player" className="card manual__section">
        <h2>The player</h2>
        <p>
          The player plays <strong>frame-accurately</strong>: what the player shows as frame 812 is
          exactly frame 812 in the editing software.
        </p>
        <h3>Keyboard shortcuts</h3>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="kbd">Space</span>
                </td>
                <td>Play / pause</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">J</span> / <span className="kbd">K</span> /{' '}
                  <span className="kbd">L</span>
                </td>
                <td>Rewind / stop / fast forward (press repeatedly = faster)</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">←</span> / <span className="kbd">→</span>
                </td>
                <td>One frame back / forward</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">Shift</span> + <span className="kbd">←</span> /{' '}
                  <span className="kbd">→</span>
                </td>
                <td>One second back / forward</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">Home</span> / <span className="kbd">End</span>
                </td>
                <td>First / last frame</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">C</span>
                </td>
                <td>Comment on the current frame</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">D</span>
                </td>
                <td>Draw on the current frame</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">M</span>
                </td>
                <td>Mute</td>
              </tr>
              <tr>
                <td>
                  <span className="kbd">F</span>
                </td>
                <td>Fullscreen</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 12 }}>
          On a phone in landscape the layout adapts; when space runs short the frame number goes
          first, the timecode always stays visible.
        </p>
        <p>
          In <strong>fullscreen</strong> you can keep commenting: the comment button (or{' '}
          <span className="kbd">C</span>) slides the comment column in from the right; the cross at
          the top closes it again.
        </p>
        <h3>Playback quality</h3>
        <p>
          If adaptive playback is available for a video, a <strong>quality selector</strong>{' '}
          appears in the control bar. On <strong>Auto</strong> Klappe picks the rung according to
          the measured connection – the rung currently playing is shown in brackets. Anyone who
          wants a specific rung (for instance guaranteed 1080p for approval) picks it fixed;{' '}
          <em>Auto</em> hands the choice back. In Safari the browser makes the choice itself, so
          the switch is not offered there.
        </p>
      </section>

      <section id="kommentieren" className="card manual__section">
        <h2>Commenting and drawing</h2>
        <p>
          A comment hangs on a <strong>single frame</strong>, not on an approximate second. You can
          reply, mention someone with <code>@Name</code> (they are notified), and a comment can be
          marked as <strong>done</strong>.
        </p>
        <p>
          There is also a <strong>drawing tool</strong>: mark what you mean directly on the still
          frame in several colours – the stroke hangs on the same frame as the comment.
        </p>
        <p>
          <strong>Tip:</strong> pause the picture, press <span className="kbd">C</span> (or{' '}
          <span className="kbd">D</span> for drawing), type or draw your note, send it off.
        </p>
      </section>

      <section id="freigeben" className="card manual__section">
        <h2>Sharing</h2>
        <p>
          A share link can be issued for a whole <strong>project</strong> or a single{' '}
          <strong>video</strong>. When creating it you decide whether the link allows commenting,
          downloading and uploading. These rights can additionally be set per person, differing
          from the link.
        </p>
        <p>
          Next to the player sits the <strong>Shares</strong> column with everyone who has access.
          Access can be revoked at any time – that takes effect immediately and affects only that
          one person.
        </p>
        <h3>External project admin</h3>
        <p>
          For working with agencies the team can make a guest on its project share an{' '}
          <strong>external project admin</strong>. They may then create videos in exactly that
          project, upload and delete their own versions, share further and manage other people’s
          comments. Renaming or deleting the project and its videos stays with the team, as does
          changing existing share links.
        </p>
        <h3>Embedding</h3>
        <p>
          A video can be embedded in someone else’s page – via the{' '}
          <strong>“…” menu → Embed</strong> on the video, not via the shares. A share link invites
          people to sign in and comment, an embed link only shows the player; that is why they are
          two different links.
        </p>
        <p>
          Nobody can sign in with the embed link, and only the newest{' '}
          <strong>final version</strong> is served – without the final-version tick the player
          stays empty. There are no comments, no guest list and no download there. Withdrawing
          takes effect immediately.
        </p>
      </section>

      <section id="gast" className="card manual__section">
        <h2>As a guest in Klappe</h2>
        <p>As a guest you see what you were invited to. Possible are:</p>
        <ul>
          <li>watching shared videos (frame-accurately, with all keyboard shortcuts),</li>
          <li>commenting and drawing, if the link allows it,</li>
          <li>downloading, if the link allows it,</li>
          <li>uploading your own material, if the link allows it.</li>
        </ul>
        <p>
          There is no password of your own – access always runs via the email address and the code
          sent to it. Once access has been withdrawn, even an old link no longer leads in.
        </p>
      </section>

      <section id="ablage" className="card manual__section">
        <h2>Client folder</h2>
        <p>
          Every project has its own area for client material – briefings, logos, your own edits. It
          works like an ordinary folder: create subfolders, upload files, rename, delete. A whole
          folder can also be downloaded as a ZIP file.
        </p>
      </section>

      <section id="downloads" className="card manual__section">
        <h2>Downloading</h2>
        <p>
          The <strong>Download</strong> button always opens a window – even without additional
          formats. It shows the filename the file will land under, and for a version without the
          final-version tick the warning that an interim state is leaving the building. At the very
          top there is always the <strong>original</strong> – the unchanged uploaded file.
          Depending on the setup, additional finished formats are offered below.
        </p>
        <p>Downloaded files carry a descriptive name following this pattern:</p>
        <pre className="codeblock">
          YYMMDD_Client_Projectname_Videoname_Versionnumber_Resolution.extension{'\n'}
          260304_Example-Marketing_Summer-Campaign_Reel-Vertical_v1_2160p25.mov
        </pre>
      </section>

      <section id="benachrichtigungen" className="card manual__section">
        <h2>Notifications</h2>
        <p>
          Anyone who wants to be informed about new comments subscribes in the{' '}
          <strong>Notifications</strong> column – for a whole project or a single video. Whoever
          uploads a new version is subscribed to that video automatically. Emails are usually sent
          in batches rather than one per note.
        </p>
        <p>
          Independently of that there is the <strong>notification centre</strong>: the bell in the
          header. It shows immediately who wrote what and where – guests have this centre too.
          Single entries can be removed with the <span className="kbd">✕</span>, and{' '}
          <strong>Remove read</strong> clears everything already seen. Unread entries stay. A read
          entry disappears on its own after a week.
        </p>
        <h3>Notifications on your device</h3>
        <p>
          At the bottom of the centre there is <strong>Enable desktop notifications</strong> (on a
          computer) or <strong>Enable device notifications</strong> (on a phone). Klappe then
          reaches you even with no window open. The notification names the client, project and
          video – deliberately no comment text, since it appears on a lock screen. If several
          comments arrive for the same video, the same notification grows instead of stacking: it
          alerts once and then counts up quietly until you visit the video page again.
        </p>
        <p>
          <strong>On iPhone and iPad</strong> this row only appears once Klappe has been added via{' '}
          <em>Share → Add to Home Screen</em>. Apple allows no notifications in an ordinary Safari
          tab, so the row is not shown there at all. Open Klappe from the home screen icon and it
          is there.
        </p>
      </section>

      <section id="konto" className="card manual__section">
        <h2>My account</h2>
        <p>
          Under <strong>My account</strong> (click your own name in the header) you can change your{' '}
          <strong>name</strong> – the way it appears in comments, lists and notifications. That
          applies to the team and to guests alike. The <strong>language</strong> of the interface
          and of your emails is set there as well; without a choice of your own the workspace
          setting applies.
        </p>
        <p>
          Team members also change their <strong>password</strong> there. Guests have none – their
          access runs via the emailed code.
        </p>
      </section>

      <section id="geraete" className="card manual__section">
        <h2>Connecting devices</h2>
        <p>
          Programs outside the browser can work with Klappe – a plugin in your editing software,
          for example, that pulls comments into the timeline as markers. For that to work, the
          administrator has to have allowed external access under{' '}
          <em>Settings → API access</em>; it is off out of the box.
        </p>
        <ol>
          <li>
            The program shows an eight-character code, something like <code>KHFP-3RTM</code>, plus
            an address.
          </li>
          <li>
            Open that address in the browser (or go to <em>Connect device</em> under{' '}
            <Link href="/konto">My account</Link>) and enter the code.
          </li>
          <li>
            It shows which program wants to connect. Confirm – done. The program reports back
            within a few seconds by itself.
          </li>
        </ol>
        <p>
          <strong>No password is typed anywhere in this.</strong> What counts is the sign-in that
          is already in place in the browser – whether it came about with a password or through
          Microsoft 365 makes no difference.
        </p>
        <p>
          A connected program gets <strong>exactly your own permissions</strong>: it sees the same
          projects and videos, comments under your name, and may download and upload as far as you
          may yourself. So only confirm what you started yourself just now.
        </p>
        <p>
          All connected devices are listed under <Link href="/konto">My account</Link>.{' '}
          <em>Disconnect</em> takes effect at once and affects only that one device – the password
          stays untouched and every other device carries on. So if you lose a laptop, you
          disconnect precisely that one. This works without the administrator; they in turn can
          disconnect any device in the workspace and switch external access off altogether.
        </p>
        <p>
          Guests can connect devices too. Such a program then sees exactly what the guest sees in
          the browser – their shares, no more.
        </p>
      </section>

      <section id="einstellungen" className="card manual__section">
        <h2>Settings (team)</h2>
        <p>Team members and admins find under Settings, among other things:</p>
        <ul>
          <li>
            <strong>Guests</strong> – who has access, and the option to revoke it.
          </li>
          <li>
            <strong>Users</strong>, <strong>Custom fields</strong>, <strong>Projects</strong> –
            reserved for the admin.
          </li>
          <li>
            <strong>Appearance</strong> – title, logo, accent colour and the language of the
            workspace.
          </li>
          <li>
            <strong>Sign-in</strong> – local accounts and/or Microsoft 365.
          </li>
          <li>
            <strong>API access</strong> – whether programs outside the browser may work with
            Klappe (off out of the box), and every connected device in the workspace.
          </li>
          <li>
            <strong>Email delivery</strong> – SMTP setup, digest window, undeliverable mail.
          </li>
          <li>
            <strong>Transcode</strong> – which download formats are offered and when they are
            produced.
          </li>
          <li>
            <strong>Storage</strong> – how much space is left on the disk and how much of it Klappe
            occupies.
          </li>
          <li>
            <strong>Backup</strong> – whether and how often the database is backed up, and
            restoring a backup.
          </li>
        </ul>
      </section>

      <section id="faq" className="card manual__section">
        <h2>Frequently asked</h2>
        <p>
          <strong>I did not receive a code.</strong> Check the spam folder. If no email arrives,
          either mail delivery is not set up or your address has no share (yet).
        </p>
        <p>
          <strong>My old link no longer works.</strong> Then access has been withdrawn. The team
          can issue a new share.
        </p>
        <p>
          <strong>Why do I see a notice saying “not a final version”?</strong> The version shown is
          explicitly not yet marked as finished.
        </p>
        <p>
          <strong>Where does it say who built this software and where it runs?</strong> On the{' '}
          <Link href="/ueber">About this software</Link> page.
        </p>
      </section>
    </>
  );
}
