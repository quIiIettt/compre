import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "codec-log.csv");

const ensureHeader = async (header: string) => {
  try {
    await fs.access(LOG_PATH);
  } catch {
    await fs.writeFile(LOG_PATH, `${header}\n`, "utf8");
  }
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { row, header } = body as { row?: string; header?: string };
    if (!row || !header) {
      return NextResponse.json({ error: "Missing row or header" }, { status: 400 });
    }

    await ensureHeader(header);
    await fs.appendFile(LOG_PATH, `${row}\n`, "utf8");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("CSV log append failed", err);
    return NextResponse.json({ error: "Failed to append log" }, { status: 500 });
  }
}
