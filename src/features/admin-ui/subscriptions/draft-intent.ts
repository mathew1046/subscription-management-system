import {z} from 'zod';
import {id, subscriptionInput} from '@/lib/contracts';

const draftIntent = z.object({
  version: z.literal(1),
  actor_id: id,
  request_key: id,
  payload: subscriptionInput,
  status: z.enum(['pending', 'rejected', 'completed']),
  subscription_id: id.nullable(),
}).strict().refine(value => (value.status === 'completed') === (value.subscription_id !== null), 'Saved draft state is inconsistent');

export type DraftIntent = z.output<typeof draftIntent>;
export type DraftRecovery =
  | {kind: 'empty'; raw: null}
  | {kind: 'ready'; raw: string; intent: DraftIntent}
  | {kind: 'invalid'; raw: string}
  | {kind: 'unavailable'; raw: null};

function storageKey(actorId: string) {
  // Local, not session storage: recover across tab closure as well as route changes.
  // Only agreement input is stored, never credentials or session tokens.
  return `brightloop:subscription-create:v1:${actorId}`;
}

export async function withDraftIntentLock(actorId: string, action: () => Promise<void>): Promise<void> {
  // Storage comparison alone is not atomic across tabs. Hold the browser's
  // per-origin lock through the request, and never queue a delayed mutation.
  if (!navigator.locks) throw new Error('This browser cannot coordinate saved creation attempts safely. Use a browser with Web Locks support.');
  await navigator.locks.request(storageKey(actorId), {ifAvailable: true}, async lock => {
    if (!lock) throw new Error('Another tab is working with this creation attempt. Wait for it to finish, then reload recovery.');
    await action();
  });
}

export function immutableIntent(value: DraftIntent): DraftIntent {
  value.payload.lines.forEach(Object.freeze);
  Object.freeze(value.payload.lines);
  Object.freeze(value.payload);
  return Object.freeze(value);
}

export function readDraftIntent(actorId: string): DraftRecovery {
  let raw: string | null;
  try {raw = localStorage.getItem(storageKey(actorId));}
  catch {return {kind: 'unavailable', raw: null};}
  if (raw === null) return {kind: 'empty', raw};
  try {
    const parsed = draftIntent.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.actor_id !== actorId) return {kind: 'invalid', raw};
    return {kind: 'ready', raw, intent: immutableIntent(parsed.data)};
  } catch {return {kind: 'invalid', raw};}
}

export function persistDraftIntent(actorId: string, intent: DraftIntent, expectedRaw: string | null): string {
  const validated = draftIntent.parse(intent);
  if (validated.actor_id !== actorId) throw new Error('The saved draft belongs to another user.');
  const key = storageKey(actorId);
  if (localStorage.getItem(key) !== expectedRaw) throw new Error('The saved creation attempt changed in another tab. Reload recovery before continuing.');
  const raw = JSON.stringify(validated);
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw new Error('The browser could not retain the creation attempt. No new request was sent.');
  return raw;
}

export function archiveDraftIntent(actorId: string, expectedRaw: string): void {
  const key = storageKey(actorId);
  if (localStorage.getItem(key) !== expectedRaw) throw new Error('The saved creation attempt changed. Reload recovery before continuing.');
  // Keep the original key/payload for reconciliation, even when deliberately
  // starting a separate draft or replacing an unreadable recovery record.
  const archiveKey = `${key}:archive:${crypto.randomUUID()}`;
  localStorage.setItem(archiveKey, expectedRaw);
  if (localStorage.getItem(archiveKey) !== expectedRaw) throw new Error('The previous creation attempt could not be retained.');
  localStorage.removeItem(key);
  if (localStorage.getItem(key) !== null) throw new Error('The previous creation attempt could not be released.');
}
