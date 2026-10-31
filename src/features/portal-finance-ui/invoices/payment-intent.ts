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
  return {...record, intent: record.intent === null ? null : parse(JSON.stringify(record.intent), userId, invoiceId)};
}

function serialize(intent: PaymentIntent | null, released = false): string {
  return JSON.stringify({version: 2, revision: crypto.randomUUID(), intent, released});
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
  if (legacy === null) {
    // Establish a generation even for empty recovery. Released records retain
    // the last original intent plus a fresh revision: null → null must not let
    // a stale tab miss another tab's full submit/finish cycle (the ABA problem).
    if (record) return {raw, intent: record.released ? null : durable};
    const empty = serialize(null);
    if (localStorage.getItem(key) !== raw) throw new Error('Payment recovery changed. Reload before continuing.');
    localStorage.setItem(key, empty);
    if (localStorage.getItem(key) !== empty) throw new Error('Durable payment storage is unavailable.');
    return {raw: empty, intent: null};
  }
  const legacyIntent = parse(legacy, userId, invoiceId);
  // V1 did not retain rejection evidence and classified unknown 4xx responses
  // broadly. Do not let that historical label authorize replacing a key.
  const previous: PaymentIntent = legacyIntent.state === 'rejected' ? {...legacyIntent, state: 'uncertain'} : legacyIntent;
  if (durable && !samePaymentIntent(durable, previous)) {
    throw new Error('Different payment intents exist in durable and legacy tab storage. Both are preserved. An operator must reconcile both original keys before payment entry can continue.');
  }
  // A legacy tab may have an older state for this same immutable request. Never
  // downgrade it to a never-submitted review or a definitely rejected payment.
  const next: PaymentIntent = durable && durable.state !== previous.state
    ? {...durable, state: durable.state === 'conflict' || previous.state === 'conflict' ? 'conflict' : 'uncertain'}
    : durable ?? previous;
  const serialized = serialize(next);
  if (localStorage.getItem(key) !== raw || sessionStorage.getItem(key) !== legacy) throw new Error('Payment recovery changed during migration. Reload without deleting either original.');
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) throw new Error('Durable payment recovery could not be verified. Legacy data has been preserved.');
  sessionStorage.removeItem(key);
  if (sessionStorage.getItem(key) !== null) throw new Error('Legacy payment recovery could not be released safely. No payment request was sent.');
  return {raw: serialized, intent: parseRecord(serialized, userId, invoiceId).intent};
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
