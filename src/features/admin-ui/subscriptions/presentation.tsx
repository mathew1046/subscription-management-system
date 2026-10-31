import {Status} from '@/components/ui';
import {ApiError} from '@/lib/client';
import type {Subscription} from '@/lib/contracts';

export function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(value: string, days: number) {
  const result = new Date(`${value}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(`${value}T00:00:00Z`));
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 0 && error.code === 'UNAVAILABLE') return 'The request did not complete. Check the current status before retrying.';
  if (error instanceof ApiError) return `${error.message}${error.requestId ? ` (Request: ${error.requestId})` : ''}`;
  return error instanceof Error ? error.message : 'The request could not be completed. Please try loading the current record again.';
}

export function SubscriptionStatus({subscription}: {subscription: Subscription}) {
  const today = utcToday();
  return <div className="actions">
    <Status>{subscription.status}</Status>
    {subscription.paused && <Status>Paused</Status>}
    {subscription.close_reason === 'cancelled' && <Status>Cancelled</Status>}
    {(subscription.close_reason === 'expired' || (subscription.status !== 'Closed' && subscription.end_date <= today)) && <Status>Expired</Status>}
    {subscription.status === 'Active' && subscription.end_date > today && subscription.start_date > today && <Status>Scheduled</Status>}
    {(subscription.status === 'Draft' || subscription.status === 'Quotation') && subscription.quote_valid_until < today && <Status>Quotation expired</Status>}
  </div>;
}
