import type {RequestHandler} from 'express';
import {RateLimiterMemory,type RateLimiterRes} from 'rate-limiter-flexible';
import {getOptionalTenantContext} from '../../organization-context';
import {sendError} from '../../api-response';

/** Token refresh and retrieval use an existing retained file; neither is export
 * generation request. Keep independent bounded actor/tenant and network budgets
 * without changing the existing expensive-generation limiter or access gates.
 */
export function createExportDownloadRateLimiter(options:{actorPoints?:number;networkPoints?:number;windowSeconds?:number}={}):RequestHandler{
  const actorPoints=options.actorPoints??30,networkPoints=options.networkPoints??120,windowSeconds=options.windowSeconds??60;
  if(![actorPoints,networkPoints,windowSeconds].every(value=>Number.isInteger(value)&&value>0)||actorPoints>networkPoints||networkPoints>10000||windowSeconds>3600)throw new Error('Invalid retained-download rate limits.');
  const actors=new RateLimiterMemory({points:actorPoints,duration:windowSeconds,blockDuration:windowSeconds}),networks=new RateLimiterMemory({points:networkPoints,duration:windowSeconds,blockDuration:windowSeconds});
  return async(req,res,next)=>{
    const tenant=getOptionalTenantContext(),userId=req.user?.id;
    if(!req.isAuthenticated?.()||!tenant||!Number.isSafeInteger(userId)||(userId??0)<1||userId!==tenant.userId||!Number.isSafeInteger(tenant.organizationId)||tenant.organizationId<1){sendError(res,401,'AUTHENTICATION_REQUIRED','Sign in to the correct organization before downloading this file.');return;}
    try{
      await networks.consume(req.ip||req.socket.remoteAddress||'unknown-ip');
      await actors.consume(`${tenant.organizationId}:${userId}`);next();
    }catch(error){
      const limited=error as RateLimiterRes;if(typeof limited?.msBeforeNext!=='number'){next(error);return;}
      const seconds=Math.max(1,Math.ceil(limited.msBeforeNext/1000));res.setHeader('Retry-After',String(seconds));
      sendError(res,429,'EXPORT_DOWNLOAD_RATE_LIMITED',`Please wait ${seconds} seconds before downloading another file.`,{hint:'Your saved export is unchanged. Try the download again after the wait; you do not need to generate it again.'});
    }
  };
}
export const exportDownloadRateLimiter=createExportDownloadRateLimiter();
