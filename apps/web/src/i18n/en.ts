import type { Message } from '@klappe/shared';
import type { MessageKey } from './de';

/**
 * Englisches Wörterbuch der Oberfläche (Phase 26).
 *
 * Der Typ `Record<MessageKey, Message>` erzwingt **Vollständigkeit**: Kommt in
 * `de.ts` ein Schlüssel dazu und hier nicht, bricht der Typecheck. Damit
 * fällt eine vergessene Übersetzung beim Bauen auf und nicht erst als leerer
 * Knopf beim Kunden.
 */
export const en: Record<MessageKey, Message> = {
  // ---------- Recurring ----------
  'common.save': 'Save',
  'common.saving': 'Saving …',
  'common.saved': 'Saved.',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.deleteFinally': 'Delete permanently',
  'common.rename': 'Rename',
  'common.edit': 'Edit',
  'common.create': 'Create',
  'common.remove': 'Remove',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.loading': 'Loading …',
  'common.actions': 'Actions',
  'common.search': 'Search',
  'common.searchPlaceholder': 'Search …',
  'common.optional': 'optional',
  'common.name': 'Name',
  'common.email': 'Email address',
  'common.password': 'Password',
  'common.loadFailed': 'Loading failed.',
  'common.saveFailed': 'Saving failed.',
  'common.deleteFailed': 'Deleting failed.',
  'common.changeFailed': 'The change failed.',
  'common.createFailed': 'Creating failed.',
  'common.uploadFailed': 'Upload failed.',
  'common.removeFailed': 'Removing failed.',

  // ---------- Header and user menu ----------
  'shell.projects': 'Projects',
  'shell.userMenu': 'User menu',
  'shell.profile': 'Profile and security',
  'shell.manual': 'Manual',
  'shell.about': 'About this software',
  'shell.settings': 'Settings',
  'shell.logout': 'Sign out',
  'shell.guestBadge': 'Guest',

  // ---------- Sign-in ----------
  'login.tagline': 'Review and approval for video production',
  'login.or': 'or',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in …',
  'login.failed': 'Sign-in failed.',
  'login.cookieRejected':
    'The password was correct, but your browser discarded the session cookie. This happens when SESSION_COOKIE_SECURE=1 is set while the site is served over http:// instead of https://.',
  'login.microsoftOnly':
    'In this workspace, team accounts can only sign in through Microsoft 365.',
  'login.guestAccess': 'Guest access',
  'login.guestHint':
    'For clients who already have a share – no password, just a code by email.',

  // ---------- Toolbars ----------
  'toolbar.filter': 'Filter',
  'toolbar.filterWithCount': 'Filter ({count} active)',
  'toolbar.filterNone': 'No filters available.',
  'toolbar.filterNoValues': 'No values available.',
  'toolbar.filterReset': 'Reset filters',
  'toolbar.sort': 'Sorting',
  'toolbar.sortCurrent': 'Sorting: {name}',
  'toolbar.sortByGrouping': 'While grouping is on, the grouping sets the order.',
  'toolbar.sortUnknown': 'unknown',
  'toolbar.group': 'Grouping',
  'toolbar.groupCurrent': 'Grouping: {name}',
  'toolbar.groupNone': 'Grouping: none',
  'toolbar.closeMenu': 'Close menu',

  // ---------- Project list ----------
  'projects.title': 'Projects',
  'projects.countInFilter': { one: '{count} project in filter', other: '{count} projects in filter' },
  'projects.countInWorkspace': {
    one: '{count} project in workspace',
    other: '{count} projects in workspace',
  },
  'projects.new': 'New project',
  'projects.searchPlaceholder': 'Project, client or field …',
  'projects.allTags': 'all tags',
  'projects.sortUpdated': 'Last edited',
  'projects.sortCreated': 'Last created',
  'projects.sortName': 'Name',
  'projects.sortCustomer': 'Client',
  'projects.groupNone': 'No grouping',
  'projects.groupByCustomer': 'By client',
  'projects.groupByField': 'By {name}',
  'projects.customer': 'Client',
  'projects.withoutValue': 'Without {name}',
  'projects.emptyFiltered': 'No project matches this filter.',
  'projects.emptyNone': 'No projects yet. Create the first one to upload videos.',
  'projects.emptySearch': 'No project matches the search.',
  'projects.archived': 'archived',
  'projects.videoCount': { one: '{count} video', other: '{count} videos' },
  'projects.changedAt': 'Changed {when}',
  'projects.tileActions': 'Actions for {name}',
  'projects.customerActions': 'Actions for client {name}',
  'projects.renameEllipsis': 'Rename …',
  'projects.deleteEllipsis': 'Delete …',
  'projects.renameCustomerEllipsis': 'Rename client …',
  'projects.createCustomerLabel': 'Client (optional)',
  'projects.createCustomerHint':
    'Appears in download filenames and helps match uploaded files to a project.',
  'projects.createDescriptionLabel': 'Description (optional)',
  'projects.renameCustomerTitle': 'Client “{name}”',
  'projects.renameCustomerNewName': 'New name',
  'projects.renameCustomerHint': {
    one: 'Affects {count} project – including the download filenames of future versions.',
    other: 'Affects {count} projects – including the download filenames of future versions.',
  },
  'projects.removeCustomerEntry': 'Remove client entry',
  'tags.label': 'Tags',

  // ---------- Language choice ----------
  'locale.label': 'Language',
  'locale.followWorkspace': 'Same as workspace ({name})',
  'locale.ownHint':
    'Applies to the interface, to error messages and to the emails Klappe sends you.',
  'locale.workspaceLabel': 'Workspace language',
  'locale.workspaceHint':
    'Applies to the sign-in page, guest access and everyone who has not picked their own under “Profile and security” – including their emails.',

  // ---------- Guest gate and guest list ----------
  'gate.notFound': 'This share does not exist.',
  'gate.project': 'Project',
  'gate.video': 'Video',
  'gate.videoInProject': ' · Project {name}',
  'gate.expired':
    'This share has expired or was withdrawn. Please get in touch with your contact person.',
  'gate.noMail':
    'Email delivery is not set up on this server yet, so no sign-in code can be sent. An administrator can add it under Settings.',
  'gate.askMail': 'Please enter your email address. We will send you a code to confirm it.',
  'gate.codeLabel': 'Code from the email',
  'gate.requestCode': 'Request code',
  'gate.sendingCode': 'Sending code …',
  'gate.checking': 'Checking …',
  'gate.back': 'Back',
  'gate.askName':
    'Welcome. What should we call you? This will appear on your comments – and we only ask this once.',
  'gate.continue': 'Continue',
  'gate.codeSendFailed': 'The code could not be sent.',
  'gate.codeWrong': 'That code is not correct.',
  'gate.nameSaveFailed': 'The name could not be saved.',
  'gate.cookieRejected':
    'The code was correct, but your browser discarded the session cookie. This happens when SESSION_COOKIE_SECURE=1 is set while the site is served over http:// instead of https://.',
  'guests.empty':
    'Nobody from outside yet. Guests appear here as soon as they use a share link.',
  'guests.lastSeen': 'last seen {when}',
  'guests.blocked': 'Account blocked',
  'guests.canView': 'can view',
  'guests.canComment': 'can comment',
  'guests.canDownload': 'can download',
  'guests.canUpload': 'can upload',
  'guests.noAccess': 'no access',
  'guests.revoked': 'revoked',
  'guests.linkRevoked': 'Link withdrawn',
  'guests.giveBack': 'Restore access',
  'guests.revoke': 'Revoke access',
  'guests.revokeHint': 'Access is revoked at project level – it applies to all videos at once.',
};
