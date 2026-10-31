'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const buttonVariants = cva('button', {
  variants: { variant: { primary: 'primary', secondary: 'secondary', danger: 'danger', ghost: 'ghost' } },
  defaultVariants: { variant: 'primary' },
});

export function Button({ className = '', variant, ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button className={buttonVariants({ variant, className })} {...props} />;
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}

export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;
}

export function Textarea({ label, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="field"><span>{label}</span><textarea {...props} /></label>;
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>{children}</p>;
}

export function Status({ children }: { children: ReactNode }) {
  const state = typeof children === 'string' ? children.toLowerCase().replace(/[^a-z]+/g, '-') : 'neutral';
  return <span className={`badge status status-${state}`}>{children}</span>;
}

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
};

function DialogFrame({ open, onOpenChange, title, description, children, pending = false, confirm = false }: ModalProps & { pending?: boolean; confirm?: boolean }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const descriptionId = useId();
  return <Dialog.Root open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content
        ref={content}
        className={`dialog-content${confirm ? ' dialog-confirm' : ''}`}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={pending}
        onOpenAutoFocus={event => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          if (confirm) {
            event.preventDefault();
            const cancel = content.current?.querySelector<HTMLButtonElement>('[data-dialog-cancel]');
            if (cancel && !cancel.disabled) cancel.focus(); else content.current?.focus();
          }
        }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }}
        onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
        onInteractOutside={event => { if (pending) event.preventDefault(); }}
      >
        <div className="dialog-heading">
          <Dialog.Title className="dialog-title">{title}</Dialog.Title>
          {description && <Dialog.Description id={descriptionId} className="dialog-description">{description}</Dialog.Description>}
        </div>
        <Dialog.Close asChild><Button type="button" variant="ghost" className="dialog-close icon-button" disabled={pending} aria-label="Close dialog"><X size={20} aria-hidden="true" /></Button></Dialog.Close>
        <div className="dialog-body">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function Modal(props: ModalProps) {
  return <DialogFrame {...props} />;
}

export function ConfirmDialog({ open, onOpenChange, title, description, onConfirm, pending = false, confirmLabel = 'Confirm action', error }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void | Promise<unknown>;
  pending?: boolean;
  confirmLabel?: string;
  error?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const inFlight = useRef(false);
  const busy = pending || submitting;
  useEffect(() => { if (!open) setLocalError(''); }, [open]);
  async function confirmAction() {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setSubmitting(true);
    setLocalError('');
    try { await onConfirm(); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'The action did not complete. Check the record before retrying.'); }
    finally { inFlight.current = false; setSubmitting(false); }
  }
  return <DialogFrame open={open} onOpenChange={next => { setLocalError(''); onOpenChange(next); }} title={title} description={description} pending={busy} confirm>
    {(error || localError) && <Notice error>{error || localError}</Notice>}
    <div className="dialog-actions">
      <Dialog.Close asChild><Button type="button" variant="secondary" data-dialog-cancel disabled={busy}>Cancel</Button></Dialog.Close>
      <Button type="button" variant="danger" disabled={busy} onClick={confirmAction}>{busy ? 'Working…' : confirmLabel}</Button>
    </div>
  </DialogFrame>;
}
