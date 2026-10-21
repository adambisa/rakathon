export function invocationDirectory(): string {
  // `pnpm --filter` runs scripts from the package directory; user paths are relative to where pnpm started.
  return process.env["INIT_CWD"] ?? process.cwd();
}

export function awsEnvironment(aws: { profile: string; region: string }): NodeJS.ProcessEnv {
  return { ...process.env, AWS_PROFILE: aws.profile, AWS_REGION: aws.region };
}
