import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
export function Button({className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`button ${className}`} {...props}/>;}
export function Field({label,...props}:InputHTMLAttributes<HTMLInputElement>&{label:string}){return <label className="field"><span>{label}</span><input {...props}/></label>;}
export function Panel({title,children}: {title:string;children:ReactNode}){return <section className="panel"><h2>{title}</h2>{children}</section>;}
export function Notice({children,error=false}: {children:ReactNode;error?:boolean}){return <p className={error?'notice error':'notice'} role={error?'alert':'status'}>{children}</p>;}
export function Status({children}: {children:ReactNode}){return <span className="badge">{children}</span>;}
