import type { NextConfig } from 'next';
const config: NextConfig = {
 poweredByHeader:false,
 async rewrites(){ return [{source:'/api/:path*',destination:`${process.env.BACKEND_URL||'http://127.0.0.1:8080'}/api/:path*`}]; },
 async headers(){return [{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'X-Frame-Options',value:'DENY'}]}];}
};
export default config;
