import type {SubscriptionDetail} from '@/lib/contracts';

export function SubscriptionQuote({subscription}: {subscription: SubscriptionDetail}) {
  const amount = (value: string) => `${subscription.currency} ${value}`;
  return <section className="form-section" aria-labelledby="quote-heading">
    <h2 id="quote-heading">Quoted recurring charges</h2>
    <p className="text-muted">Snapshotted prices and taxes, calculated by the server before invoice-time discounts. The recurring plan base fee is additional to product lines and tax-free.</p>
    <div className="table-wrap" role="region" aria-label="Subscription quote lines" tabIndex={0}>
      <table><thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Subtotal</th><th scope="col">Tax rate</th><th scope="col">Tax</th><th scope="col">Total</th></tr></thead><tbody>
        <tr><th scope="row">{subscription.plan_snapshot.name}<div className="text-muted">Recurring plan base fee</div></th><td>1</td><td>{amount(subscription.plan_snapshot.price)}</td><td>{amount(subscription.plan_snapshot.price)}</td><td>0%</td><td>Not taxed</td><td>{amount(subscription.plan_snapshot.price)}</td></tr>
        {subscription.lines.map(line => <tr key={line.id}><th scope="row">{line.description}</th><td>{line.quantity}</td><td>{amount(line.unit_price)}</td><td>{amount(line.subtotal)}</td><td>{line.tax_rate}%</td><td>{amount(line.tax_amount)}</td><td>{amount(line.total)}</td></tr>)}
      </tbody></table>
    </div>
    <dl className="detail-list"><div><dt>Subtotal including plan</dt><dd>{amount(subscription.quote_totals.subtotal)}</dd></div><div><dt>Tax</dt><dd>{amount(subscription.quote_totals.tax_total)}</dd></div><div><dt>Recurring quote total</dt><dd><strong>{amount(subscription.quote_totals.total)}</strong></dd></div></dl>
  </section>;
}
