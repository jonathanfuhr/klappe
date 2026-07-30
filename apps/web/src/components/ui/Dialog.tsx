'use client';

import { type ReactNode, useEffect } from 'react';

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        // Nur ein Klick auf den Hintergrund schließt, nicht einer im Dialog.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
