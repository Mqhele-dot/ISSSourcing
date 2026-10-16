/** PostgreSQL errors may be wrapped by Drizzle; never expose SQL or parameters. */
export function stockGuardError(error:unknown):string|null {
  let current=error;
  for(let depth=0;depth<5&&current&&typeof current==="object";depth++) {
    const e=current as {message?:string;code?:string;cause?:unknown};
    if(e.message?.includes("STOCK_QUALITY_HOLD"))return "STOCK_QUALITY_HOLD";
    if(e.message?.includes("STOCK_INSPECTION_RECEIPT_REQUIRED"))return "STOCK_INSPECTION_RECEIPT_REQUIRED";
    if(e.code==="40P01"||e.code==="55P03"||e.code==="40001")return "STOCK_BUSY_RETRY";
    current=e.cause;
  }
  return null;
}
