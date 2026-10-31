import type { Resource, ResourceInput, ResourceMap, Page, Subscription, SubscriptionDetail, Invoice, InvoiceDetail, InvoiceActionResult, ListParams, User, Report, Payment } from './contracts';
import type { z } from 'zod';
import type { registration, credentials, subscriptionInput, lifecycleInput, paymentInput } from './contracts';
export class ApiError extends Error { constructor(public status:number,public code:string,message:string,public requestId:string) {super(message);} }
async function request<T>(path:string,method='GET',body?:unknown):Promise<T> {
 let res:Response;
 try {
  res=await fetch(`/api/${path}`,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(25000)});
 } catch {
  throw new ApiError(0,'UNAVAILABLE','The request did not complete. Check the current status before retrying; reuse the original payment request key.','');
 }
 const unavailable=()=>new ApiError(res.status,'UNAVAILABLE','The API returned an invalid response. Check the current status before retrying.',res.headers.get('X-Request-ID')||'');
 let result:unknown;
 try { result=await res.json(); } catch { throw unavailable(); }
 if(typeof result!=='object'||result===null||!('request_id' in result)||typeof result.request_id!=='string') throw unavailable();
 if('error' in result) {
  const error=result.error;
  if(typeof error!=='object'||error===null||!('code' in error)||typeof error.code!=='string'||!('message' in error)||typeof error.message!=='string') throw unavailable();
  throw new ApiError(res.status,error.code,error.message,result.request_id);
 }
 if(!res.ok||!('data' in result)) throw unavailable();
 return result.data as T;
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
 invoiceAction:(id:string,action:'confirm'|'cancel'|'send')=>request<InvoiceActionResult>(`invoices/${id}/${action}`,'POST',{}),
 recordPayment:(input:z.input<typeof paymentInput>)=>request<Payment>('payments','POST',input),
 report:(p:ListParams={})=>request<Report>(`reports?${params(p)}`),
 runBilling:()=>request<{processed:number;failed:number}>('billing/run','POST',{}),
 staff:(p:ListParams={})=>request<Page<User>>(`staff?${params(p)}`),createStaff:(input:z.input<typeof registration>)=>request<User>('staff','POST',input),
};
