'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { Button, Notice } from './ui';
import type { Page } from '@/lib/contracts';

export function ResourceTable<T extends { id: string }>({ load, columns, refreshKey, label = 'Records', emptyMessage = 'No records to show. Add a record or adjust your filters to get started.' }: {
  load: (page: number) => Promise<Page<T>>;
  columns: { label: string; render: (row: T) => ReactNode }[];
  refreshKey?: string | number;
  label?: string;
  emptyMessage?: string;
}) {
  const [pagination, setPagination] = useState({ page: 1, load, refreshKey });
  const page = pagination.load === load && Object.is(pagination.refreshKey, refreshKey) ? pagination.page : 1;
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ load: typeof load; refreshKey: typeof refreshKey; page: number; retry: number; data: Page<T> | null; error: string } | null>(null);
  const requestId = useRef(0);
  const current = result?.load === load && Object.is(result.refreshKey, refreshKey) && result.page === page && result.retry === retry ? result : null;
  const data = current?.data;
  const error = current?.error;
  const loading = !current;

  useEffect(() => {
    const id = ++requestId.current;
    let active = true;
    Promise.resolve().then(() => load(page)).then(data => {
      if (active && requestId.current === id) setResult({ load, refreshKey, page, retry, data, error: '' });
    }).catch(cause => {
      if (active && requestId.current === id) setResult({ load, refreshKey, page, retry, data: null, error: cause instanceof Error ? cause.message : 'Unable to load records. Please retry.' });
    });
    return () => { active = false; };
  }, [page, load, refreshKey, retry]);

  function changePage(next: number) { setPagination({ page: next, load, refreshKey }); }

  return <section className="resource-table" aria-label={label} aria-busy={loading}>
    {error ? <div className="table-error"><Notice error>{error}</Notice><Button type="button" variant="secondary" onClick={() => setRetry(value => value + 1)}><RotateCw size={16} aria-hidden="true" />Retry loading</Button></div> : data?.items.length === 0 ? <div className="empty-state"><h3>No records found</h3><p>{emptyMessage}</p></div> : <>
      {loading && <span className="sr-only" role="status">Loading {label.toLowerCase()}…</span>}
      <div className="table-wrap" role="region" aria-label={`${label} table — scroll horizontally to see all columns`} tabIndex={0}>
        <table>
          <caption className="sr-only">{label}</caption>
          <thead><tr>{columns.map(column => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead>
          <tbody>{loading ? Array.from({ length: 5 }, (_, row) => <tr key={row} aria-hidden="true">{columns.map(column => <td key={column.label}><span className="table-skeleton" /></td>)}</tr>) : data?.items.map(row => <tr key={row.id}>{columns.map(column => <td key={column.label}>{column.render(row)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </>}
    <div className="pagination">
      <span className="pagination-summary" aria-live="polite">{data ? `${data.items.length} ${data.items.length === 1 ? 'record' : 'records'} on page ${page}` : `Page ${page}`}</span>
      <div className="pagination-controls">
        <Button type="button" variant="secondary" disabled={page === 1 || loading} onClick={() => changePage(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</Button>
        <Button type="button" variant="secondary" disabled={!data?.has_more || loading} onClick={() => changePage(page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></Button>
      </div>
    </div>
  </section>;
}
