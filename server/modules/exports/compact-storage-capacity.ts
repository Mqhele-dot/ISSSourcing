import {statfs} from 'node:fs/promises';

const defaultHeadroom=64n*1024n*1024n;

/** Conservative capacity admission, not an OS disk reservation. Count the full
 * durable budgets (including retained workspaces) against currently available
 * space. Never assume cleanup succeeded or credit estimated compression. Other
 * applications can still consume the disk: ENOSPC must remain a failed export.
 */
export function assertCompactStorageCapacity(input:{availableBlocks:bigint;blockSize:bigint;reservedBytes:bigint;requestedBytes:bigint;headroomBytes?:bigint}){
  const headroom=input.headroomBytes??defaultHeadroom;
  if(input.availableBlocks<0n||input.blockSize<=0n||input.reservedBytes<0n||input.requestedBytes<=0n||headroom<0n)throw new Error('Private export storage capacity could not be verified. Ask your administrator to check the storage volume; no files were created.');
  const available=input.availableBlocks*input.blockSize;
  if(input.reservedBytes+input.requestedBytes+headroom>available)throw new Error('Private export storage has insufficient free disk space for its reserved budgets and safety margin. Free space through governed retention or choose a smaller export; no files were created.');
}

export async function checkCompactStorageCapacity(root:string,reservedBytes:bigint,requestedBytes:bigint){
  let volume;
  try{volume=await statfs(root,{bigint:true});}
  catch{throw new Error('Private export storage capacity could not be verified. Ask your administrator to check the storage volume; no files were created.');}
  assertCompactStorageCapacity({availableBlocks:volume.bavail,blockSize:volume.bsize,reservedBytes,requestedBytes});
}
