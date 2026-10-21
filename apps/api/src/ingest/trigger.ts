import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

export class CaseIngestTrigger {
  constructor(
    region: string,
    private readonly functionName: string,
    private readonly client = new LambdaClient({ region, requestHandler: { requestTimeout: 15_000 } }),
  ) {}

  async caseSubmitted(caseId: string): Promise<void> {
    await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ caseId })),
      }),
    );
  }
}
