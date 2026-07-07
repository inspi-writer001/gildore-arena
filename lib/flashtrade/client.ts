type FlashTradeOpenTradeType = "LONG" | "SHORT";

export type FlashTradeOpenPositionRequest = {
  inputTokenSymbol: "USDC";
  outputTokenSymbol: string;
  inputAmountUi: string;
  leverage: number;
  tradeType: FlashTradeOpenTradeType;
  owner?: string;
  orderType?: "MARKET";
  slippagePercentage?: string;
  takeProfit?: string;
  stopLoss?: string;
};

export type FlashTradeOpenPositionResponse = {
  oldLeverage?: string | null;
  newLeverage?: string | null;
  oldEntryPrice?: string | null;
  newEntryPrice?: string | null;
  oldLiquidationPrice?: string | null;
  newLiquidationPrice?: string | null;
  entryFee?: string | null;
  entryFeeBeforeDiscount?: string | null;
  openPositionFeePercent?: string | null;
  availableLiquidity?: string | null;
  youPayUsdUi?: string | null;
  youRecieveUsdUi?: string | null;
  marginFeePercentage?: string | null;
  outputAmount?: string | null;
  outputAmountUi?: string | null;
  transactionBase64?: string | null;
  err?: string | null;
};

export type FlashTradePosition = {
  key: string;
  sideUi?: string;
  marketSymbol?: string;
  collateralSymbol?: string;
  entryPriceUi?: string;
  sizeUsdUi?: string;
  collateralUsdUi?: string;
  pnlWithFeeUsdUi?: string;
  pnlPercentageWithFee?: string;
  liquidationPriceUi?: string;
  leverageUi?: string;
};

export type FlashTradeClosePositionResponse = {
  receiveTokenSymbol?: string | null;
  receiveTokenAmountUi?: string | null;
  receiveTokenAmountUsdUi?: string | null;
  markPrice?: string | null;
  entryPrice?: string | null;
  existingLiquidationPrice?: string | null;
  newLiquidationPrice?: string | null;
  existingSize?: string | null;
  newSize?: string | null;
  existingCollateral?: string | null;
  newCollateral?: string | null;
  existingLeverage?: string | null;
  newLeverage?: string | null;
  settledPnl?: string | null;
  fees?: string | null;
  feesBeforeDiscount?: string | null;
  lockAndUnsettledFeeUsd?: string | null;
  transactionBase64?: string | null;
  err?: string | null;
};

function getFlashTradeApiUrl() {
  return (
    process.env.FLASHTRADE_API_URL?.trim() ??
    process.env.FLASH_API_URL?.trim() ??
    "https://flashapi.trade"
  );
}

async function fetchFlashTrade<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${getFlashTradeApiUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `FlashTrade request failed (${response.status} ${response.statusText}): ${text}`,
    );
  }

  return (await response.json()) as TResponse;
}

export async function buildFlashTradeOpenPosition(
  request: FlashTradeOpenPositionRequest,
) {
  return await fetchFlashTrade<FlashTradeOpenPositionResponse>(
    "/transaction-builder/open-position",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export async function buildFlashTradeClosePosition(args: {
  positionKey: string;
  inputUsdUi: string;
  withdrawTokenSymbol: "USDC";
  slippagePercentage?: string;
}) {
  return await fetchFlashTrade<FlashTradeClosePositionResponse>(
    "/transaction-builder/close-position",
    {
      method: "POST",
      body: JSON.stringify(args),
    },
  );
}

export async function listFlashTradePositions(owner: string) {
  const query = new URLSearchParams({
    includePnlInLeverageDisplay: "true",
  });
  return await fetchFlashTrade<FlashTradePosition[]>(
    `/positions/owner/${owner}?${query.toString()}`,
    { method: "GET" },
  );
}
