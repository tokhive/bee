export function applyPreviewEvent(request){
 if(!request||typeof request.session!=='string'||!request.session||request.session!==window.__beePreviewSession)throw new Error(`PREVIEW_SESSION_STALE: received_session=${request?.session}; required_session=${window.__beePreviewSession}`);
 const controls=window.__beeMockControls??{};
 const handler=Object.hasOwn(controls,request.action)?controls[request.action]:undefined;
 if(typeof handler!=='function')throw new Error(`PREVIEW_ACTION_UNKNOWN: action=${request.action}; available=${Object.keys(window.__beeMockControls??{}).join(',')}`);
 return handler(request);
}
