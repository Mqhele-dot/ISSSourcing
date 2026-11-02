/** Original document evidence, never an implied reporting-currency conversion. */
export function formatDocumentMoney(amount:string|null|undefined,currencyCode:string|null|undefined):string {
  if(!currencyCode?.trim()) return "Unavailable — document currency is missing";
  if(typeof amount!=="string"||!/^[-+]?\d+(?:\.\d+)?$/.test(amount)) return "Unavailable — document amount is missing or invalid";
  return `${currencyCode.trim()} ${amount}`;
}
