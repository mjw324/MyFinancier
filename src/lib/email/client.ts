import { SESClient } from "@aws-sdk/client-ses";

function getConfig() {
  const region = process.env.AWS_SES_REGION;
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY;

  if (!region) throw new Error("AWS_SES_REGION is not set");
  if (!accessKeyId) throw new Error("AWS_SES_ACCESS_KEY_ID is not set");
  if (!secretAccessKey) throw new Error("AWS_SES_SECRET_ACCESS_KEY is not set");

  return { region, credentials: { accessKeyId, secretAccessKey } };
}

let cachedClient: SESClient | undefined;

function getClient(): SESClient {
  if (!cachedClient) cachedClient = new SESClient(getConfig());
  return cachedClient;
}

export const sesClient = new Proxy({} as SESClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
