import { readFileSync } from "node:fs";

import { GetParametersByPathCommand, GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";

import { loadDatabaseConfig } from "@prostapaper/db/config";

import { loadEnv } from "#env";
import { RedcapClient } from "#redcap/client";

const KeyValue = z.object({ name: z.string(), value: z.string() });
const Secret = z.object({ name: z.string(), valueFrom: z.string() });
const Container = z.object({
  name: z.string(),
  environment: z.array(KeyValue).default([]),
  secrets: z.array(Secret).default([]),
});
const Plan = z.object({
  planned_values: z.object({
    root_module: z.object({
      resources: z.array(
        z.object({ type: z.string(), values: z.object({ container_definitions: z.string().optional() }) }),
      ),
    }),
  }),
});

function plannedContainer(planFile: string) {
  const plan = Plan.parse(JSON.parse(readFileSync(planFile, "utf8")));
  const definitions = plan.planned_values.root_module.resources
    .filter((resource) => resource.type === "aws_ecs_task_definition")
    .map((resource) => resource.values.container_definitions)
    .filter((value) => value !== undefined);
  const [first, ...rest] = definitions;
  if (first === undefined || rest.length > 0) {
    throw new Error(`Expected one planned task definition, found ${definitions.length}`);
  }

  const [container, ...others] = z.array(Container).parse(JSON.parse(first));
  if (container === undefined || others.length > 0) {
    throw new Error("Expected exactly one container in the task definition");
  }

  return container;
}

function parameterName(valueFrom: string): string {
  const match = /:parameter(\/.+)$/.exec(valueFrom);
  if (match?.[1] === undefined) {
    throw new Error(`Secret source is not an SSM parameter ARN: ${valueFrom}`);
  }

  return match[1];
}

function parentPath(name: string): string {
  return name.slice(0, name.lastIndexOf("/"));
}

async function listParameters(ssm: SSMClient, path: string, token?: string): Promise<string[]> {
  const page = await ssm.send(
    new GetParametersByPathCommand({ Path: path, Recursive: true, NextToken: token }),
  );
  const names = (page.Parameters ?? [])
    .map((parameter) => parameter.Name)
    .filter((name) => name !== undefined);
  if (page.NextToken === undefined) {
    return names;
  }

  return [...names, ...(await listParameters(ssm, path, page.NextToken))];
}

const [planFile] = process.argv.slice(2);
if (planFile === undefined) {
  throw new Error("Usage: check-deploy-env <terraform show -json output>");
}

const container = plannedContainer(planFile);
const wanted = new Map(container.secrets.map((secret) => [parameterName(secret.valueFrom), secret.name]));
const ssm = new SSMClient({});

const fetched = await ssm.send(new GetParametersCommand({ Names: [...wanted.keys()], WithDecryption: true }));
const missing = fetched.InvalidParameters ?? [];
if (missing.length > 0) {
  console.error(`Missing SSM parameters: ${missing.join(", ")}`);
  process.exitCode = 1;
}

const source: Record<string, string> = Object.fromEntries(
  container.environment.map((entry) => [entry.name, entry.value] as const),
);
for (const parameter of fetched.Parameters ?? []) {
  if (parameter.Name !== undefined && parameter.Value !== undefined) {
    source[wanted.get(parameter.Name) ?? parameter.Name] = parameter.Value;
  }
}

try {
  const env = loadEnv(source);
  loadDatabaseConfig(source);
  if (env.REDCAP_RELAY_URL !== undefined) {
    await new RedcapClient(env).checkProject();
    console.info("Laptop REDCap relay preflight passed: project 64, automatic numbering enabled");
  }
  console.info(`Task environment valid: ${Object.keys(source).toSorted().join(", ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

const prefixes = new Set([...wanted.keys()].map(parentPath));
const known = await Promise.all([...prefixes].map(async (prefix) => listParameters(ssm, prefix)));
const unused = known.flat().filter((name) => !wanted.has(name));
if (unused.length > 0) {
  console.warn(`SSM parameters no longer referenced by the task definition: ${unused.join(", ")}`);
}
