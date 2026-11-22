import { join, resolve } from "node:path";

export interface ScopyConfig {
  readonly homeDir: string;
  readonly dataDir: string;
  readonly databasePath: string;
  readonly workspaceDir: string;
  readonly backupsDir: string;
  readonly logsDir: string;
  readonly tempDir: string;
}

export function loadConfig(homeOverride?: string): ScopyConfig {
  const configuredHome = homeOverride ?? process.env.SCOPY_HOME ?? process.cwd();
  if (configuredHome.includes(String.fromCharCode(0))) {
    throw new Error("SCOPY_HOME contains an invalid null character.");
  }
  const homeDir = resolve(configuredHome);
  const dataDir = join(homeDir, "data");

  return Object.freeze({
    homeDir,
    dataDir,
    databasePath: join(dataDir, "scopy.sqlite"),
    workspaceDir: join(homeDir, "workspace"),
    backupsDir: join(homeDir, "backups"),
    logsDir: join(homeDir, "logs"),
    tempDir: join(homeDir, "temp"),
  });
}
