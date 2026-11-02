import {pathToFileURL} from 'node:url';
import {runCompactIsolatedWorker,type CompactWorkerRequest} from '../server/modules/exports/compact-isolated-worker';

// Test-only parent. It has no DB/provider imports and never publishes a result.
process.once('message',async(message:{request:CompactWorkerRequest;modulePath?:string})=>{
  try{
    const run=message.modulePath?(await import(pathToFileURL(message.modulePath).href)).runCompactIsolatedWorker as typeof runCompactIsolatedWorker:runCompactIsolatedWorker;
    await run(message.request,{onStarted:pid=>process.send?.({type:'worker',pid}),onWriting:()=>process.send?.({type:'phase',stage:'writing'}),onStage:stage=>process.send?.({type:'phase',stage})});
    process.send?.({type:'completed'});
  }catch{process.send?.({type:'failed'});}
  if(process.connected)process.disconnect();
});
