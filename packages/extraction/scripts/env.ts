import { loadReaderConfig, type ReaderConfig } from "#index";

export function loadCliReaderConfig(overrides: NodeJS.ProcessEnv): ReaderConfig {
  return loadReaderConfig({ ...process.env, ...overrides });
}
