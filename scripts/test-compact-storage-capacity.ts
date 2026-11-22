import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {assertCompactStorageCapacity,checkCompactStorageCapacity} from '../server/modules/exports/compact-storage-capacity';

const base={availableBlocks:10n,blockSize:1024n,reservedBytes:4096n,requestedBytes:4096n,headroomBytes:2048n};
assert.doesNotThrow(()=>assertCompactStorageCapacity(base));
assert.throws(()=>assertCompactStorageCapacity({...base,availableBlocks:9n}),/insufficient free disk/);
assert.throws(()=>assertCompactStorageCapacity({...base,reservedBytes:4097n}),/insufficient free disk/);
// All arithmetic stays exact beyond Number.MAX_SAFE_INTEGER.
const huge=BigInt(Number.MAX_SAFE_INTEGER)+100n;
assert.doesNotThrow(()=>assertCompactStorageCapacity({...base,availableBlocks:huge,blockSize:1n,reservedBytes:huge-4096n,requestedBytes:2048n}));
assert.throws(()=>assertCompactStorageCapacity({...base,availableBlocks:huge,blockSize:1n,reservedBytes:huge-4095n,requestedBytes:2048n}),/insufficient free disk/);
for(const invalid of [{availableBlocks:-1n},{blockSize:0n},{reservedBytes:-1n},{requestedBytes:0n},{headroomBytes:-1n}])assert.throws(()=>assertCompactStorageCapacity({...base,...invalid}),/could not be verified/);
// Production default retains 64 MiB even if no other work is registered.
assert.throws(()=>assertCompactStorageCapacity({availableBlocks:64n*1024n*1024n,blockSize:1n,reservedBytes:0n,requestedBytes:1n}),/insufficient free disk/);
const root=await mkdtemp(path.join(os.tmpdir(),'iss-capacity-'));
try{
  await checkCompactStorageCapacity(root,0n,1n);
  await assert.rejects(checkCompactStorageCapacity(path.join(root,'missing-volume'),0n,1n),/could not be verified/);
  await assert.rejects(checkCompactStorageCapacity(root,2n**100n,1n),/insufficient free disk/);
}finally{await rm(root,{recursive:true,force:true});}
console.log(JSON.stringify({status:'passed',checks:['exact free-space boundary','outstanding budgets and safety margin','BigInt arithmetic','invalid volume evidence fails closed','real volume query','unavailable volume','impossible reservation'],limitation:'Admission is conservative, not a filesystem quota or guarantee against unrelated disk consumption.'}));
