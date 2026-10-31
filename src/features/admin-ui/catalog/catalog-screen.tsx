'use client';

import Link from 'next/link';
import {api} from '@/lib/client';
import type {Resource} from '@/lib/contracts';
import {Button, Notice, Status} from '@/components/ui';
import {useAdminSession} from '@/features/admin-ui/shared';
import {CatalogWorkspace} from './catalog-workspace';
import {CustomerEditor, DiscountEditor, PlanEditor, ProductEditor, StaffEditor, TaxEditor, TemplateEditor, VariantEditor, productPayload} from './editors';

export function CatalogScreen({resource}:{resource:Resource|'staff'}) {
  const {user,loading,error,reload}=useAdminSession();
  if(loading)return <Notice>Loading workspace access…</Notice>;
  if(error)return <><Notice error>{error}</Notice><Button variant="secondary" onClick={reload}>Retry access check</Button></>;
  if(!user || user.role==='customer')return <Notice error>Administrator or staff access is required for this workspace.</Notice>;
  const canManage=user.role==='admin';
  if((resource==='staff' || resource==='quotation-templates') && !canManage)return <Notice error>Only administrators can access {resource==='staff' ? 'staff accounts' : 'quotation templates'}.</Notice>;

  switch(resource) {
    case 'products':return <CatalogWorkspace key={resource} title="Products" singular="product" description="Manage the products, internal costs and sale prices used in new agreements." canManage={canManage}
      load={page=>api.list('products',{page})} create={input=>api.create('products',input)} update={(id,input)=>api.update('products',id,input)}
      archive={record=>api.update('products',record.id,{...productPayload(record),archived:true})} canArchive={record=>!record.archived} Editor={ProductEditor}
      columns={[
        {label:'Type',render:record=>record.type},
        {label:'Sale price',render:record=>record.sale_price},
        {label:'Internal cost',render:record=>record.cost_price},
        {label:'Availability',render:record=><Status>{record.archived ? 'Archived' : 'Available'}</Status>},
        {label:'Notes',render:record=>record.notes || '—'},
      ]}/>;
    case 'variants':return <CatalogWorkspace key={resource} title="Variants" singular="variant" description="Define product options and their additional prices." canManage={canManage}
      load={page=>api.list('variants',{page})} create={input=>api.create('variants',input)} update={(id,input)=>api.update('variants',id,input)} Editor={VariantEditor}
      columns={[{label:'Product reference',render:record=>record.product_id},{label:'Additional price',render:record=>record.price_delta}]}/>;
    case 'plans':return <CatalogWorkspace key={resource} title="Plans" singular="plan" description="Set recurring base fees, billing cadence and the policies for new subscriptions." canManage={canManage}
      load={page=>api.list('plans',{page})} create={input=>api.create('plans',input)} update={(id,input)=>api.update('plans',id,input)} Editor={PlanEditor}
      columns={[
        {label:'Additional base fee',render:record=>record.price},
        {label:'Cadence',render:record=>record.cadence},
        {label:'Minimum quantity',render:record=>record.min_quantity},
        {label:'Availability',render:record=><>{record.available_from} – {record.available_until || 'No end date'}</>},
        {label:'Policy',render:record=><details><summary>View policy</summary><dl className="detail-list"><dt>Auto-close at end</dt><dd>{record.auto_close ? 'Yes' : 'No'}</dd><dt>Early closure</dt><dd>{record.allow_close ? 'Allowed' : 'Not allowed'}</dd><dt>Pause</dt><dd>{record.allow_pause ? 'Allowed' : 'Not allowed'}</dd><dt>Renewal</dt><dd>{record.allow_renew ? 'Allowed' : 'Not allowed'}</dd></dl></details>},
      ]}/>;
    case 'customers':return <CatalogWorkspace key={resource} title="Customers" singular="customer" description="Maintain billing contact details without changing portal account links." canManage
      load={page=>api.list('customers',{page})} create={input=>api.create('customers',input)} update={(id,input)=>api.update('customers',id,input)} Editor={CustomerEditor}
      columns={[{label:'Email',render:record=>record.email},{label:'Billing address',render:record=>record.address || 'Not provided'}]}/>;
    case 'taxes':return <CatalogWorkspace key={resource} title="Taxes" singular="tax" description="Configure percentage rates available to new subscription lines." canManage={canManage}
      load={page=>api.list('taxes',{page})} create={input=>api.create('taxes',input)} update={(id,input)=>api.update('taxes',id,input)} Editor={TaxEditor}
      columns={[{label:'Rate',render:record=>`${record.rate}%`}]}/>;
    case 'discounts':return <CatalogWorkspace key={resource} title="Discounts" singular="discount" description="Configure eligibility, validity and usage caps. Invoice savings are calculated by the server." canManage={canManage}
      load={page=>api.list('discounts',{page})} create={input=>api.create('discounts',input)} update={(id,input)=>api.update('discounts',id,input)} Editor={DiscountEditor}
      columns={[
        {label:'Value',render:record=>record.kind==='percentage' ? `${record.value}%` : `${record.value} fixed`},
        {label:'Validity',render:record=><>{record.starts_on} – {record.ends_on}</>},
        {label:'Uses / cap',render:record=>`${record.uses} / ${record.max_uses}`},
        {label:'Eligibility',render:record=><details><summary>View conditions</summary><dl className="detail-list"><dt>Minimum purchase</dt><dd>{record.min_purchase}</dd><dt>Minimum quantity</dt><dd>{record.min_quantity}</dd><dt>Product scope</dt><dd>{record.product_id || 'All eligible products'}</dd></dl></details>},
      ]}/>;
    case 'quotation-templates':return <CatalogWorkspace key={resource} title="Quotation templates" singular="template" description="Reusable plan and product selections for preparing a new customer agreement." canManage={canManage}
      load={page=>api.list('quotation-templates',{page})} create={input=>api.create('quotation-templates',input)} update={(id,input)=>api.update('quotation-templates',id,input)} Editor={TemplateEditor}
      columns={[{label:'Plan reference',render:record=>record.plan_id},{label:'Valid for',render:record=>`${record.valid_days} days`},{label:'Lines',render:record=>record.lines.length}]}
      extraActions={record=><Link className="text-link" href={`/admin/subscriptions/new?template=${encodeURIComponent(record.id)}`}>Use template</Link>}/>;
    case 'staff':return <CatalogWorkspace key={resource} title="Staff" singular="staff account" description="Create staff access for customer and subscription operations." canManage={canManage}
      load={page=>api.staff({page})} create={input=>api.createStaff(input)} Editor={StaffEditor}
      columns={[{label:'Email',render:record=>record.email},{label:'Role',render:record=><Status>{record.role}</Status>}]}/>;
  }
}
