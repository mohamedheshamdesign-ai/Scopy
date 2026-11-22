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

export function loadConfig(
  homeOverride?: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ScopyConfig {
  const configuredHome = homeOverride ?? environment.SCOPY_HOME ?? process.cwd();
  if (configuredHome.includes(String.fromCharCode(0))) {
    throw new Error("SCOPY_HOME contains an invalid null character.");
  }
  const homeDir = resolve(configuredHome);
  const dataDir = join(homeDir, "data");
  const configuredWorkspace = environment.SCOPY_WORKSPACE_DIR?.trim();
  if (configuredWorkspace?.includes(String.fromCharCode(0))) {
    throw new Error("SCOPY_WORKSPACE_DIR contains an invalid null character.");
  }
  const workspaceDir = configuredWorkspace ? resolve(homeDir, configuredWorkspace) : join(homeDir, "workspace");

  return Object.freeze({
    homeDir,
    dataDir,
    databasePath: join(dataDir, "scopy.sqlite"),
    workspaceDir,
    backupsDir: join(homeDir, "backups"),
    logsDir: join(homeDir, "logs"),
    tempDir: join(homeDir, "temp"),
  });
}
