'use client';

import {useState, type ChangeEvent} from 'react';
import {z} from 'zod';
import {Field, Select, Textarea} from '@/components/ui';
import {LookupSelect, LineEditor} from '@/features/admin-ui/shared';
import {
  productInput, variantInput, planInput, customerInput, taxInput, discountInput, templateInput, registration, lineInput,
  type Resource, type ResourceMap, type ResourceInput, type User,
} from '@/lib/contracts';
import {Checkbox, EditorForm, today} from './form-helpers';

export interface EditorProps<K extends Resource> {
  record:ResourceMap[K]|null;
  onSave:(input:ResourceInput<K>)=>Promise<void>;
  onCancel:()=>void;
  pending:boolean;
  error:string;
}

export function productPayload(record:ResourceMap['products']):z.output<typeof productInput> {
  return {name:record.name,type:record.type,sale_price:record.sale_price,cost_price:record.cost_price,notes:record.notes,archived:record.archived};
}

export function ProductEditor({record,...props}:EditorProps<'products'>) {
  const [value,setValue]=useState(()=>record ? productPayload(record) : {name:'',type:'',sale_price:'0',cost_price:'0',notes:'',archived:false});
  return <EditorForm schema={productInput} value={value} {...props} saveLabel={record ? 'Save product' : 'Create product'}>
    <div className="form-grid">
      <Field label="Product name" autoFocus required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <Field label="Product type" required maxLength={200} value={value.type} onChange={e=>setValue({...value,type:e.target.value})}/>
      <Field label="Sale price" required inputMode="decimal" value={value.sale_price} onChange={e=>setValue({...value,sale_price:e.target.value})}/>
      <Field label="Cost price (internal)" required inputMode="decimal" value={value.cost_price} onChange={e=>setValue({...value,cost_price:e.target.value})}/>
    </div>
    <Textarea label="Notes" maxLength={4000} rows={3} value={value.notes} onChange={(e:ChangeEvent<HTMLTextAreaElement>)=>setValue({...value,notes:e.target.value})}/>
    <Checkbox label="Archived — unavailable for new subscription lines" checked={value.archived} onChange={archived=>setValue({...value,archived})}/>
    <p className="text-muted">Enter exact nonnegative prices with up to two decimal places. Existing subscription prices are not changed.</p>
  </EditorForm>;
}

export function VariantEditor({record,...props}:EditorProps<'variants'>) {
  const [value,setValue]=useState<z.output<typeof variantInput>>(()=>record ? {product_id:record.product_id,name:record.name,price_delta:record.price_delta} : {product_id:'',name:'',price_delta:'0'});
  return <EditorForm schema={variantInput} value={value} {...props} saveLabel={record ? 'Save variant' : 'Create variant'}>
    <div className="form-grid">
      <LookupSelect resource="products" label="Product" value={value.product_id} disabled={props.pending} onChange={(product_id:string)=>setValue({...value,product_id})}/>
      <Field label="Variant name" required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <Field label="Additional price" required inputMode="decimal" value={value.price_delta} onChange={e=>setValue({...value,price_delta:e.target.value})}/>
    </div>
    <p className="text-muted">A nonnegative addition to the product sale price, not a replacement price.</p>
  </EditorForm>;
}

export function PlanEditor({record,...props}:EditorProps<'plans'>) {
  const [value,setValue]=useState<z.output<typeof planInput>>(()=>record ? {
    name:record.name,price:record.price,cadence:record.cadence,min_quantity:record.min_quantity,available_from:record.available_from,available_until:record.available_until,
    auto_close:record.auto_close,allow_close:record.allow_close,allow_pause:record.allow_pause,allow_renew:record.allow_renew,
  } : {name:'',price:'0',cadence:'monthly',min_quantity:1,available_from:today(),available_until:null,auto_close:true,allow_close:true,allow_pause:false,allow_renew:true});
  return <EditorForm schema={planInput} value={value} {...props} saveLabel={record ? 'Save plan' : 'Create plan'}>
    <div className="form-grid">
      <Field label="Plan name" required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <Field label="Recurring base fee" required inputMode="decimal" value={value.price} onChange={e=>setValue({...value,price:e.target.value})}/>
      <Select label="Billing cadence" value={value.cadence} onChange={(e:ChangeEvent<HTMLSelectElement>)=>setValue({...value,cadence:e.target.value as typeof value.cadence})}>
        <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
      </Select>
      <Field label="Minimum quantity" required type="number" min={1} max={100000} step={1} value={Number.isNaN(value.min_quantity) ? '' : value.min_quantity} onChange={e=>setValue({...value,min_quantity:e.target.valueAsNumber})}/>
      <Field label="Available from" required type="date" value={value.available_from} onChange={e=>setValue({...value,available_from:e.target.value})}/>
      <Field label="Available until (optional)" type="date" min={value.available_from} value={value.available_until || ''} onChange={e=>setValue({...value,available_until:e.target.value || null})}/>
    </div>
    <p className="text-muted">The recurring base fee is additional to product and variant line prices. Set it to 0 for line-only pricing. The base fee is tax-free.</p>
    <h3>Subscription policy</h3>
    <div className="form-grid">
      <Checkbox label="Automatically close at the end date" checked={value.auto_close} onChange={auto_close=>setValue({...value,auto_close})}/>
      <Checkbox label="Allow early closure" checked={value.allow_close} onChange={allow_close=>setValue({...value,allow_close})}/>
      <Checkbox label="Allow pause and resume" checked={value.allow_pause} onChange={allow_pause=>setValue({...value,allow_pause})}/>
      <Checkbox label="Allow renewal" checked={value.allow_renew} onChange={allow_renew=>setValue({...value,allow_renew})}/>
    </div>
    <p className="text-muted">Changes apply to new subscriptions; existing subscriptions retain their saved terms.</p>
  </EditorForm>;
}

export function CustomerEditor({record,...props}:EditorProps<'customers'>) {
  const [value,setValue]=useState(()=>({name:record?.name || '',email:record?.email || '',address:record?.address || ''}));
  return <EditorForm schema={customerInput} value={value} {...props} saveLabel={record ? 'Save customer' : 'Create customer'}>
    <div className="form-grid">
      <Field label="Customer name" autoComplete="organization" required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <Field label="Email" autoComplete="email" required type="email" maxLength={254} value={value.email} onChange={e=>setValue({...value,email:e.target.value})}/>
    </div>
    <Textarea label="Billing address" autoComplete="street-address" maxLength={2000} rows={4} value={value.address} onChange={(e:ChangeEvent<HTMLTextAreaElement>)=>setValue({...value,address:e.target.value})}/>
    <p className="text-muted">This updates contact details only. Portal account links are managed separately and remain unchanged.</p>
  </EditorForm>;
}

export function TaxEditor({record,...props}:EditorProps<'taxes'>) {
  const [value,setValue]=useState(()=>({name:record?.name || '',rate:record?.rate || '0'}));
  return <EditorForm schema={taxInput} value={value} {...props} saveLabel={record ? 'Save tax' : 'Create tax'}>
    <div className="form-grid">
      <Field label="Tax name" required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <Field label="Tax rate (%)" required inputMode="decimal" value={value.rate} onChange={e=>setValue({...value,rate:e.target.value})}/>
    </div>
    <p className="text-muted">Enter a rate from 0 to 100 with up to four decimal places. Existing invoice tax snapshots do not change.</p>
  </EditorForm>;
}

export function DiscountEditor({record,...props}:EditorProps<'discounts'>) {
  const [value,setValue]=useState<z.output<typeof discountInput>>(()=>record ? {
    name:record.name,kind:record.kind,value:record.value,min_purchase:record.min_purchase,min_quantity:record.min_quantity,
    starts_on:record.starts_on,ends_on:record.ends_on,max_uses:record.max_uses,product_id:record.product_id,
  } : {name:'',kind:'fixed',value:'0',min_purchase:'0',min_quantity:1,starts_on:today(),ends_on:today(),max_uses:1,product_id:null});
  return <EditorForm schema={discountInput} value={value} {...props} saveLabel={record ? 'Save discount' : 'Create discount'}>
    <div className="form-grid">
      <Field label="Discount name" required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <Select label="Discount type" value={value.kind} onChange={(e:ChangeEvent<HTMLSelectElement>)=>setValue({...value,kind:e.target.value as typeof value.kind})}><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></Select>
      <Field label={value.kind==='fixed' ? 'Discount amount' : 'Discount percentage'} required inputMode="decimal" value={value.value} onChange={e=>setValue({...value,value:e.target.value})}/>
      <Field label="Minimum purchase amount" required inputMode="decimal" value={value.min_purchase} onChange={e=>setValue({...value,min_purchase:e.target.value})}/>
      <Field label="Minimum quantity" required type="number" min={1} step={1} value={Number.isNaN(value.min_quantity) ? '' : value.min_quantity} onChange={e=>setValue({...value,min_quantity:e.target.valueAsNumber})}/>
      <Field label="Usage cap" required type="number" min={Math.max(1,record?.uses || 0)} max={10000000} step={1} value={Number.isNaN(value.max_uses) ? '' : value.max_uses} onChange={e=>setValue({...value,max_uses:e.target.valueAsNumber})}/>
      <Field label="Starts on" required type="date" value={value.starts_on} onChange={e=>setValue({...value,starts_on:e.target.value})}/>
      <Field label="Ends on" required type="date" min={value.starts_on} value={value.ends_on} onChange={e=>setValue({...value,ends_on:e.target.value})}/>
      <LookupSelect resource="products" label="Product scope (optional)" optional disabled={props.pending} value={value.product_id || ''} onChange={(product_id:string)=>setValue({...value,product_id:product_id || null})}/>
    </div>
    {record && <p>Consumed uses: <strong>{record.uses}</strong> <span className="text-muted">(read-only)</span></p>}
    <p className="text-muted">Leave product scope empty to apply across eligible lines. Go determines eligibility and usage when invoices are generated; cancelled invoices do not restore uses automatically.</p>
  </EditorForm>;
}

export function TemplateEditor({record,...props}:EditorProps<'quotation-templates'>) {
  const [value,setValue]=useState<z.output<typeof templateInput>>(()=>record ? {
    name:record.name,plan_id:record.plan_id,valid_days:record.valid_days,
    lines:record.lines.map(line=>({product_id:line.product_id,variant_id:line.variant_id,quantity:line.quantity,tax_id:line.tax_id})),
  } : {name:'',plan_id:'',valid_days:30,lines:[{product_id:'',variant_id:null,quantity:1,tax_id:null}]});
  return <EditorForm schema={templateInput} value={value} {...props} saveLabel={record ? 'Save template' : 'Create template'}>
    <div className="form-grid">
      <Field label="Template name" required maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <LookupSelect resource="plans" label="Plan" disabled={props.pending} value={value.plan_id} onChange={(plan_id:string)=>setValue({...value,plan_id})}/>
      <Field label="Quotation validity (days)" required type="number" min={1} max={365} step={1} value={Number.isNaN(value.valid_days) ? '' : value.valid_days} onChange={e=>setValue({...value,valid_days:e.target.valueAsNumber})}/>
    </div>
    <h3>Template lines</h3>
    <LineEditor value={value.lines} onChange={(lines:z.input<typeof lineInput>[])=>setValue({...value,lines:lines.map(line=>({product_id:line.product_id,quantity:line.quantity,variant_id:line.variant_id || null,tax_id:line.tax_id || null}))})} disabled={props.pending}/>
    <p className="text-muted">Using this template copies its plan and lines into a new subscription draft. Prices are validated by the server when the subscription is saved.</p>
  </EditorForm>;
}

export function StaffEditor({onSave,...props}:{record:User|null;onSave:(input:z.input<typeof registration>)=>Promise<void>;onCancel:()=>void;pending:boolean;error:string}) {
  const [value,setValue]=useState({name:'',email:'',password:''});
  return <EditorForm schema={registration} value={value} {...props} onSave={onSave} beforeSave={()=>setValue(current=>({...current,password:''}))} saveLabel="Create staff account">
    <div className="form-grid">
      <Field label="Full name" required autoComplete="name" maxLength={200} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <Field label="Email" required type="email" autoComplete="off" maxLength={254} value={value.email} onChange={e=>setValue({...value,email:e.target.value})}/>
      <Field label="Initial password" required type="password" autoComplete="new-password" minLength={9} aria-describedby="staff-password-help" value={value.password} onChange={e=>setValue({...value,password:e.target.value})}/>
    </div>
    <p className="text-muted" id="staff-password-help">Use at least 9 characters, an uppercase letter, a lowercase letter and a symbol; at most 128 UTF-8 bytes. This form clears the password when a creation request is sent and does not persist it. Re-enter it if the request fails.</p>
    <p className="text-muted">This creates a staff account only. No administrator role can be selected here.</p>
  </EditorForm>;
}
