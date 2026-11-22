import type {ExpiredExportFile} from './expired-export-files';

/** One in-process batch at a time. Discovery belongs INSIDE the finally guard:
 * a failed database lookup must not disable every subsequent retention tick.
 * Existing database discovery supplies a bounded batch; no folder scan occurs.
 */
export function createExportRetentionTask(input:{
  list:()=>Promise<ExpiredExportFile[]>;
  expire:(job:ExpiredExportFile)=>Promise<unknown>;
  onFailure:(jobId:number)=>void;
}){
  let running=false;
  return async()=>{
    if(running)return;
    running=true;
    try{
      const jobs=await input.list();
      for(const job of jobs){
        try{
          await input.expire(job);
        }catch{input.onFailure(job.id);}
      }
    }finally{running=false;}
  };
}
