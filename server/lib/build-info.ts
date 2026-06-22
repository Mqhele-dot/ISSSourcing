import { appEnv } from "../config/env";

export function getBuildInfo() {
  return {
    version: appEnv.build.version,
    commitSha: appEnv.build.commitSha ?? null,
    buildId: appEnv.build.buildId ?? null,
    builtAt: appEnv.build.builtAt ?? null,
    runtimeProfile: appEnv.runtimeProfile,
    deploymentMode: appEnv.deploymentMode,
  };
}
