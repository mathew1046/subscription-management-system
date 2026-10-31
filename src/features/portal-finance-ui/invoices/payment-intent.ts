import {z} from 'zod';
import {paymentInput} from '@/lib/contracts';

const savedIntent = z.object({
  version: z.literal(1), user_id: z.string().uuid(),
  state: z.enum(['review', 'uncertain', 'conflict', 'rejected', 'completed']),
  // Persisted recovery must contain every original field; do not fill defaults
  // into an incomplete saved payload and then treat it as exact recovery.
  payload: paymentInput.extend({note: z.string().max(2000)}),
}).strict();
export type PaymentIntent = z.output<typeof savedIntent>;
export type PaymentRecovery = {raw: string | null; intent: PaymentIntent | null};
const durableRecord = z.object({
  version: z.literal(2), revision: z.string().uuid(), intent: savedIntent.nullable(), released: z.boolean(),
  quarantined_intent: savedIntent.optional(),
}).strict().refine(value => !value.released || (value.intent !== null && ['review', 'rejected', 'completed'].includes(value.intent.state)), 'An unresolved payment cannot be released');

export const paymentStorageKey = (userId: string, invoiceId: string) => `brightloop:manual-payment:v1:${userId}:${invoiceId}`;

function parse(raw: string, userId: string, invoiceId: string): PaymentIntent {
  const parsed = savedIntent.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.user_id !== userId || parsed.data.payload.invoice_id !== invoiceId) {
    throw new Error('Saved payment data is invalid or belongs to another user/invoice. Preserve it for operator reconciliation; do not delete or replace it.');
  }
  Object.freeze(parsed.data.payload);
  return Object.freeze(parsed.data);
}

function parseRecord(raw: string, userId: string, invoiceId: string) {
  const record = durableRecord.parse(JSON.parse(raw));
  const intent = record.intent === null ? null : parse(JSON.stringify(record.intent), userId, invoiceId);
  if (record.quarantined_intent) {
    parse(JSON.stringify(record.quarantined_intent), userId, invoiceId);
    throw new Error('Conflicting payment requests are quarantined in durable storage. Both original keys and payloads are preserved. An operator must reconcile both before payment entry can continue in any tab.');
  }
  return {...record, intent};
}

function serialize(intent: PaymentIntent | null, released = false, quarantinedIntent?: PaymentIntent): string {
  return JSON.stringify({version: 2, revision: crypto.randomUUID(), intent, released, quarantined_intent: quarantinedIntent});
}

export function samePaymentIntent(left: PaymentIntent, right: PaymentIntent): boolean {
  return left.user_id === right.user_id && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

export async function withPaymentIntentLock(key: string, action: () => Promise<void>, recoveryOnly = false): Promise<void> {
  if (!navigator.locks) throw new Error('Payment entry requires Web Locks support to coordinate tabs safely. Use a supported browser; preserve any existing request.');
  // Only mount-time recovery may wait (and checks its lifetime before reading).
  // Never queue a mutation to run later after the user has left its review.
  await navigator.locks.request(key, {ifAvailable: !recoveryOnly}, async lock => {
    if (!lock) throw new Error('Another tab is handling this user’s invoice payment. Wait for it to finish, then reload recovery.');
    await action();
  });
}

// All reads/migrations/writes below run inside the same per-user/invoice lock.
export function restorePaymentIntent(userId: string, invoiceId: string): PaymentRecovery {
  const key = paymentStorageKey(userId, invoiceId);
  const raw = localStorage.getItem(key), legacy = sessionStorage.getItem(key);
  const record = raw === null ? null : parseRecord(raw, userId, invoiceId);
  const durable = record?.intent ?? null;
  const persist = (serialized: string) => {
    if (localStorage.getItem(key) !== raw || sessionStorage.getItem(key) !== legacy) throw new Error('Payment recovery changed during migration. Reload without deleting either original.');
    localStorage.setItem(key, serialized);
    if (localStorage.getItem(key) !== serialized) throw new Error('Durable payment recovery could not be verified. Legacy data has been preserved.');
  };
  if (legacy === null) {
    // Establish a generation even for empty recovery. Released records retain
    // the last original intent plus a fresh revision: null → null must not let
    // a stale tab miss another tab's full submit/finish cycle (the ABA problem).
    if (record) return {raw, intent: record.released ? null : durable};
    const empty = serialize(null);
    persist(empty);
    return {raw: empty, intent: null};
  }
  const legacyIntent = parse(legacy, userId, invoiceId);
  // V1 did not retain rejection evidence and classified unknown 4xx responses
  // broadly. Do not let that historical label authorize replacing a key.
  const previous: PaymentIntent = legacyIntent.state === 'rejected' ? {...legacyIntent, state: 'uncertain'} : legacyIntent;
  if (durable && !samePaymentIntent(durable, previous)) {
    // Publish the conflict as well as blocking this tab. Otherwise peers could
    // submit the other key or start a new payment without seeing this legacy one.
    persist(serialize(durable, record?.released ?? false, previous));
    throw new Error('Conflicting payment requests are quarantined in durable storage. Both original keys and payloads are preserved. An operator must reconcile both before payment entry can continue in any tab.');
  }
  // Do not resurrect a released request, but an old tab may have submitted it
  // after an unsubmitted/rejected release. Preserve both records if that outcome
  // is unknown; only a reconciled completion can settle an older uncertain copy.
  if (record?.released && (previous.state === 'conflict' || (previous.state !== 'review' && durable?.state !== 'completed'))) {
    persist(serialize(previous));
    throw new Error('Legacy payment data needs reconciliation with the released request. The original key, payload and unresolved state are now durable for all tabs; the legacy record is also preserved.');
  }
  // A legacy tab may have an older state for this same immutable request. Never
  // downgrade it to a never-submitted review or a definitely rejected payment.
  const next: PaymentIntent = durable && durable.state !== previous.state
    ? {...durable, state: durable.state === 'conflict' || previous.state === 'conflict' ? 'conflict' : 'uncertain'}
    : durable ?? previous;
  const serialized = serialize(record?.released ? durable : next, record?.released ?? false);
  persist(serialized);
  sessionStorage.removeItem(key);
  if (sessionStorage.getItem(key) !== null) throw new Error('Legacy payment recovery could not be released safely. No payment request was sent.');
  const migrated = parseRecord(serialized, userId, invoiceId);
  return {raw: serialized, intent: migrated.released ? null : migrated.intent};
}

export function readPaymentIntent(userId: string, invoiceId: string, expectedRaw: string | null): PaymentRecovery {
  const key = paymentStorageKey(userId, invoiceId);
  if (sessionStorage.getItem(key) !== null) throw new Error('Legacy payment recovery appeared. Reload to reconcile it without overwriting either intent.');
  const raw = localStorage.getItem(key);
  if (raw !== expectedRaw) throw new Error('The saved payment changed in another tab. Reload recovery before continuing; no stale action may overwrite or clear it.');
  const record = raw === null ? null : parseRecord(raw, userId, invoiceId);
  return {raw, intent: record?.released ? null : record?.intent ?? null};
}

export function replacePaymentIntent(userId: string, invoiceId: string, expectedRaw: string | null, next: PaymentIntent | null): PaymentRecovery {
  const current = readPaymentIntent(userId, invoiceId, expectedRaw);
  const intent = next === null ? null : parse(JSON.stringify(next), userId, invoiceId);
  if (current.intent && intent && !samePaymentIntent(current.intent, intent)) throw new Error('The original payment key and payload cannot be changed.');
  if (intent === null && (!current.intent || !['review', 'rejected', 'completed'].includes(current.intent.state))) throw new Error('An unresolved payment intent cannot be released.');
  const raw = serialize(intent ?? current.intent, intent === null);
  const key = paymentStorageKey(userId, invoiceId);
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw new Error('Durable payment storage did not retain the change. Payment entry is locked; preserve the original key and details.');
  return {raw, intent};
}
