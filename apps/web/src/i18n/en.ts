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
};
