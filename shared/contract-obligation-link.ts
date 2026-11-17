export function parseContractObligationLink(search: string): {contractId:number;obligationId:string} | null {
  const params = new URLSearchParams(search);
  const ids = params.getAll("agreementId"), obligations = params.getAll("obligationId");
  if (ids.length!==1 || obligations.length!==1 || params.has("releaseId") || !/^[1-9]\d{0,9}$/.test(ids[0])
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(obligations[0])) return null;
  const contractId = Number(ids[0]);
  return contractId<=2147483647 ? {contractId,obligationId:obligations[0].toLowerCase()} : null;
}
