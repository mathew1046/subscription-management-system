import {ResourceScreen} from '@/features/admin-ui/resource-screen';
export default async function Page({params}:{params:Promise<{resource:string}>}){const {resource}=await params;return <ResourceScreen resource={resource}/>}
