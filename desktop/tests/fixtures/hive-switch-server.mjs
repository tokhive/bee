// Synthetic protocol boundary for native coordinator tests; no official accounts
// or execution/settlement behavior. Real Hive acceptance belongs to ticket 09.
import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
let expect=null;let faults={};
const operations=new Map();const audit=[];let epoch='';let lease='';let barrier='';let sequence=0;let connected=null;
const work={executions:0,unknown_terminations:0,unsettled:0};
const identity={id:'synthetic-device',name:'Synthetic Mac',owner_id:'synthetic-owner',owner_email:'synthetic@example.com'};
function view(op){return {version:1,device_id:identity.id,owner_id:identity.owner_id,operation_id:op.request.id,state:op.state,request:op.request,seal:op.seal??null,release:op.release??null,receipt:op.receipt??null,current:{epoch,lease,barrier_id:barrier,work}};}
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;audit.push({method:req.method,path:req.url,body});
 const respond=(code,value)=>{const bytes=JSON.stringify(value);res.writeHead(code,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes)});res.end(bytes);};
 if(req.url==='/__audit')return respond(200,audit);
 if(req.url==='/__configure'){expect=body.expect??expect;faults={...faults,...body.faults};Object.assign(work,body.work??{});return respond(200,{ok:true});}
 if(req.url==='/api/bee/pairings'&&faults.initial_pairing_unknown){req.socket.destroy();return;}
 if(req.url==='/api/bee/identity'){if(faults.initial_pairing_unknown)return respond(401,{error:{code:'invalid_device_credential'}});if(faults.identity_after_seal&&[...operations.values()].some(op=>op.state==='sealed'))return respond(faults.identity_after_seal===1?401:faults.identity_after_seal,{error:{code:'invalid_device_credential',message:'synthetic target credential rejected after preparation'}});return respond(200,identity);}
 if(req.url==='/api/bee/device-drain-capabilities'&&faults.capabilities)return respond(faults.capabilities,{error:{code:'unavailable',message:'synthetic capability query failure'}});
 if(req.url==='/api/bee/device-drain-capabilities')return respond(200,{version:1,device_drain:1});
 const match=/^\/api\/bee\/device-drains\/([a-f0-9]{48})(?:\/(begin|seal|release))?$/.exec(req.url);
 if(!match)return respond(404,{error:{code:'fixture_route',message:`unexpected fixture route ${req.method} ${req.url}`}});
 const [,id,action]=match;let op=operations.get(id);
 if(action==='begin'&&faults.begin_before_accept){faults.begin_before_accept--;req.socket.destroy();return;}
 if(!action){if(faults.status)return respond(faults.status,{error:{code:'unavailable',message:'synthetic original status query failure'}});if(op&&op.state==='draining'&&Object.values(work).every(n=>n===0))op.state='ready';if(!op)return respond(200,{version:1,device_id:identity.id,owner_id:identity.owner_id,operation_id:id,state:'absent',request:null,seal:null,release:null,receipt:null,current:{epoch,lease,barrier_id:barrier,work}});return respond(200,view(op));}
 if(action==='begin'){if(!op){if(barrier)return respond(409,{error:{code:'device_drain_conflict',message:`begin barrier occupied: operation=${id} current_barrier=${barrier}`}});op={request:body,state:Object.values(work).every(n=>n===0)?'ready':'draining'};operations.set(id,op);barrier=id;}}
 if(action==='seal'){op.seal=body;epoch=body.id;op.state='sealed';lease='';if(connected){connected.destroy();connected=null;}op.receipt={version:1,seal:body,epoch,connection_retired:true,work};}
 if(action==='release'){if(op?.state==='released')return respond(200,view(op));if(!op&&body.mode==='cancel'){op={request:body.request,state:'absent'};operations.set(id,op);}if(body.mode==='activate'&&expect){const index=JSON.parse(readFileSync(expect.index_path,'utf8'));if(index.current_profile!==expect.target||!index.committed_operation)return respond(409,{error:{code:'index_not_committed',message:'target release observed before durable current profile commit'}});}op.release=body;op.state='released';if(barrier===id)barrier='';}
 if(faults[action]){faults[action]--;req.socket.destroy();return;}
 respond(200,view(op));
});
server.on('upgrade',(req,socket)=>{
 audit.push({method:'UPGRADE',path:req.url});
 const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 lease=`synthetic-lease-${++sequence}`;connected=socket;
 socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Bee-Lease: ${lease}\r\n\r\n`);
 let buffer=Buffer.alloc(0);
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=2){const opcode=buffer[0]&15;let length=buffer[1]&127;const masked=(buffer[1]&128)!==0;let offset=2;if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}if(length===127){socket.destroy();return;}if(buffer.length<offset+(masked?4:0)+length)return;const mask=masked?buffer.subarray(offset,offset+4):null;offset+=masked?4:0;const payload=Buffer.from(buffer.subarray(offset,offset+length));if(mask)for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];buffer=buffer.subarray(offset+length);if(opcode===9)socket.write(Buffer.concat([Buffer.from([0x8a,payload.length]),payload]));if(opcode===8){socket.end(Buffer.from([0x88,0]));return;}}});
 const retired=()=>{if(connected===socket){connected=null;lease='';}};
 socket.on('error',()=>{});socket.on('end',()=>{retired();socket.end();});socket.on('close',retired);
});
server.listen(0,'127.0.0.1',()=>process.stdout.write(`http://127.0.0.1:${server.address().port}\n`));
