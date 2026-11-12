/** Generates a lookup key; historical origins, journals and proofs stay raw. */
export function normalizeHiveOrigin(input:string):string {
 const bytes=typeof input==='string'?new TextEncoder().encode(input).length:0;
 const reject=(check:string):never=>{throw new Error(`Hive origin rejected: ${check}; input_bytes=${bytes}; credentials and raw input omitted`);};
 if(typeof input!=='string'||bytes===0||bytes>2048||/[\uD800-\uDFFF]/u.test(input))return reject('length or UTF-8 check failed; required=1..2048 UTF-8 bytes');
 if(/[@?#\\%\p{White_Space}\p{Cc}]/u.test(input))return reject('forbidden delimiter or whitespace present');
 const delimiter=input.indexOf('://');
 const scheme=input.slice(0,delimiter).replace(/[A-Z]/g,c=>c.toLowerCase());
 if(delimiter<0||!['https','http'].includes(scheme))return reject('scheme check failed; required=HTTPS or loopback HTTP');
 let authority=input.slice(delimiter+3);
 if(authority.endsWith('/'))authority=authority.slice(0,-1);
 if(!authority||authority.includes('/'))return reject('authority or root path check failed');
 let host=authority,port='',ipv6='';
 if(host.startsWith('[')){
  const end=host.indexOf(']');
  if(end<0)return reject('IPv6 closing bracket missing');
  const suffix=host.slice(end+1);
  if(suffix){if(!suffix.startsWith(':')||suffix.length===1)return reject('IPv6 port check failed');port=suffix.slice(1);}
  host=host.slice(0,end+1);
  try{ipv6=new URL(`http://${host}`).hostname;}catch{return reject('IPv6 literal check failed');}
  if(!host.includes(':'))return reject('IPv6 literal check failed');
 }else{
  const colon=host.indexOf(':');
  if(colon>=0){port=host.slice(colon+1);host=host.slice(0,colon);if(!port)return reject('explicit port missing');}
  if(!host||[...host].some(c=>(c.codePointAt(0)??0)<=127&&!/^[a-zA-Z0-9._-]$/.test(c)))return reject('hostname character check failed');
 }
 if(port){
  if(!/^[0-9]+$/.test(port))return reject('port is not decimal');
  const number=Number(port);if(!Number.isInteger(number)||number<1||number>65535)return reject('port outside 1..65535');
  port=String(number);if(scheme==='https'&&port==='443'||scheme==='http'&&port==='80')port='';
 }
 host=host.replace(/[A-Z]/g,c=>c.toLowerCase());
 if(scheme==='http'&&host!=='localhost'){
  const ipv4=/^127\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})$/.test(host)&&host.split('.').every(p=>Number(p)<=255);
  const loopback6=ipv6==='[::1]'||/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(ipv6);
  if(!ipv4&&!loopback6)return reject('HTTP host is not a standard loopback address');
 }
 return `${scheme}://${host}${port?`:${port}`:''}`;
}
