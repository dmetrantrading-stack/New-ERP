import React, { useRef, useCallback } from 'react';
import { cn } from '../lib/utils';

interface ModalOverlayProps {
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * Backdrop that closes only when pointer down/up both occur on the overlay itself.
 * Prevents accidental close when selecting text in inputs and dragging outside the modal.
 */
export default function ModalOverlay({ onClose, className, children }: ModalOverlayProps) {
  const backdropDown = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    backdropDown.current = e.target === e.currentTarget;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (backdropDown.current && e.target === e.currentTarget) {
      onClose();
    }
    backdropDown.current = false;
  }, [onClose]);

  return (
    <div
      className={cn('modal-overlay', className)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {children}
    </div>
  );
}
