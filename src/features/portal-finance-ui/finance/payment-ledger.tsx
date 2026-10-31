'use client';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {api} from '@/lib/client';
import type {Page, Payment, ReportPayment} from '@/lib/contracts';
import {Button, Notice} from '@/components/ui';

const methods: Record<Payment['method'], string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', upi: 'UPI', other: 'Other',
};

export function PaymentLedger({payments, onPageChange}: {
  payments: Page<ReportPayment>;
  onPageChange: (page: number) => void;
}) {
  const names = useRef(new Map<string, string>());
  const [revision, setRevision] = useState(0);
  const [resolution, setResolution] = useState<{payments: Page<ReportPayment>; pending: boolean; failed: boolean} | null>(null);
  useEffect(() => {
    let active = true;
    const invoiceIds = [...new Set(payments.items.map(payment => payment.invoice_id))].filter(id => !names.current.has(id));
    let cursor = 0;
    let failed = false;
    setResolution({payments, pending: invoiceIds.length > 0, failed: false});
    async function resolveNames() {
      while (active && cursor < invoiceIds.length) {
        const invoiceId = invoiceIds[cursor++];
        try {
          const invoice = await api.invoice(invoiceId);
          if (active) names.current.set(invoiceId, invoice.customer_snapshot.name);
        } catch { failed = true; }
      }
    }
    // Only resolve the visible page, with at most four requests in flight.
    void Promise.all(Array.from({length: Math.min(4, invoiceIds.length)}, resolveNames)).then(() => {
      if (active) setResolution({payments, pending: false, failed});
    });
    return () => { active = false; };
  }, [payments, revision]);

  const current = resolution?.payments === payments ? resolution : null;
  return <section aria-labelledby="finance-payments-title">
    <h2 id="finance-payments-title">Payment ledger</h2>
    <p className="text-muted">Payments recorded in the selected UTC date range, newest first. These are recorded receipts, not online charges.</p>
    {payments.items.length === 0 ? <div className="empty-state" role="status">
      <h3>{payments.page > 1 ? 'No payments on this page' : 'No payments in this period'}</h3>
      <p>{payments.page > 1 ? 'Return to the previous page or change the report filters.' : 'Try another date range or customer. No payments were returned for this selection.'}</p>
    </div> : <>
      <p className="table-scroll-hint">Scroll horizontally to see every payment field on smaller screens.</p>
      <div className="table-wrap" role="region" aria-label="Recorded payments" tabIndex={0}>
        <table>
          <caption className="sr-only">Payments for the applied report filters; amounts are returned by the server.</caption>
          <thead><tr><th scope="col">Paid on (UTC)</th><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Method</th><th scope="col">Note</th><th scope="col">Amount</th></tr></thead>
          <tbody>{payments.items.map(payment => <tr key={payment.id}>
            <td><time dateTime={payment.paid_on}>{payment.paid_on}</time></td>
            <th scope="row"><Link className="text-link" href={`/portal/invoices/${payment.invoice_id}`}>{payment.invoice_number}</Link></th>
            <td>{names.current.get(payment.invoice_id) ?? (current?.pending !== false ? 'Loading customer…' : 'Customer name unavailable')}
              {!names.current.has(payment.invoice_id) && <span className="record-reference">Open the invoice for customer details.</span>}
            </td>
            <td>{methods[payment.method] ?? payment.method}</td>
            <td style={{maxWidth: '32ch', whiteSpace: 'pre-wrap'}}>{payment.note || <span className="text-muted">No note</span>}</td>
            <td style={{whiteSpace: 'nowrap'}}>{payment.currency} {payment.amount}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {current?.pending && <Notice>Loading saved customer names. Payment amounts and dates are already available.</Notice>}
      {current?.failed && <>
        <Notice error>Some customer names could not be loaded. The payment ledger is still available; open an invoice for its saved customer details.</Notice>
        <Button type="button" variant="secondary" onClick={() => setRevision(value => value + 1)}>Retry customer names</Button>
      </>}
    </>}
    <nav className="pagination" aria-label="Payment ledger pages">
      <span className="pagination-summary">Page {payments.page} · {payments.items.length} payments on this page · Up to {payments.page_size} per page</span>
      <div className="pagination-controls">
        <Button type="button" variant="secondary" disabled={payments.page <= 1} onClick={() => onPageChange(payments.page - 1)}>Previous payments</Button>
        <Button type="button" variant="secondary" disabled={!payments.has_more} onClick={() => onPageChange(payments.page + 1)}>Next payments</Button>
      </div>
    </nav>
  </section>;
}
