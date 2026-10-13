import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, logError, plaidErrorCode } from "@/lib/logging";

const FAKE_SECRET = "fakesecret0123456789abcdefabcd";
const FAKE_CLIENT_ID = "fakeclientid0123456789ab";
const FAKE_TOKEN = "access-production-11111111-2222-3333-4444-555555555555";

// Shape of the AxiosError the Plaid SDK throws on a non-2xx response.
function plaidAxiosError() {
  const config = {
    url: "https://production.plaid.com/transactions/recurring/get",
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "PLAID-CLIENT-ID": FAKE_CLIENT_ID,
      "PLAID-SECRET": FAKE_SECRET,
    },
    data: JSON.stringify({ access_token: FAKE_TOKEN }),
  };
  return Object.assign(new Error("Request failed with status code 400"), {
    name: "AxiosError",
    isAxiosError: true,
    code: "ERR_BAD_REQUEST",
    config,
    request: { _header: `PLAID-SECRET: ${FAKE_SECRET}` },
    response: {
      status: 400,
      config,
      headers: {},
      data: {
        error_type: "INVALID_INPUT",
        error_code: "INVALID_ACCESS_TOKEN",
        error_message: `provided token ${FAKE_TOKEN} is invalid`,
        request_id: "req123",
        display_message: null,
      },
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("describeError", () => {
  it("keeps Plaid's error envelope and drops request config, headers and body", () => {
    const info = describeError(plaidAxiosError());
    expect(info).toMatchObject({
      status: 400,
      plaidErrorType: "INVALID_INPUT",
      plaidErrorCode: "INVALID_ACCESS_TOKEN",
      plaidRequestId: "req123",
    });
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain(FAKE_SECRET);
    expect(serialized).not.toContain(FAKE_CLIENT_ID);
    expect(serialized).not.toContain("11111111-2222");
  });

  it("strips query params from Drizzle errors but keeps the Postgres code", () => {
    const cause = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
      severity: "ERROR",
      table_name: "transactions",
    });
    const err = Object.assign(
      new Error(
        `Failed query: update "plaid_items" set "access_token" = $1\nparams: v1:deadbeef:${FAKE_SECRET}`,
      ),
      { name: "DrizzleQueryError", cause },
    );
    const info = describeError(err);
    expect(info.pgCode).toBe("57014");
    expect(info.message).toContain("statement timeout");
    expect(JSON.stringify(info)).not.toContain(FAKE_SECRET);
  });

  it("handles non-Error values", () => {
    expect(describeError("boom").message).toBe("boom");
    expect(describeError(undefined).name).toBe("NonError");
  });
});

describe("logError", () => {
  it("never writes the Plaid secret or access token to the log", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("test.event", plaidAxiosError(), { plaidItemRowId: "item-1" });
    const written = spy.mock.calls.flat().map(String).join("\n");
    expect(written).toContain("INVALID_ACCESS_TOKEN");
    expect(written).toContain("item-1");
    expect(written).not.toContain(FAKE_SECRET);
    expect(written).not.toContain(FAKE_CLIENT_ID);
    expect(written).not.toContain("11111111-2222");
  });
});

describe("plaidErrorCode", () => {
  it("reads the Plaid error_code", () => {
    expect(plaidErrorCode(plaidAxiosError())).toBe("INVALID_ACCESS_TOKEN");
    expect(plaidErrorCode(new Error("x"))).toBeUndefined();
  });
});

describe("with a real Plaid SDK error", () => {
  it("does not leak the secret, client id or access token", async () => {
    const { createServer } = await import("node:http");
    const { Configuration, PlaidApi } = await import("plaid");
    const server = createServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error_type: "INVALID_INPUT",
          error_code: "INVALID_ACCESS_TOKEN",
          error_message: "provided access token is in an invalid format",
          request_id: "reqABC",
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const client = new PlaidApi(
      new Configuration({
        basePath: `http://127.0.0.1:${port}`,
        baseOptions: {
          headers: { "PLAID-CLIENT-ID": FAKE_CLIENT_ID, "PLAID-SECRET": FAKE_SECRET },
        },
      }),
    );
    let caught: unknown;
    try {
      await client.transactionsRecurringGet({ access_token: FAKE_TOKEN });
    } catch (err) {
      caught = err;
    } finally {
      server.close();
    }
    expect(caught).toBeDefined();
    // Sanity: the raw error really does carry the secret (this is the leak).
    expect(JSON.stringify((caught as { config: unknown }).config)).toContain(FAKE_SECRET);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("test.real-sdk", caught);
    const written = spy.mock.calls.flat().map(String).join("\n");
    expect(written).toContain("INVALID_ACCESS_TOKEN");
    expect(written).toContain("reqABC");
    expect(written).not.toContain(FAKE_SECRET);
    expect(written).not.toContain(FAKE_CLIENT_ID);
    expect(written).not.toContain("11111111-2222");
  });
});
