import { join, resolve } from "node:path";

export interface ScopyConfig {
  readonly homeDir: string;
  readonly dataDir: string;
  readonly databasePath: string;
}

export function loadConfig(homeOverride?: string): ScopyConfig {
  const homeDir = resolve(homeOverride ?? process.env.SCOPY_HOME ?? process.cwd());
  const dataDir = join(homeDir, "data");

  return Object.freeze({
    homeDir,
    dataDir,
    databasePath: join(dataDir, "scopy.sqlite"),
  });
}
