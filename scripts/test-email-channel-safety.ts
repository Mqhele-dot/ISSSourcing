import assert from "node:assert/strict";
const keys=["EMAIL_HOST","EMAIL_USER","EMAIL_PASS","ALLOW_ETHEREAL_TEST_ACCOUNT"];
const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
try {
  process.env.EMAIL_HOST="";process.env.EMAIL_USER="";process.env.EMAIL_PASS="";process.env.ALLOW_ETHEREAL_TEST_ACCOUNT="false";
  const {sendEmail}=await import("../server/services/email-service");
  const message={to:"test@example.invalid",subject:"Test-owned safety check",text:"No supplier delivery",html:"<p>No supplier delivery</p>"};
  const unavailable=await sendEmail(message);
  assert.equal(unavailable.success,false);assert.match(unavailable.error!.message,/not configured/);
  let attempts=0;
  const mocked=await sendEmail(message,{sendMail:async()=>{attempts++;return {messageId:"mock-only"};}} as any);
  assert.equal(mocked.success,true);assert.equal(attempts,1);assert.equal(mocked.info.messageId,"mock-only");
  process.env.EMAIL_HOST="   ";process.env.EMAIL_USER="  ";process.env.EMAIL_PASS="  ";
  assert.equal((await sendEmail(message)).success,false,"Whitespace is not a configured channel");
  console.log("Email safety passed: unconfigured/blank channels cannot report sent; explicit mocks remain testable without real delivery.");
}finally{for(const [key,value]of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
