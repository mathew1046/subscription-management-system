'use client';

import {useRef, useState, type FormEvent, type ReactNode} from 'react';
import {z} from 'zod';
import {ApiError} from '@/lib/client';
import {Button, Notice} from '@/components/ui';

export function errorMessage(error:unknown):string {
  if(error instanceof ApiError) return `${error.message}${error.requestId ? ` (Request: ${error.requestId})` : ''}`;
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
}

export function ValidationNotice({issues}:{issues:z.core.$ZodIssue[]}) {
  if(!issues.length) return null;
  return <Notice error><strong>Check these fields before saving.</strong><ul>{issues.map((issue,index)=><li key={index}>{issue.path.length ? `${issue.path.join(' / ').replaceAll('_',' ')}: ` : ''}{issue.message}</li>)}</ul></Notice>;
}

export function EditorForm<S extends z.ZodType>({schema,value,onSave,pending,error,onCancel,children,saveLabel='Save changes',beforeSave}:{
  schema:S;value:unknown;onSave:(value:z.output<S>)=>Promise<void>;pending:boolean;error:string;onCancel:()=>void;children:ReactNode;saveLabel?:string;beforeSave?:()=>void;
}) {
  const [issues,setIssues]=useState<z.core.$ZodIssue[]>([]);
  const submitting=useRef(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(pending || submitting.current) return;
    const result=schema.safeParse(value);
    if(!result.success) {setIssues(result.error.issues);return;}
    setIssues([]);
    submitting.current=true;
    beforeSave?.();
    try {await onSave(result.data)} finally {submitting.current=false}
  }
  return <form onSubmit={submit}>
    <ValidationNotice issues={issues}/>
    {error && <Notice error>{error}</Notice>}
    <fieldset disabled={pending} className="form-section">{children}</fieldset>
    <div className="form-actions">
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : saveLabel}</Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
}

export function Checkbox({label,checked,onChange}:{label:string;checked:boolean;onChange:(checked:boolean)=>void}) {
  return <label className="checkbox-field"><input type="checkbox" checked={checked} onChange={event=>onChange(event.target.checked)}/><span>{label}</span></label>;
}

export const today=()=>new Date().toISOString().slice(0,10);
