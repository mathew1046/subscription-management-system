import { Status } from '@/components/ui';
import type { Subscription } from '@/lib/contracts';

export function utcToday() { return new Date().toISOString().slice(0, 10); }

export function SubscriptionState({ subscription, today = utcToday() }: { subscription: Subscription; today?: string }) {
  const effective = subscription.status === 'Active'
    ? subscription.end_date <= today ? 'Expired' : subscription.start_date > today ? 'Scheduled' : subscription.paused ? 'Paused' : 'Active'
    : subscription.status;
  return <><Status>{effective}</Status>{subscription.paused && effective !== 'Paused' && <> <Status>Paused</Status></>}{subscription.close_reason && <span className="record-reference">Closed: {subscription.close_reason}</span>}</>;
}

export function subscriptionPermissions(subscription: Subscription, today = utcToday()) {
  const active = subscription.status === 'Active';
  const started = subscription.start_date <= today;
  const unexpired = subscription.end_date > today;
  const billingDue = !subscription.paused && subscription.next_billing_date <= today && subscription.next_billing_date < subscription.end_date;
  return {
    pause: active && started && unexpired && !subscription.paused && subscription.plan_snapshot.allow_pause && !billingDue,
    resume: active && subscription.paused && unexpired,
    renew: active && started && unexpired && subscription.plan_snapshot.allow_renew,
    close: active && subscription.plan_snapshot.allow_close && !billingDue,
    billingDue: active && billingDue,
  };
}
