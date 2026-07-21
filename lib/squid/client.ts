type SquidTransactionRequest =
  | {
      type?: "ON_CHAIN_EXECUTION";
      target: `0x${string}`;
      data: `0x${string}`;
      value?: string;
      gasLimit?: string;
    }
  | {
      type: "CHAINFLIP_DEPOSIT_ADDRESS";
      [key: string]: unknown;
    };

type SquidRoute = {
  quoteId?: string;
  estimate?: {
    toAmount?: string;
  };
  transactionRequest?: SquidTransactionRequest;
};

type SquidRouteResponse = {
  route: SquidRoute;
  requestId: string | null;
};

type SquidStatusResponse = {
  squidTransactionStatus: string;
  [key: string]: unknown;
};

type SquidDepositAddressResponse = {
  depositAddress: string;
  amount: string;
  chainflipStatusTrackingId: string;
};

function getSquidApiBaseUrl() {
  return (
    process.env.SQUID_API_BASE_URL?.trim() ??
    process.env.SQUID_BASE_URL?.trim() ??
    "https://v2.api.squidrouter.com"
  );
}

function getSquidIntegratorId() {
  const integratorId =
    process.env.SQUID_INTEGRATOR_ID?.trim() ??
    process.env.INTEGRATOR_ID?.trim();

  if (!integratorId) {
    throw new Error("SQUID_INTEGRATOR_ID is not configured.");
  }

  return integratorId;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Squid request failed (${response.status}): ${bodyText || response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

export async function getSquidRoute(params: Record<string, unknown>) {
  const response = await fetch(`${getSquidApiBaseUrl()}/v2/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-integrator-id": getSquidIntegratorId(),
    },
    body: JSON.stringify(params),
  });
  const payload = await parseJsonResponse<{ route: SquidRoute }>(response);

  return {
    route: payload.route,
    requestId: response.headers.get("x-request-id"),
  } satisfies SquidRouteResponse;
}

export async function getSquidDepositAddress(
  transactionRequest: Record<string, unknown>,
) {
  const response = await fetch(`${getSquidApiBaseUrl()}/v2/deposit-address`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-integrator-id": getSquidIntegratorId(),
    },
    body: JSON.stringify(transactionRequest),
  });

  return await parseJsonResponse<SquidDepositAddressResponse>(response);
}

export async function getSquidStatus(params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  const response = await fetch(
    `${getSquidApiBaseUrl()}/v2/status?${searchParams.toString()}`,
    {
      headers: {
        "x-integrator-id": getSquidIntegratorId(),
      },
    },
  );

  return await parseJsonResponse<SquidStatusResponse>(response);
}

export async function pollSquidStatus(args: {
  params: Record<string, string>;
  maxAttempts?: number;
  intervalMs?: number;
}) {
  const maxAttempts = args.maxAttempts ?? 60;
  const intervalMs = args.intervalMs ?? 5_000;
  const completedStatuses = new Set([
    "success",
    "partial_success",
    "needs_gas",
    "not_found",
  ]);

  let latestStatus: SquidStatusResponse | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latestStatus = await getSquidStatus(args.params);
    if (completedStatuses.has(latestStatus.squidTransactionStatus)) {
      return latestStatus;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Squid status did not reach a terminal state after ${maxAttempts} attempts. Last status: ${latestStatus?.squidTransactionStatus ?? "unknown"}.`,
  );
}

export type {
  SquidDepositAddressResponse,
  SquidRoute,
  SquidStatusResponse,
  SquidTransactionRequest,
};
