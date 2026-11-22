type StartupReadiness={dbReady:boolean;schemaReady:boolean;sessionStoreReady:boolean;websocketReady:boolean};

/** Public liveness guidance only. Exceptions and startup events belong in authorized Diagnostics. */
export function publicStartupStatus(failedAt:string|null,ready:StartupReadiness,requestId:string|null){
  return {
    ok:failedAt===null,
    startupFailure:failedAt?{at:failedAt,message:"The app could not finish starting. Ask an administrator to review Diagnostics, then retry."}:null,
    readiness:{dbReady:ready.dbReady,schemaReady:ready.schemaReady,
      sessionStoreReady:ready.sessionStoreReady,websocketReady:ready.websocketReady},
    requestId,
  };
}
