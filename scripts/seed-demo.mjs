// Local demo data only. Run from the repo root with Node 24:
// node --env-file=.env.demo.local scripts/seed-demo.mjs
// No new architecture pattern: bounded API calls preserve server-side business rules.
import { chmod, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const origin = 'http://localhost:3000';
const statePath = fileURLToPath(new URL('../.env.demo.data.json', import.meta.url));
const lockPath = `${statePath}.lock`;
const namespace = 'brightloop-local-demo-v1';
const demo = 'DEMO — ';
const sessions = [];
let state;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function credentials(role) {
  const prefix = `DEMO_${role.toUpperCase()}`;
  const email = process.env[`${prefix}_EMAIL`]?.trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`];
  requireValue(email && /^[^\s@]+@[^\s@]+\.(test|local)$/.test(email), `${prefix}_EMAIL must use a .test or .local address.`);
  requireValue(password && [...password].length >= 9 && Buffer.byteLength(password) <= 128 && /\p{Lu}/u.test(password) && /\p{Ll}/u.test(password) && /[^\p{L}\p{N}\s]/u.test(password), `${prefix}_PASSWORD does not meet the password policy.`);
  return { email, password };
}

function client() {
  let cookie;
  const request = async (path, method = 'GET', body) => {
    requireValue(/^[a-z][a-z0-9/?=&_-]*$/i.test(path), 'Invalid local API path.');
    let response;
    try {
      response = await fetch(`${origin}/api/${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(`${method} /api/${path} did not complete; inspect current state before rerunning. No mutation was retried.`);
    }
    let result;
    try { result = await response.json(); } catch {
      throw new Error(`${method} /api/${path}: HTTP ${response.status}, invalid JSON; inspect current state.`);
    }
    if (!response.ok || !result || !('data' in result)) {
      // Do not print response bodies, which could contain credentials or tokens.
      const error = new Error(`${method} /api/${path}: HTTP ${response.status} (${result?.error?.code || 'INVALID_RESPONSE'}), request ${result?.request_id || 'unknown'}.`);
      error.status = response.status;
      throw error;
    }
    const session = response.headers.getSetCookie().find(value => value.startsWith('brightloop_session='));
    if (session) cookie = session.split(';', 1)[0];
    return result.data;
  };
  sessions.push(request);
  return request;
}

async function list(api, resource, filters = {}) {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const result = await api(`${resource}?${new URLSearchParams({ ...filters, page: String(page), page_size: '100' })}`);
    requireValue(Array.isArray(result.items) && typeof result.has_more === 'boolean', `Invalid ${resource} list response.`);
    items.push(...result.items);
    if (!result.has_more) return items;
  }
  throw new Error(`${resource} exceeds the 2,000-record scan bound; stopped without guessing.`);
}

function unique(items, description) {
  requireValue(items.length <= 1, `Ambiguous ${description}; no record was changed.`);
  return items[0];
}

async function save() {
  const temporary = `${statePath}.${process.pid}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(state, null, 2)}\n`);
    await file.sync();
  } finally { await file.close(); }
  await rename(temporary, statePath);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function catalog(api, resource, label, input) {
  const name = `${demo}${label}`;
  let record = unique((await list(api, resource)).filter(item => item.name === name), name);
  if (!record) record = await api(resource, 'POST', { name, ...input });
  requireValue(record.name === name, `Unexpected ${resource} record.`);
  // Reuse demo rules as they currently exist; never reset edited catalog prices.
  state.resources[`${resource}:${label}`] = { id: record.id, name };
  await save();
  return record;
}

async function account(admin, role, login, existing) {
  const api = client();
  if (!existing) {
    await (role === 'staff' ? admin : api)(role === 'staff' ? 'staff' : 'auth/signup', 'POST', {
      name: `${demo}${role === 'staff' ? 'Staff Operator' : 'Portal Customer'}`, ...login,
    });
  }
  // An existing email must authenticate with these exact credentials. Never reset it.
  const user = await api('auth/login', 'POST', login);
  requireValue(user.role === role && user.email === login.email && user.name.startsWith(demo), `Existing ${role} account is not the expected DEMO account.`);
  state.accounts[role] = { id: user.id, email: user.email, name: user.name };
  await save();
  return user;
}

const stages = ['Draft', 'Quotation', 'Confirmed', 'Active'];
async function advance(api, subscription, target) {
  // Never rewind a sample changed by a human or revive a closed subscription.
  if (subscription.status === 'Closed') return subscription;
  while (stages.indexOf(subscription.status) < stages.indexOf(target)) {
    const action = { Draft: 'quote', Quotation: 'confirm', Confirmed: 'activate' }[subscription.status];
    requireValue(action, 'Unexpected subscription lifecycle state.');
    subscription = await api(`subscriptions/${subscription.id}/transition`, 'POST', { action });
  }
  return subscription;
}

function matchesLines(actual, expected) {
  const signature = lines => JSON.stringify(lines.map(line => [line.product_id, line.variant_id ?? null, line.quantity]).sort());
  return signature(actual) === signature(expected);
}

async function subscription(api, label, input, target) {
  let entry = state.subscriptions[label];
  const recovering = !entry;
  if (!entry) {
    entry = state.subscriptions[label] = { label: `${demo}${label}`, input };
    await save(); // Creation intent survives an interrupted response.
  }
  input = entry.input;
  const candidates = (await list(api, 'subscriptions', { customer_id: input.customer_id }))
    .filter(item => (recovering ? ['customer_id', 'plan_id'] : ['customer_id', 'plan_id', 'start_date', 'end_date', 'quote_valid_until', 'payment_terms_days']).every(key => item[key] === input[key]));
  const matching = [];
  for (const candidate of candidates) {
    const detail = await api(`subscriptions/${candidate.id}`);
    if (matchesLines(detail.lines, input.lines)) matching.push(detail);
  }
  let record = unique(matching, entry.label);
  if (recovering && record) {
    for (const key of ['start_date', 'end_date', 'quote_valid_until', 'payment_terms_days']) input[key] = record[key];
  }
  if (entry.id) {
    record = await api(`subscriptions/${entry.id}`);
    requireValue(record.customer_id === input.customer_id && record.plan_id === input.plan_id && matchesLines(record.lines, input.lines), `Saved ${entry.label} no longer matches its demo identity.`);
  }
  if (!record) record = await api('subscriptions', 'POST', input);
  entry.id = record.id;
  await save();
  record = await advance(api, record, target);
  entry.status = record.status;
  entry.paused = record.paused;
  await save();
  return record;
}

function permitsPartial(balance) {
  // Compare a server decimal to the fixed 1.00 sample; do not calculate totals.
  requireValue(/^\d+\.\d{2}$/.test(balance), 'Invalid server balance.');
  const [whole, fraction] = balance.split('.');
  return whole.length > 1 || whole > '1' || (whole === '1' && fraction !== '00');
}

async function invoiceSample(api, label, customer, paymentMode) {
  const entry = state.subscriptions[label];
  const invoices = (await list(api, 'invoices', { customer_id: customer.id }))
    .filter(item => item.subscription_id === entry.id && item.period_start === entry.input.start_date);
  const invoice = unique(invoices, `${label} first-period invoice`);
  requireValue(invoice, `No first-period invoice for ${label}; inspect billing/worker errors and rerun deliberately.`);
  let detail = await api(`invoices/${invoice.id}`);
  entry.invoice_id = detail.id;
  await save();
  if (paymentMode && detail.status !== 'Cancelled') {
    if (detail.status === 'Draft') {
      await api(`invoices/${detail.id}/confirm`, 'POST', {});
      detail = await api(`invoices/${detail.id}`);
    }
    let payment = state.payments[label];
    if (!payment && detail.status !== 'Paid') {
      requireValue(detail.payments.length === 0, `${label} has a manually added payment; stopped instead of changing its balance.`);
      if (paymentMode === 'partial') requireValue(permitsPartial(detail.balance), 'Partial demo requires a server balance above 1.00.');
      payment = state.payments[label] = {
        invoice_id: detail.id, amount: paymentMode === 'partial' ? '1.00' : detail.balance,
        method: 'bank_transfer', paid_on: new Date().toISOString().slice(0, 10),
        note: `${demo}${label} sample payment; no external money moved.`, request_key: randomUUID(),
      };
      await save(); // The complete immutable request is persisted BEFORE posting.
    }
    const recorded = payment && detail.payments.find(item => item.request_key === payment.request_key);
    if (recorded) {
      requireValue(['invoice_id', 'amount', 'method', 'paid_on', 'note'].every(key => recorded[key] === payment[key]), 'Saved payment key has a different server payload.');
    }
    if (payment && !recorded) {
      requireValue(payment.invoice_id === detail.id, 'Saved payment belongs to a different invoice.');
      await api('payments', 'POST', payment);
      detail = await api(`invoices/${detail.id}`);
    }
    const recipient = detail.customer_snapshot.email;
    requireValue(/^[^\s@]+@[^\s@]+\.(test|local)$/.test(recipient), 'Refusing to queue invoice email to a non-demo address.');
    if (detail.email.status === 'not_queued') {
      await api(`invoices/${detail.id}/send`, 'POST', {});
      detail = await api(`invoices/${detail.id}`);
    }
  }
  entry.invoice_status = detail.status;
  entry.invoice_number = detail.number;
  entry.invoice_balance = detail.balance;
  entry.email_status = detail.email?.status;
  await save();
}

async function main() {
  console.log('LOCAL DEMO ONLY: localhost:3000. Mailpit capture must already be configured; this script cannot verify SMTP settings.');
  console.log('WARNING: /api/billing/run processes ALL due active subscriptions and eligible expirations in this local database, not just DEMO records.');
  const logins = Object.fromEntries(['admin', 'staff', 'customer'].map(role => [role, credentials(role)]));
  requireValue(new Set(Object.values(logins).map(value => value.email)).size === 3, 'Demo account emails must be distinct.');
  const today = new Date().toISOString().slice(0, 10);
  try {
    const stat = await lstat(statePath);
    requireValue(stat.isFile() && !stat.isSymbolicLink(), 'Demo manifest must be a regular file.');
    await chmod(statePath, 0o600);
    state = JSON.parse(await readFile(statePath, 'utf8'));
    requireValue(state.namespace === namespace && state.origin === origin, 'Unexpected demo manifest namespace or origin.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { namespace, origin, created_on: today, accounts: {}, resources: {}, subscriptions: {}, payments: {} };
  }
  for (const [role, login] of Object.entries(logins)) {
    requireValue(!state.accounts[role] || state.accounts[role].email === login.email, `Manifest ${role} email differs; retain the original demo credentials.`);
  }
  await save();
  const admin = client();
  const user = await admin('auth/login', 'POST', logins.admin);
  requireValue(user.role === 'admin' && user.email === logins.admin.email, 'Expected the bootstrapped local admin.');
  state.accounts.admin = { id: user.id, email: user.email, name: user.name };
  const staff = unique((await list(admin, 'staff')).filter(item => item.email === logins.staff.email), 'staff email');
  await account(admin, 'staff', logins.staff, staff);
  let customers = await list(admin, 'customers');
  const linked = unique(customers.filter(item => item.email === logins.customer.email), 'portal email');
  const portalUser = await account(admin, 'customer', logins.customer, linked);
  customers = await list(admin, 'customers');
  const portal = unique(customers.filter(item => item.user_id === portalUser.id), 'signup customer profile');
  requireValue(portal && portal.name.startsWith(demo) && portal.email === logins.customer.email, 'Expected the DEMO signup-created customer; no account relinking was attempted.');
  state.resources['customers:Portal Customer'] = { id: portal.id, name: portal.name };
  const studio = await catalog(admin, 'customers', 'Research Studio', { email: 'demo-research@brightloop.test', address: 'DEMO address — no real customer', user_id: null });
  requireValue(studio.email.endsWith('.test') || studio.email.endsWith('.local'), 'Research customer must retain a demo-only email.');
  const workspace = await catalog(admin, 'products', 'Workspace Seat', { type: 'Service', sale_price: '24.00', cost_price: '8.00', notes: 'DEMO only; invented sample catalog.', archived: false });
  const support = await catalog(admin, 'products', 'Support Add-on', { type: 'Service', sale_price: '12.00', cost_price: '3.00', notes: 'DEMO only; invented sample catalog.', archived: false });
  const variant = await catalog(admin, 'variants', 'Priority Seat', { product_id: workspace.id, price_delta: '6.00' });
  const tax = await catalog(admin, 'taxes', 'Illustrative 5 Percent', { rate: '5.0000' });
  const planInput = { min_quantity: 1, available_from: state.created_on, available_until: null, auto_close: true, allow_close: true, allow_pause: true, allow_renew: true };
  const monthly = await catalog(admin, 'plans', 'Monthly Workspace', { ...planInput, price: '5.00', cadence: 'monthly' });
  const yearly = await catalog(admin, 'plans', 'Yearly Workspace', { ...planInput, price: '25.00', cadence: 'yearly' });
  await catalog(admin, 'discounts', 'Workspace Welcome Credit', { kind: 'fixed', value: '2.00', min_purchase: '10.00', min_quantity: 1, starts_on: state.created_on, ends_on: addDays(state.created_on, 730), max_uses: 100, product_id: workspace.id });
  await catalog(admin, 'quotation-templates', 'Monthly Starter Quote', { plan_id: monthly.id, valid_days: 30, lines: [{ product_id: workspace.id, variant_id: variant.id, quantity: 1, tax_id: tax.id }] });

  const scenarios = [
    ['Draft', 'Draft', studio, yearly], ['Quotation', 'Quotation', studio, monthly],
    ['Confirmed', 'Confirmed', portal, yearly], ['Active Paid', 'Active', portal, monthly],
    ['Active Partial', 'Active', portal, monthly], ['Active Draft Invoice', 'Active', studio, monthly],
    ['Paused', 'Active', portal, monthly],
  ];
  for (const [index, [label, target, customer, plan]] of scenarios.entries()) {
    const start = target === 'Active' ? today : addDays(today, 7);
    await subscription(admin, label, {
      customer_id: customer.id, plan_id: plan.id, start_date: start, end_date: addDays(start, 400),
      quote_valid_until: addDays(today, 30), payment_terms_days: 14,
      lines: [{ product_id: workspace.id, variant_id: variant.id, quantity: index + 1, tax_id: tax.id },
        { product_id: support.id, variant_id: null, quantity: 1, tax_id: tax.id }],
    }, target);
  }
  const billing = await admin('billing/run', 'POST', {});
  console.log(`Local billing batch: processed=${billing.processed}, failed=${billing.failed}.`);
  requireValue(billing.failed === 0, 'Billing reported failures; inspect worker logs. No billing retry was attempted.');
  for (const [label, mode] of [['Active Paid', 'full'], ['Active Partial', 'partial'], ['Active Draft Invoice', null], ['Paused', null]]) {
    const entry = state.subscriptions[label];
    const record = await admin(`subscriptions/${entry.id}`);
    const customer = record.customer_id === portal.id ? portal : studio;
    await invoiceSample(admin, label, customer, mode);
    if (label === 'Paused' && record.status === 'Active' && !record.paused) {
      await admin(`subscriptions/${record.id}/transition`, 'POST', { action: 'pause' });
    }
  }
  for (const entry of Object.values(state.subscriptions)) {
    const record = await admin(`subscriptions/${entry.id}`);
    entry.status = record.status;
    entry.paused = record.paused;
    console.log(`${entry.label}: ${entry.id} ${entry.status}${entry.paused ? ' (paused)' : ''}${entry.invoice_id ? `; invoice ${entry.invoice_id} ${entry.invoice_status}, balance=${entry.invoice_balance}, email=${entry.email_status}` : ''}`);
  }
  state.routes = ['/login', '/admin/products', '/admin/plans', '/admin/customers', '/admin/subscriptions', '/finance', '/portal/subscriptions', '/portal/invoices'];
  await save();
  console.log(`DEMO summary: 2 products, 1 variant, 1 tax, 2 plans, 1 scoped discount, 1 template, 2 customers, 7 subscriptions. Manifest: ${statePath}`);
  console.log('Plan base fees are additional to product lines. Totals/balances come from the server; payments are local records, not charges.');
  console.log('Reruns reuse records, do not rewind lifecycle states or reset edited catalog rules. Closed samples are not revived; no overdue/closed sample is created.');
  for (const route of state.routes) console.log(`${origin}${route}`);
  console.log('Mailpit: http://localhost:8025 — queued/sent status is not proof of external delivery.');
}

let lock;
try {
  lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(`${process.pid}\n`);
  await main();
} catch (error) {
  console.error(error.code === 'EEXIST'
    ? `Demo seeder lock exists: ${lockPath}. Ensure no seeder is running before removing a stale lock.`
    : `Demo seed stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Session cookies stay in memory and are never written to the manifest or logs.
  for (const api of sessions) {
    try { await api('auth/logout', 'POST', {}); } catch { console.error('Session cleanup did not complete; session will expire normally.'); }
  }
  if (lock) {
    await lock.close();
    await unlink(lockPath);
  }
}
