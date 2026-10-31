import {InvoiceView} from '@/features/portal-finance-ui/records';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <InvoiceView id={id}/>;}
