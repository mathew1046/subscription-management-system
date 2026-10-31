import { z } from 'zod';
export const id = z.string().uuid();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===v; }, 'Use a valid YYYY-MM-DD date');
export const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a nonnegative decimal string');
export const password = z.string().refine(v => [...v].length >= 9 && new TextEncoder().encode(v).length <= 128, 'Use at least 9 characters and at most 128 UTF-8 bytes').regex(/\p{Lu}/u).regex(/\p{Ll}/u).regex(/[^\p{L}\p{N}\s]/u);
const name = z.string().trim().min(1).max(200);
const email = z.string().trim().toLowerCase().email().max(254);
export const credentials = z.object({email,password:z.string().min(1).max(128)}).strict();
export const registration = z.object({name,email,password}).strict();
export const resetRequest = z.object({email}).strict();
export const resetComplete = z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password}).strict();
export const productInput = z.object({name,type:name,sale_price:money,cost_price:money,notes:z.string().max(4000).default(''),archived:z.boolean().default(false)}).strict();
export const variantInput = z.object({product_id:id,name,price_delta:money}).strict();
export const planInput = z.object({name,price:money,cadence:z.enum(['daily','weekly','monthly','yearly']),min_quantity:z.number().int().min(1).max(100000),available_from:date,available_until:date.nullable().default(null),auto_close:z.boolean().default(true),allow_close:z.boolean().default(true),allow_pause:z.boolean().default(false),allow_renew:z.boolean().default(true)}).strict().refine(v=>!v.available_until||v.available_until>=v.available_from,'Invalid availability range');
export const taxInput = z.object({name,rate:z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).refine(v=>Number(v)<=100)}).strict();
export const discountInput = z.object({name,kind:z.enum(['fixed','percentage']),value:money,min_purchase:money.default('0'),min_quantity:z.number().int().min(1).default(1),starts_on:date,ends_on:date,max_uses:z.number().int().min(1).max(10000000),product_id:id.nullable().default(null)}).strict().refine(v=>v.ends_on>=v.starts_on && (v.kind!=='percentage'||Number(v.value)<=100),'Invalid discount');
export const customerInput = z.object({name,email,address:z.string().max(2000).default(''),user_id:id.nullable().optional()}).strict();
export const lineInput = z.object({product_id:id,variant_id:id.nullable().default(null),quantity:z.number().int().min(1).max(100000),tax_id:id.nullable().default(null)}).strict();
export const templateInput = z.object({name,plan_id:id,valid_days:z.number().int().min(1).max(365),lines:z.array(lineInput).min(1).max(100)}).strict();
export const subscriptionInput = z.object({customer_id:id,plan_id:id,start_date:date,end_date:date,quote_valid_until:date,payment_terms_days:z.number().int().min(0).max(365).default(14),lines:z.array(lineInput).min(1).max(100)}).strict().refine(v=>v.end_date>v.start_date,'End date must follow start date');
export const lifecycleInput = z.object({action:z.enum(['quote','confirm','activate','pause','resume','close','renew']),end_date:date.optional()}).strict();
export const paymentInput = z.object({invoice_id:id,amount:money.refine(v=>Number(v)>0),method:z.enum(['bank_transfer','cash','card','upi','other']),paid_on:date,note:z.string().max(2000).default(''),request_key:id}).strict();
export const schemas = {products:productInput,variants:variantInput,plans:planInput,taxes:taxInput,discounts:discountInput,customers:customerInput,'quotation-templates':templateInput};
export type Resource = keyof typeof schemas;
export type ResourceInput<K extends Resource> = z.input<(typeof schemas)[K]>;
export type Role = 'admin'|'staff'|'customer';
export interface User { id:string;name:string;email:string;role:Role }
export type Money = string;
export interface Product extends z.output<typeof productInput> {id:string}
export interface Variant extends z.output<typeof variantInput> {id:string}
export interface Plan extends z.output<typeof planInput> {id:string}
export interface Tax extends z.output<typeof taxInput> {id:string}
export interface Discount extends z.output<typeof discountInput> {id:string;uses:number}
export interface Customer extends z.output<typeof customerInput> {id:string;user_id:string|null}
export interface QuotationTemplate extends z.output<typeof templateInput> {id:string}
export interface Subscription {id:string;number:string;customer_id:string;plan_id:string;plan_snapshot:Plan;status:'Draft'|'Quotation'|'Confirmed'|'Active'|'Closed';start_date:string;end_date:string;quote_valid_until:string;next_billing_date:string;billing_anchor:string;payment_terms_days:number;paused:boolean;currency:string;close_reason:'cancelled'|'expired'|null;billing_error:string|null}
export interface SubscriptionLine {id:string;description:string;quantity:number;unit_price:Money;tax_rate:string;product_id:string;variant_id:string|null;subtotal:Money;tax_amount:Money;total:Money}
export interface Invoice {id:string;number:string;subscription_id:string;customer_id:string;customer_snapshot:{name:string;email:string;address:string};period_start:string;period_end:string;issued_on:string;due_on:string;status:'Draft'|'Confirmed'|'Paid'|'Cancelled';currency:string;subtotal:Money;discount_total:Money;tax_total:Money;total:Money;paid:Money;balance:Money}
export interface InvoiceLine {id:string;description:string;quantity:number;unit_price:Money;discount_amount:Money;tax_rate:string;tax_amount:Money;total:Money}
export interface Payment extends z.output<typeof paymentInput> {id:string;created_by:string}
export interface ResourceMap {products:Product;variants:Variant;plans:Plan;taxes:Tax;discounts:Discount;customers:Customer;'quotation-templates':QuotationTemplate}
export interface Page<T> {items:T[];page:number;page_size:number;has_more:boolean}
export interface Report {active_subscriptions:number;billed:Money;collected:Money;outstanding:Money;overdue:Money;currency:string;from:string;to:string}
export type SubscriptionDetail = Subscription & {lines:SubscriptionLine[];quote_totals:{subtotal:Money;tax_total:Money;total:Money}};
export interface InvoiceEmail {status:'not_queued'|'queued'|'retrying'|'failed'|'sent';attempts:number;sent_at:string|null;last_error:string|null}
export interface InvoiceActionResult {ok:boolean;email?:InvoiceEmail}
export type InvoiceDetail = Invoice & {lines:InvoiceLine[];payments:Payment[];email?:InvoiceEmail};
export type ApiResult<T> = {data:T;request_id:string}|{error:{code:string;message:string};request_id:string};
export interface ListParams {page?:number;page_size?:number;status?:string;customer_id?:string;from?:string;to?:string}
