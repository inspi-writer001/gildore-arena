import { NextRequest, NextResponse } from "next/server";

const PYTH_HISTORY_BASE_URL = "https://pyth.dourolabs.app/v1";

const allowedSymbols = new Set(["XAU/USD", "XAG/USD", "EUR/USD"]);
const allowedResolutions = new Set(["15", "60", "240"]);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "";
  const resolution = searchParams.get("resolution") ?? "15";
  const from = Number(searchParams.get("from"));
  const to = Number(searchParams.get("to"));

  if (!allowedSymbols.has(symbol)) {
    return NextResponse.json(
      { error: `Unsupported symbol: ${symbol}` },
      { status: 400 },
    );
  }

  if (!allowedResolutions.has(resolution)) {
    return NextResponse.json(
      { error: `Unsupported resolution: ${resolution}` },
      { status: 400 },
    );
  }

  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return NextResponse.json(
      { error: "Invalid from/to range." },
      { status: 400 },
    );
  }

  const endpoint = new URL(`${PYTH_HISTORY_BASE_URL}/real_time/history`);
  endpoint.searchParams.set("symbol", symbol);
  endpoint.searchParams.set("resolution", resolution);
  endpoint.searchParams.set("from", String(Math.floor(from)));
  endpoint.searchParams.set("to", String(Math.floor(to)));

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Pyth request failed with status ${response.status}.` },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as {
      s?: string;
      t?: number[];
      o?: number[];
      h?: number[];
      l?: number[];
      c?: number[];
      errmsg?: string;
    };

    if (payload.s !== "ok" || !payload.t || !payload.o || !payload.h || !payload.l || !payload.c) {
      return NextResponse.json(
        { error: payload.errmsg ?? "Pyth returned an invalid history payload." },
        { status: 502 },
      );
    }

    const candles = payload.t.map((time, index) => ({
      time,
      open: payload.o?.[index],
      high: payload.h?.[index],
      low: payload.l?.[index],
      close: payload.c?.[index],
    }));

    return NextResponse.json({ candles });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch Pyth history.",
      },
      { status: 502 },
    );
  }
}
