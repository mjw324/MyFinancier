import { NextResponse } from "next/server";
import postgres from "postgres";

export async function POST(request: Request) {
  const isProd = process.env.NODE_ENV === "production";
  const headerKey = request.headers.get("x-migrate-key");
  const expected = process.env.BETTER_AUTH_SECRET;
  if (isProd && headerKey !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  try {
    await sql`ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text`;
    results.addColumn = "ok";

    const providerRows = await sql`SELECT DISTINCT "providerId" FROM "account"`;
    results.providerIds = providerRows;

    const updateRes = await sql`UPDATE "account" SET "issuer" = 'local:credential' WHERE "providerId" = 'credential' AND "issuer" IS NULL`;
    results.backfillCredential = updateRes;

    const remainingNulls = await sql`SELECT "id", "providerId" FROM "account" WHERE "issuer" IS NULL`;
    results.remainingNullsBefore = remainingNulls;

    if (Array.isArray(remainingNulls) && (remainingNulls as unknown[]).length > 0) {
      const rows = remainingNulls as Array<{ id: string; providerId: string }>;
      for (const row of rows) {
        const issuer =
          row.providerId === "siwe"
            ? "local:siwe"
            : row.providerId === "google"
              ? "https://accounts.google.com"
              : `local:oauth:${encodeURIComponent(row.providerId)}`;
        await sql`UPDATE "account" SET "issuer" = ${issuer} WHERE "id" = ${row.id}`;
      }
      results.backfillRemaining = `updated ${rows.length} rows`;
    }

    const collisions = await sql`
      SELECT "issuer", "accountId", COUNT(*)::int AS "accountCount",
             COUNT(DISTINCT "userId")::int AS "userCount"
      FROM "account"
      GROUP BY "issuer", "accountId"
      HAVING COUNT(*) > 1
    `;
    results.collisions = collisions;
    if (Array.isArray(collisions) && (collisions as unknown[]).length > 0) {
      return NextResponse.json(
        {
          error: "Collisions found — resolve before adding unique index",
          results,
        },
        { status: 409 }
      );
    }

    const nullCountRes = await sql`SELECT COUNT(*)::int AS c FROM "account" WHERE "issuer" IS NULL`;
    const nullCount = (nullCountRes as unknown as Array<{ c: number }>)[0]?.c ?? 0;
    results.nullCount = nullCount;
    if (nullCount > 0) {
      return NextResponse.json(
        { error: "NULL issuer rows remain", results },
        { status: 400 }
      );
    }

    try {
      await sql`ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL`;
      results.setNotNull = "ok";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already") || msg.includes("is already")) {
        results.setNotNull = "already not null";
      } else {
        throw e;
      }
    }

    try {
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_uidx" ON "account" ("issuer", "accountId")`;
      results.createIndex = "ok";
    } catch (e) {
      results.createIndexError = e instanceof Error ? e.message : String(e);
      throw e;
    }

    const cols = await sql`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'account'
      ORDER BY ordinal_position
    `;
    results.columns = cols;
    await sql.end();

    return NextResponse.json({ success: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    try {
      await sql.end();
    } catch {}
    return NextResponse.json(
      { success: false, error: message, stack, results },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
