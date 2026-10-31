'use client';

import Link from 'next/link';
import {createContext, useCallback, useContext, useEffect, useState, type ReactNode} from 'react';
import {api, ApiError} from '@/lib/client';
import {lineInput, type Resource, type User} from '@/lib/contracts';
import type {z} from 'zod';
import {Button, Field, Notice, Select} from '@/components/ui';

type Session = {user: User | null; loading: boolean; error: string; reload: () => void};
const SessionContext = createContext<Session | null>(null);

export function AdminSessionProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const reload = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setUser(null);
    setUnauthenticated(false);
    api.me().then(next => {if (active) setUser(next);}).catch(cause => {
      if (!active) return;
      setUnauthenticated(cause instanceof ApiError && cause.status === 401);
      setError(cause instanceof Error ? cause.message : 'Unable to load your workspace.');
    }).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [version]);

  if (loading) return <Notice>Loading your workspace…</Notice>;
  if (error) return <section className="empty-state"><h1>Workspace unavailable</h1><Notice error>{error}</Notice>
    <div className="actions">{unauthenticated ? <Link className="button" href="/login">Sign in</Link> : <Button onClick={reload}>Try again</Button>}</div></section>;
  if (!user || user.role === 'customer') return <section className="empty-state"><h1>This is the team workspace</h1>
    <p>Manage your own subscriptions and invoices in the customer portal.</p><Link className="button" href="/portal/subscriptions">Open my subscriptions</Link></section>;

  return <SessionContext.Provider value={{user, loading, error, reload}}>{children}</SessionContext.Provider>;
}

export function useAdminSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Admin views require AdminSessionProvider.');
  return session;
}

type LookupResource = Extract<Resource, 'products' | 'variants' | 'plans' | 'taxes' | 'customers' | 'quotation-templates'>;
type LookupProps = {
  resource: LookupResource;
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  disabled?: boolean;
  productId?: string;
};

export function LookupSelect({resource, label, value, onChange, optional = false, disabled = false, productId}: LookupProps) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<{id: string; name: string}[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const needsProduct = resource === 'variants' && !productId;

  useEffect(() => {setPage(1);}, [resource, productId]);
  useEffect(() => {
    let active = true;
    if (needsProduct) {setItems([]); setHasMore(false); setLoading(false); setError(''); return;}
    setLoading(true);
    setError('');
    api.list(resource, {page, page_size: 25}).then(result => {
      if (!active) return;
      const visible = result.items.filter(item => {
        if (resource === 'variants' && 'product_id' in item) return item.product_id === productId;
        return true;
      });
      setItems(visible);
      setNames(previous => ({...previous, ...Object.fromEntries(visible.map(item => [item.id, item.name]))}));
      setHasMore(result.has_more);
    }).catch(cause => {
      if (active) {setError(cause instanceof Error ? cause.message : `Unable to load ${label.toLowerCase()}.`); setItems([]); setHasMore(false);}
    }).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [resource, page, productId, needsProduct, version, label]);

  return <div className="lookup-control">
    <Select label={label} value={value} required={!optional} disabled={disabled || loading || needsProduct || !!error}
      onChange={event => onChange(event.target.value)}>
      <option value="">{needsProduct ? 'Choose a product first' : optional ? 'None' : `Choose ${label.toLowerCase()}`}</option>
      {value && !items.some(item => item.id === value) && <option value={value}>{names[value] || `Selected record · ${value.slice(-8)}`}</option>}
      {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </Select>
    {loading && <span className="text-muted" role="status">Loading choices…</span>}
    {error && <><Notice error>{error}</Notice><Button type="button" variant="secondary" disabled={disabled} onClick={() => setVersion(v => v + 1)}>Retry choices</Button></>}
    {!loading && !error && !needsProduct && <div className="lookup-pagination">
      <span className="text-muted">Page {page}{items.length === 0 ? ' · No matching choices on this page' : ''}</span>
      {(page > 1 || hasMore) && <div className="actions">
        <Button type="button" variant="ghost" disabled={disabled || page === 1} onClick={() => setPage(p => p - 1)} aria-label={`Previous ${label.toLowerCase()} choices`}>Previous choices</Button>
        <Button type="button" variant="ghost" disabled={disabled || !hasMore} onClick={() => setPage(p => p + 1)} aria-label={`More ${label.toLowerCase()} choices`}>More choices</Button>
      </div>}
    </div>}
  </div>;
}

type EditableLine = z.input<typeof lineInput>;
export function LineEditor({value, onChange, disabled = false}: {value: EditableLine[]; onChange: (value: EditableLine[]) => void; disabled?: boolean}) {
  const update = (index: number, change: Partial<EditableLine>) => onChange(value.map((line, i) => i === index ? {...line, ...change} : line));
  return <fieldset className="line-editor" disabled={disabled}>
    <legend>Product lines</legend>
    <p className="text-muted">Prices and taxes are calculated by the server when the agreement is saved.</p>
    {value.map((line, index) => <div className="line-row" key={index}>
      <div className="line-row-heading"><strong>Line {index + 1}</strong><Button type="button" variant="ghost" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label={`Remove line ${index + 1}`}>Remove line</Button></div>
      <div className="form-grid">
        <LookupSelect resource="products" label={`Product for line ${index + 1}`} value={line.product_id} disabled={disabled} onChange={product_id => update(index, {product_id, variant_id: null})}/>
        <LookupSelect resource="variants" label={`Variant for line ${index + 1}`} value={line.variant_id || ''} optional productId={line.product_id} disabled={disabled} onChange={variant_id => update(index, {variant_id: variant_id || null})}/>
        <Field label={`Quantity for line ${index + 1}`} type="number" min={1} max={100000} step={1} required value={line.quantity} disabled={disabled} onChange={event => update(index, {quantity: Number(event.target.value)})}/>
        <LookupSelect resource="taxes" label={`Tax for line ${index + 1}`} value={line.tax_id || ''} optional disabled={disabled} onChange={tax_id => update(index, {tax_id: tax_id || null})}/>
      </div>
    </div>)}
    <Button type="button" variant="secondary" disabled={disabled || value.length >= 100} onClick={() => onChange([...value, {product_id: '', variant_id: null, quantity: 1, tax_id: null}])}>Add product line</Button>
  </fieldset>;
}
