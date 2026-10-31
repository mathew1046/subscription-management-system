import type { ApiResult, Resource, ResourceInput, ResourceMap, Page, Subscription, SubscriptionDetail, Invoice, InvoiceDetail, ListParams, User, Report, Payment } from './contracts';
import type { z } from 'zod';
import type { registration, credentials, subscriptionInput, lifecycleInput, paymentInput } from './contracts';
export class ApiError extends Error { constructor(public status:number,public code:string,message:string,public requestId:string) {super(message);} }
async function request<T>(path:string,method='GET',body?:unknown):Promise<T> {
 const res=await fetch(`/api/${path}`,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
 let result:ApiResult<T>;
 try { result=await res.json(); } catch { throw new ApiError(res.status,'UNAVAILABLE','The API is unavailable. Start the Go service and check its configuration.',res.headers.get('X-Request-ID')||''); }
 if('error' in result) throw new ApiError(res.status,result.error.code,result.error.message,result.request_id);
 return result.data;
}
function params(input:ListParams={}) { return new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])).toString(); }
export const api={
 me:()=>request<User>('auth/me'),login:(v:z.input<typeof credentials>)=>request<User>('auth/login','POST',v),
 signup:(v:z.input<typeof registration>)=>request<User>('auth/signup','POST',v),logout:()=>request<{ok:boolean}>('auth/logout','POST',{}),
 forgotPassword:(email:string)=>request<{ok:boolean}>('auth/forgot-password','POST',{email}),
 resetPassword:(token:string,password:string)=>request<{ok:boolean}>('auth/reset-password','POST',{token,password}),
 list:<K extends Resource>(resource:K,p?:ListParams)=>request<Page<ResourceMap[K]>>(`${resource}?${params(p)}`),
 create:<K extends Resource>(resource:K,input:ResourceInput<K>)=>request<ResourceMap[K]>(resource,'POST',input),
 update:<K extends Resource>(resource:K,id:string,input:ResourceInput<K>)=>request<ResourceMap[K]>(`${resource}/${id}`,'PUT',input),
 subscriptions:(p?:ListParams)=>request<Page<Subscription>>(`subscriptions?${params(p)}`),
 subscription:(id:string)=>request<SubscriptionDetail>(`subscriptions/${id}`),
 createSubscription:(input:z.input<typeof subscriptionInput>)=>request<Subscription>('subscriptions','POST',input),
 transition:(id:string,input:z.input<typeof lifecycleInput>)=>request<Subscription>(`subscriptions/${id}/transition`,'POST',input),
 invoices:(p?:ListParams)=>request<Page<Invoice>>(`invoices?${params(p)}`),
 invoice:(id:string)=>request<InvoiceDetail>(`invoices/${id}`),
 invoiceAction:(id:string,action:'confirm'|'cancel'|'send')=>request<{ok:boolean}>(`invoices/${id}/${action}`,'POST',{}),
 recordPayment:(input:z.input<typeof paymentInput>)=>request<Payment>('payments','POST',input),
 report:(p:ListParams={})=>request<Report>(`reports?${params(p)}`),
 runBilling:()=>request<{processed:number;failed:number}>('billing/run','POST',{}),
 staff:(p:ListParams={})=>request<Page<User>>(`staff?${params(p)}`),createStaff:(input:z.input<typeof registration>)=>request<User>('staff','POST',input),
};
