import assert from "node:assert/strict";
import {configuredProcurementCapabilityEnabled,erpCapabilityCatalog,resolveCapabilityAvailability} from "../shared/erp-capability-catalog";
for(const phase of [1,2,3,4]){
  const flag=`procurement.phase${phase}Enabled`,key=`phase${phase}Enabled`;
  assert.equal(configuredProcurementCapabilityEnabled(flag,{}),false);
  assert.equal(configuredProcurementCapabilityEnabled(flag,{[key]:false}),false);
  assert.equal(configuredProcurementCapabilityEnabled(flag,{[key]:"false"}),false);
  assert.equal(configuredProcurementCapabilityEnabled(flag,{[key]:true}),true);
}
for(const flag of ["unknown","procurement.phase5Enabled","__proto__","constructor"])
  assert.equal(configuredProcurementCapabilityEnabled(flag,{phase1Enabled:true}),false);
const candidate={...erpCapabilityCatalog[0],featureFlag:"procurement.phase1Enabled",status:"partial" as const};
const disabled=resolveCapabilityAvailability([candidate],flag=>configuredProcurementCapabilityEnabled(flag,{phase1Enabled:false}))[0];
assert.equal(disabled.status,"disabled");assert.equal(disabled.implementationStatus,"partial");
assert.equal(disabled.enablement,"disabled");assert.equal(disabled.verification,"unverified");
const enabled=resolveCapabilityAvailability([candidate],flag=>configuredProcurementCapabilityEnabled(flag,{phase1Enabled:true}))[0];
assert.equal(enabled.status,"partial");assert.equal(enabled.verification,"unverified");
console.log("Capability enablement passed: four tenant flags, unknown/forged values, retained implementation status and separate unverified release evidence.");
