import Link from 'next/link';
import {ApiError} from '@/lib/client';
import type {Invoice, InvoiceEmail} from '@/lib/contracts';

export const invoiceStatuses = ['', 'Outstanding', 'Overdue', 'Draft', 'Confirmed', 'Paid', 'Cancelled'] as const;
export const methods = {bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', upi: 'UPI', other: 'Other'} as const;
export const utcToday = () => new Date().toISOString().slice(0, 10);

// Compare decimal strings without converting money to floating-point numbers.
export function compareMoney(a: string, b: string): number {
  const parts = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole.replace(/^0+(?=\d)/, '')}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  };
  const left = parts(a), right = parts(b);
  return left.length === right.length ? (left === right ? 0 : left > right ? 1 : -1) : left.length > right.length ? 1 : -1;
}

export const isOverdue = (invoice: Invoice) => invoice.status === 'Confirmed' && compareMoney(invoice.balance, '0') > 0 && invoice.due_on < utcToday();
export const ambiguous = (cause: unknown) => !(cause instanceof ApiError) || cause.status === 0 || cause.status >= 500 || cause.code === 'UNAVAILABLE' || cause.code === 'TIMEOUT';

export function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    const message = cause.status === 401 ? 'Your session has expired. Sign in again to continue.'
      : cause.status === 403 ? 'You do not have permission to access this invoice or action.'
      : cause.status === 404 ? 'This invoice was not found or is no longer available to your account.'
      : cause.message;
    return `${message}${cause.requestId ? ` Request reference: ${cause.requestId}.` : ''}`;
  }
  return cause instanceof Error ? cause.message : 'The request did not complete. Refresh the invoice before continuing.';
}

export function SignInRecovery({cause}: {cause: unknown}) {
  return cause instanceof ApiError && cause.status === 401 ? <Link className="text-link" href="/login">Sign in again</Link> : null;
}

export function emailMessage(email?: InvoiceEmail): string {
  if (!email) return 'Email status is unavailable. Refresh the invoice before trying again.';
  switch (email.status) {
    case 'not_queued': return 'No invoice email has been queued.';
    case 'queued': return 'Invoice email queued. SMTP has not yet accepted it; this is not a delivery confirmation.';
    case 'retrying': return 'Email delivery attempt failed. The worker will retry the existing queued message; do not send another copy.';
    case 'failed': return 'Email retries are exhausted. An operator must review and deliberately requeue the existing message; Send does not restart it.';
    case 'sent': return 'SMTP accepted the invoice email. Inbox delivery is not guaranteed.';
  }
}
