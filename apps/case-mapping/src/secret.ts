import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

let cached: string | undefined;

async function fetchParameter(name: string): Promise<string> {
  const ssm = new SSMClient({});
  try {
    const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    const value = result.Parameter?.Value;
    if (value === undefined || value === "") {
      throw new Error(`Parameter ${name} is empty`);
    }

    return value;
  } finally {
    ssm.destroy();
  }
}

/** Read once per container so the key never enters the function configuration or Terraform state. */
export async function readSecret(name: string): Promise<string> {
  cached ??= await fetchParameter(name);

  return cached;
}
