import type { Metadata } from 'next';
import { Handbuch } from './Handbuch';

export const metadata: Metadata = {
  title: 'Handbuch · Klappe',
};

/**
 * Serverseitige Hülle: Sie trägt nur den Seitentitel. Der Inhalt braucht die
 * gewählte Sprache und damit die Hooks aus dem Browser (Phase 26).
 */
export default function HandbuchPage() {
  return <Handbuch />;
}
