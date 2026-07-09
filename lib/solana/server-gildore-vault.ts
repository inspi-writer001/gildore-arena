"use node";

import {
  AccountRole,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  address,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructionPlan,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase58Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import { getTransferToATAInstructionPlanAsync } from "@solana-program/token";
import {
  PROGRAM_ADDRESS,
  fetchGlobalState,
  fetchFundingTokenInfo,
  fetchFundingTokenWalletBalance,
  fetchUserVaultSnapshot,
  deriveAgentAddress,
  deriveUserStateAddress,
  deriveTickerAddress,
  deriveAssociatedTokenAddress,
  prepareFundAgentVaultTransaction,
  prepareRegisterTickerTransaction,
  prepareWithdrawTransaction,
  type PreparedFundAgentVaultTransaction,
  type PreparedRegisterTickerTransaction,
  type PreparedWithdrawTransaction,
} from "./gildore-vault";
import {
  createExecutionWalletSignerFromSeed,
} from "./execution-wallet";
import { decodeBase64, encodeBase64 } from "../base64";
const TOKEN_PROGRAM_ADDRESS = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";
let broadcasterSignerPromise: Promise<
  Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>
> | null = null;
let adminSignerPromise: Promise<
  Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>
> | null = null;

function parseBroadcasterWalletBytes() {
  const rawValue = process.env.BROADCASTER_WALLET?.trim();

  if (!rawValue) {
    throw new Error("BROADCASTER_WALLET is not configured.");
  }

  if (rawValue.startsWith("[")) {
    const parsed = JSON.parse(rawValue) as number[];
    if (!Array.isArray(parsed) || parsed.some((value) => !Number.isInteger(value))) {
      throw new Error("BROADCASTER_WALLET JSON must be an array of integers.");
    }
    return Uint8Array.from(parsed);
  }

  return getBase58Encoder().encode(rawValue);
}

async function getBroadcasterSigner() {
  if (!broadcasterSignerPromise) {
    const secretBytes = parseBroadcasterWalletBytes();
    broadcasterSignerPromise =
      secretBytes.length === 64
        ? createKeyPairSignerFromBytes(secretBytes)
        : secretBytes.length === 32
          ? createKeyPairSignerFromPrivateKeyBytes(secretBytes)
          : Promise.reject(
              new Error(
                `BROADCASTER_WALLET must decode to 32 or 64 bytes, got ${secretBytes.length}.`,
              ),
            );
  }

  return await broadcasterSignerPromise;
}

function parseAdminWalletBytes() {
  const rawValue = process.env.ADMIN_WALLET?.trim();

  if (!rawValue) {
    throw new Error(
      "ADMIN_WALLET is not configured. Required for consume_ticker and close_trade operations.",
    );
  }

  if (rawValue.startsWith("[")) {
    const parsed = JSON.parse(rawValue) as number[];
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => !Number.isInteger(value))
    ) {
      throw new Error("ADMIN_WALLET JSON must be an array of integers.");
    }
    return Uint8Array.from(parsed);
  }

  return getBase58Encoder().encode(rawValue);
}

async function getAdminSigner() {
  if (!adminSignerPromise) {
    const secretBytes = parseAdminWalletBytes();
    adminSignerPromise =
      secretBytes.length === 64
        ? createKeyPairSignerFromBytes(secretBytes)
        : secretBytes.length === 32
          ? createKeyPairSignerFromPrivateKeyBytes(secretBytes)
          : Promise.reject(
              new Error(
                `ADMIN_WALLET must decode to 32 or 64 bytes, got ${secretBytes.length}.`,
              ),
            );
  }

  return await adminSignerPromise;
}

function createRpc() {
  return createSolanaRpc(
    solanaRpcUrl as Parameters<typeof createSolanaRpc>[0],
  );
}

function summarizePreparedTransaction(
  prepared:
    | PreparedFundAgentVaultTransaction
    | PreparedRegisterTickerTransaction
    | PreparedWithdrawTransaction,
  transactionBase64: string,
) {
  return {
    transactionBase64,
    amountBaseUnits: prepared.amountBaseUnits.toString(),
    mint: prepared.mint,
    decimals: prepared.decimals,
    agentAddress: prepared.agentAddress,
    userStateAddress: prepared.userStateAddress,
    tickerAddress: prepared.tickerAddress,
  };
}

function stringifyForLogs(value: unknown) {
  return JSON.stringify(
    value,
    (_key, nestedValue) =>
      typeof nestedValue === "bigint"
        ? nestedValue.toString()
        : nestedValue,
  );
}

async function simulateTransactionAndLog(args: {
  rpc: ReturnType<typeof createRpc>;
  transactionBytes: Uint8Array;
  logScope: string;
  stage: "prepare" | "submit";
  sigVerify: boolean;
  throwOnError?: boolean;
}) {
  const simulationConfig = {
    encoding: "base64" as const,
    commitment: "confirmed" as const,
    innerInstructions: true,
    sigVerify: args.sigVerify,
    ...(args.sigVerify ? {} : { replaceRecentBlockhash: true as const }),
  };
  const simulation = await (
    args.rpc as unknown as {
      simulateTransaction: (
        transaction: string,
        config: typeof simulationConfig,
      ) => {
        send: () => Promise<{
          value: {
            err: unknown;
            logs: string[] | null;
            unitsConsumed?: bigint;
          };
        }>;
      };
    }
  )
    .simulateTransaction(
      encodeBase64(args.transactionBytes),
      simulationConfig,
    )
    .send();

  console.log(`[${args.logScope}] ${args.stage} simulation result`, {
    err: simulation.value.err,
    logs: simulation.value.logs,
    unitsConsumed: simulation.value.unitsConsumed,
  });

  if (args.throwOnError !== false && simulation.value.err) {
    const logSummary = simulation.value.logs?.join(" | ") ?? "No program logs";
    throw new Error(
      `Vault ${args.stage} simulation failed: ${stringifyForLogs(
        simulation.value.err,
      )} | ${logSummary}`,
    );
  }

  return simulation.value;
}

function parseUiAmountToBaseUnits(value: string, decimals: number) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid withdraw amount");
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  if (fractionalPart.length > decimals) {
    throw new Error(`Amount supports up to ${decimals} decimal places`);
  }

  const paddedFractional = fractionalPart.padEnd(decimals, "0");
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt(paddedFractional || "0");
  const scale = BigInt(10) ** BigInt(decimals);
  return whole * scale + fraction;
}

function formatUiAmountFromBaseUnits(value: bigint, decimals: number) {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fractionText.length > 0
    ? `${whole.toString()}.${fractionText}`
    : whole.toString();
}

type WithdrawPlanningContext = {
  mint: Address;
  decimals: number;
  vaultBalance: bigint;
  executionWalletBalance: bigint;
  totalWithdrawableBalance: bigint;
};

type WithdrawPlan = WithdrawPlanningContext & {
  requestedAmountBaseUnits: bigint;
  vaultWithdrawAmountBaseUnits: bigint;
  executionWalletWithdrawAmountBaseUnits: bigint;
};

async function getExecutionWalletFundingBalanceData(
  executionWalletAddressInput: string,
) {
  const rpc = createRpc();
  const executionWalletAddress = address(executionWalletAddressInput);
  const fundingToken = await fetchFundingTokenInfo(rpc);
  const ataAddress = await deriveAssociatedTokenAddress(
    executionWalletAddress,
    fundingToken.mint,
  );
  const tokenAccount = await fetchEncodedAccount(rpc, ataAddress);

  if (!tokenAccount.exists) {
    return {
      executionWalletAddress,
      ataAddress,
      mint: fundingToken.mint,
      decimals: fundingToken.decimals,
      balance: BigInt(0),
    };
  }

  return {
    executionWalletAddress,
    ataAddress,
    mint: fundingToken.mint,
    decimals: fundingToken.decimals,
    balance: readU64FromTokenAccount(tokenAccount.data),
  };
}

function readU64FromTokenAccount(data: Uint8Array) {
  if (data.length < 72) {
    throw new Error(
      `Configured token account amount layout is invalid (expected at least 72 bytes, got ${data.length}).`,
    );
  }

  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(64, true);
}

async function getWithdrawPlanningContext(args: {
  userWalletAddress: string;
  agentName: string;
  executionWalletAddress?: string;
}) {
  const rpc = createRpc();
  const snapshot = await fetchUserVaultSnapshot(
    rpc,
    args.userWalletAddress,
    args.agentName,
  );
  const executionWalletBalance = args.executionWalletAddress
    ? (await getExecutionWalletFundingBalanceData(args.executionWalletAddress)).balance
    : BigInt(0);

  return {
    mint: snapshot.mint,
    decimals: snapshot.decimals,
    vaultBalance: snapshot.vaultBalance,
    executionWalletBalance,
    totalWithdrawableBalance: snapshot.vaultBalance + executionWalletBalance,
  } satisfies WithdrawPlanningContext;
}

async function buildWithdrawPlan(args: {
  userWalletAddress: string;
  agentName: string;
  amountUi: string;
  executionWalletAddress?: string;
}) {
  const context = await getWithdrawPlanningContext(args);
  const requestedAmountBaseUnits = parseUiAmountToBaseUnits(
    args.amountUi,
    context.decimals,
  );

  if (requestedAmountBaseUnits <= BigInt(0)) {
    throw new Error("Enter a withdrawal amount greater than zero.");
  }

  if (context.totalWithdrawableBalance < requestedAmountBaseUnits) {
    throw new Error(
      `Insufficient withdrawable balance. Available: ${context.totalWithdrawableBalance.toString()} base units, requested: ${requestedAmountBaseUnits.toString()}.`,
    );
  }

  const vaultWithdrawAmountBaseUnits =
    context.vaultBalance >= requestedAmountBaseUnits
      ? requestedAmountBaseUnits
      : context.vaultBalance;
  const executionWalletWithdrawAmountBaseUnits =
    requestedAmountBaseUnits - vaultWithdrawAmountBaseUnits;

  return {
    ...context,
    requestedAmountBaseUnits,
    vaultWithdrawAmountBaseUnits,
    executionWalletWithdrawAmountBaseUnits,
  } satisfies WithdrawPlan;
}

export async function prepareServerFundAgentVaultTransaction(
  userWalletAddress: string,
  agentName: string,
  amountUi: string,
  logScope = "agent-vault:prepare",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const prepared = await prepareFundAgentVaultTransaction({
    rpc,
    userAddressInput: userWalletAddress,
    payerAddressInput: broadcasterSigner.address,
    agentName,
    amountUi,
  });
  const partiallySignedTransaction =
    await partiallySignTransactionMessageWithSigners(
      setTransactionMessageFeePayerSigner(
        broadcasterSigner,
        prepared.transactionMessage as unknown as Parameters<
          typeof setTransactionMessageFeePayerSigner
        >[1],
      ),
    );
  const transactionBytes = Uint8Array.from(
    getTransactionEncoder().encode(partiallySignedTransaction),
  );
  await simulateTransactionAndLog({
    rpc,
    transactionBytes,
    logScope,
    stage: "prepare",
    sigVerify: false,
  });
  const transactionBase64 = encodeBase64(transactionBytes);

  console.log(`[${logScope}] prepared fund-agent-vault transaction`, {
    userWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    agentName,
    amountUi,
    amountBaseUnits: prepared.amountBaseUnits.toString(),
    mint: prepared.mint,
    agentAddress: prepared.agentAddress,
    userStateAddress: prepared.userStateAddress,
    tickerAddress: prepared.tickerAddress,
  });

  return summarizePreparedTransaction(prepared, transactionBase64);
}

export async function prepareServerRegisterTickerTransaction(
  userWalletAddress: string,
  agentName: string,
  amountUi: string,
  logScope = "agent-vault:prepare-register-ticker",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const prepared = await prepareRegisterTickerTransaction({
    rpc,
    userAddressInput: userWalletAddress,
    payerAddressInput: broadcasterSigner.address,
    agentName,
    amountUi,
  });
  const partiallySignedTransaction =
    await partiallySignTransactionMessageWithSigners(
      setTransactionMessageFeePayerSigner(
        broadcasterSigner,
        prepared.transactionMessage as unknown as Parameters<
          typeof setTransactionMessageFeePayerSigner
        >[1],
      ),
    );
  const transactionBytes = Uint8Array.from(
    getTransactionEncoder().encode(partiallySignedTransaction),
  );
  const transactionBase64 = encodeBase64(transactionBytes);

  console.log(`[${logScope}] prepared register-ticker transaction`, {
    userWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    agentName,
    amountUi,
    amountBaseUnits: prepared.amountBaseUnits.toString(),
    mint: prepared.mint,
    agentAddress: prepared.agentAddress,
    userStateAddress: prepared.userStateAddress,
    tickerAddress: prepared.tickerAddress,
  });

  return summarizePreparedTransaction(prepared, transactionBase64);
}

export async function submitServerFundAgentVaultTransaction(
  userWalletAddress: string,
  signedTransactionBase64: string,
  logScope = "agent-vault:submit",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const userAddress = address(userWalletAddress);
  const transactionBytes = decodeBase64(signedTransactionBase64);
  const signedTransaction = getTransactionDecoder().decode(transactionBytes);
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    signedTransaction.messageBytes,
  );

  if (compiledMessage.staticAccounts[0] !== broadcasterSigner.address) {
    throw new Error("Signed transaction fee payer does not match broadcaster wallet.");
  }
  if (!compiledMessage.staticAccounts.includes(userAddress)) {
    throw new Error("Signed transaction does not include the expected user wallet.");
  }

  const broadcasterSignature = signedTransaction.signatures[broadcasterSigner.address];
  const userSignature = signedTransaction.signatures[userAddress];

  if (!broadcasterSignature || broadcasterSignature.length === 0) {
    throw new Error("Signed transaction is missing the broadcaster signature.");
  }
  if (!userSignature || userSignature.length === 0) {
    throw new Error("Signed transaction is missing the user signature.");
  }

  assertIsFullySignedTransaction(signedTransaction);
  assertIsTransactionWithinSizeLimit(signedTransaction);

  const sendTransactionWithoutConfirming =
    sendTransactionWithoutConfirmingFactory({
      rpc: rpc as Parameters<
        typeof sendTransactionWithoutConfirmingFactory
      >[0]["rpc"],
    });
  await sendTransactionWithoutConfirming(signedTransaction, {
    commitment: "confirmed",
  });

  const signature = getSignatureFromTransaction(signedTransaction);

  console.log(`[${logScope}] broadcasted fund-agent-vault transaction`, {
    userWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    signature,
  });

  return {
    signature,
  };
}

export async function submitServerRegisterTickerTransaction(
  userWalletAddress: string,
  signedTransactionBase64: string,
  logScope = "agent-vault:submit-register-ticker",
) {
  return await submitServerFundAgentVaultTransaction(
    userWalletAddress,
    signedTransactionBase64,
    logScope,
  );
}

// ── Withdraw (user_withdrawal, discriminator = 6) ─────────────────────────────

export async function prepareServerWithdrawTransaction(
  userWalletAddress: string,
  agentName: string,
  amountUi: string,
  executionWalletAddress?: string,
  logScope = "agent-vault:prepare-withdraw",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const plan = await buildWithdrawPlan({
    userWalletAddress,
    agentName,
    amountUi,
    executionWalletAddress,
  });

  let prepared: PreparedWithdrawTransaction | null = null;
  let transactionBase64: string | null = null;
  if (plan.vaultWithdrawAmountBaseUnits > BigInt(0)) {
    prepared = await prepareWithdrawTransaction({
      rpc,
      userAddressInput: userWalletAddress,
      payerAddressInput: broadcasterSigner.address,
      agentName,
      amountUi: formatUiAmountFromBaseUnits(
        plan.vaultWithdrawAmountBaseUnits,
        plan.decimals,
      ),
    });
    const partiallySignedTransaction =
      await partiallySignTransactionMessageWithSigners(
        setTransactionMessageFeePayerSigner(
          broadcasterSigner,
          prepared.transactionMessage as unknown as Parameters<
            typeof setTransactionMessageFeePayerSigner
          >[1],
        ),
      );
    const transactionBytes = Uint8Array.from(
      getTransactionEncoder().encode(partiallySignedTransaction),
    );
    await simulateTransactionAndLog({
      rpc,
      transactionBytes,
      logScope,
      stage: "prepare",
      sigVerify: false,
    });
    transactionBase64 = encodeBase64(transactionBytes);
  }

  console.log(`[${logScope}] prepared withdraw transaction`, {
    userWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    agentName,
    amountUi,
    requestedAmountBaseUnits: plan.requestedAmountBaseUnits.toString(),
    vaultWithdrawAmountBaseUnits: plan.vaultWithdrawAmountBaseUnits.toString(),
    executionWalletWithdrawAmountBaseUnits:
      plan.executionWalletWithdrawAmountBaseUnits.toString(),
    mint: plan.mint,
  });

  return {
    transactionBase64,
    amountBaseUnits: plan.requestedAmountBaseUnits.toString(),
    mint: plan.mint,
    decimals: plan.decimals,
    requiresUserSignature: plan.vaultWithdrawAmountBaseUnits > BigInt(0),
    vaultWithdrawAmountBaseUnits:
      plan.vaultWithdrawAmountBaseUnits.toString(),
    executionWalletWithdrawAmountBaseUnits:
      plan.executionWalletWithdrawAmountBaseUnits.toString(),
    totalWithdrawableBalanceBaseUnits:
      plan.totalWithdrawableBalance.toString(),
    agentAddress: prepared?.agentAddress ?? null,
    userStateAddress: prepared?.userStateAddress ?? null,
    tickerAddress: prepared?.tickerAddress ?? null,
  };
}

async function sweepExecutionWalletFundingToUser(args: {
  executionWalletSigner: Awaited<ReturnType<typeof createExecutionWalletSignerFromSeed>>;
  userWalletAddress: string;
  amountBaseUnits: bigint;
  mint: Address;
  decimals: number;
  logScope?: string;
}) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const latestBlockhash = await rpc.getLatestBlockhash().send();
  const instructionPlan = await getTransferToATAInstructionPlanAsync({
    payer: broadcasterSigner,
    mint: args.mint,
    authority: args.executionWalletSigner,
    recipient: address(args.userWalletAddress),
    amount: args.amountBaseUnits,
    decimals: args.decimals,
  });
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (transaction) =>
      setTransactionMessageFeePayerSigner(
        broadcasterSigner,
        transaction as Parameters<typeof setTransactionMessageFeePayerSigner>[1],
      ),
    (transaction) =>
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash.value,
        transaction,
      ),
    (transaction) =>
      appendTransactionMessageInstructionPlan(instructionPlan, transaction),
  );

  const partiallySignedTransaction =
    await partiallySignTransactionMessageWithSigners(message);
  const [executionWalletSignatureDictionary] =
    await args.executionWalletSigner.signTransactions([
      partiallySignedTransaction,
    ]);
  const signedTransaction = {
    ...partiallySignedTransaction,
    signatures: {
      ...partiallySignedTransaction.signatures,
      ...executionWalletSignatureDictionary,
    },
  } as unknown as typeof partiallySignedTransaction;
  assertIsFullySignedTransaction(signedTransaction);
  assertIsTransactionWithinSizeLimit(signedTransaction);
  const sendTransactionWithoutConfirming =
    sendTransactionWithoutConfirmingFactory({
      rpc: rpc as Parameters<
        typeof sendTransactionWithoutConfirmingFactory
      >[0]["rpc"],
    });
  await sendTransactionWithoutConfirming(signedTransaction, {
    commitment: "confirmed",
  });
  const signature = getSignatureFromTransaction(signedTransaction);

  console.log(`[${args.logScope ?? "execution-wallet:sweep-withdraw"}] swept`, {
    executionWalletAddress: args.executionWalletSigner.address,
    userWalletAddress: args.userWalletAddress,
    amountBaseUnits: args.amountBaseUnits.toString(),
    signature,
  });

  return { signature };
}

export async function submitServerWithdrawTransaction(args: {
  userWalletAddress: string;
  agentName: string;
  amountUi: string;
  signedTransactionBase64?: string;
  executionWalletAddress?: string;
  executionWalletSigner?: Awaited<ReturnType<typeof createExecutionWalletSignerFromSeed>>;
  logScope?: string;
}) {
  const plan = await buildWithdrawPlan({
    userWalletAddress: args.userWalletAddress,
    agentName: args.agentName,
    amountUi: args.amountUi,
    executionWalletAddress: args.executionWalletAddress,
  });

  let vaultSignature: string | null = null;
  if (plan.vaultWithdrawAmountBaseUnits > BigInt(0)) {
    if (!args.signedTransactionBase64) {
      throw new Error("Signed vault withdrawal transaction is required.");
    }
    const result = await submitServerFundAgentVaultTransaction(
      args.userWalletAddress,
      args.signedTransactionBase64,
      args.logScope ?? "agent-vault:submit-withdraw",
    );
    vaultSignature = result.signature;
  }

  let executionWalletSweepSignature: string | null = null;
  if (plan.executionWalletWithdrawAmountBaseUnits > BigInt(0)) {
    if (!args.executionWalletSigner) {
      throw new Error(
        "Execution wallet signer is required to sweep recoverable funds.",
      );
    }
    const sweep = await sweepExecutionWalletFundingToUser({
      executionWalletSigner: args.executionWalletSigner,
      userWalletAddress: args.userWalletAddress,
      amountBaseUnits: plan.executionWalletWithdrawAmountBaseUnits,
      mint: plan.mint,
      decimals: plan.decimals,
      logScope: args.logScope,
    });
    executionWalletSweepSignature = sweep.signature;
  }

  return {
    signature: vaultSignature ?? executionWalletSweepSignature,
    vaultSignature,
    executionWalletSweepSignature,
    vaultWithdrawnBaseUnits: plan.vaultWithdrawAmountBaseUnits.toString(),
    executionWalletWithdrawnBaseUnits:
      plan.executionWalletWithdrawAmountBaseUnits.toString(),
  };
}

// ── Consume ticker (consume_ticker, discriminator = 5) ────────────────────────
// Fully server-signed: broadcaster (fee payer) + admin both sign on the server.
// Called by the cron/agent system when entering a trade, not by the user.

export async function executeServerConsumeTicker(
  userWalletAddress: string,
  agentName: string,
  destinationTokenAccount: string,
  logScope = "agent-vault:consume-ticker",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const adminSigner = await getAdminSigner();

  const userAddress = address(userWalletAddress);
  const destAddress = address(destinationTokenAccount);

  const { address: globalStateAddress } = await fetchGlobalState(rpc);
  const fundingToken = await fetchFundingTokenInfo(rpc);
  const { agentAddress, agentId } = await deriveAgentAddress(agentName);
  const userStateAddress = await deriveUserStateAddress(
    userAddress,
    fundingToken.mint,
    agentAddress,
  );
  const userStateVaultAddress = await deriveAssociatedTokenAddress(
    userStateAddress,
    fundingToken.mint,
  );
  const tickerAddress = await deriveTickerAddress(agentId, userAddress);

  const latestBlockhash = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayer(broadcasterSigner.address, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, m),
    (m) =>
      appendTransactionMessageInstruction(
        {
          programAddress: PROGRAM_ADDRESS,
          accounts: [
            {
              address: broadcasterSigner.address,
              role: AccountRole.WRITABLE_SIGNER,
            },
            {
              address: adminSigner.address,
              role: AccountRole.WRITABLE_SIGNER,
            },
            { address: userAddress, role: AccountRole.READONLY },
            { address: agentAddress, role: AccountRole.WRITABLE },
            { address: globalStateAddress, role: AccountRole.WRITABLE },
            { address: userStateAddress, role: AccountRole.WRITABLE },
            { address: userStateVaultAddress, role: AccountRole.WRITABLE },
            { address: destAddress, role: AccountRole.WRITABLE },
            { address: tickerAddress, role: AccountRole.WRITABLE },
            { address: fundingToken.mint, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
          ],
          data: Uint8Array.from([5]),
        },
        m,
      ),
  );

  // Sign with broadcaster as fee payer
  const partialTx = await partiallySignTransactionMessageWithSigners(
    setTransactionMessageFeePayerSigner(
      broadcasterSigner,
      message as unknown as Parameters<
        typeof setTransactionMessageFeePayerSigner
      >[1],
    ),
  );

  // signTransactions returns only the new SignatureDictionary; merge manually
  const [adminSigDict] = await adminSigner.signTransactions([partialTx]);
  const fullySignedTx = {
    ...partialTx,
    signatures: { ...partialTx.signatures, ...adminSigDict },
  } as unknown as typeof partialTx;

  assertIsFullySignedTransaction(fullySignedTx);
  assertIsTransactionWithinSizeLimit(fullySignedTx);

  const transactionBytes = Uint8Array.from(
    getTransactionEncoder().encode(fullySignedTx),
  );
  await simulateTransactionAndLog({
    rpc,
    transactionBytes,
    logScope,
    stage: "submit",
    sigVerify: true,
    throwOnError: true,
  });

  const sendTx = sendTransactionWithoutConfirmingFactory({
    rpc: rpc as Parameters<typeof sendTransactionWithoutConfirmingFactory>[0]["rpc"],
  });
  await sendTx(fullySignedTx, { commitment: "confirmed" });

  const signature = getSignatureFromTransaction(fullySignedTx);

  console.log(`[${logScope}] consumed ticker`, {
    userWalletAddress,
    agentName,
    destinationTokenAccount,
    signature,
  });

  return { signature };
}

// ── Close trade (update_ticker_close_trade, discriminator = 7) ────────────────
// Broadcaster-only: no user or admin involvement.

export async function executeServerUpdateTickerCloseTrade(
  userWalletAddress: string,
  agentName: string,
  logScope = "agent-vault:close-trade",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();

  const userAddress = address(userWalletAddress);
  const { agentAddress, agentId } = await deriveAgentAddress(agentName);
  const tickerAddress = await deriveTickerAddress(agentId, userAddress);

  const latestBlockhash = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayer(broadcasterSigner.address, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, m),
    (m) =>
      appendTransactionMessageInstruction(
        {
          programAddress: PROGRAM_ADDRESS,
          accounts: [
            {
              address: broadcasterSigner.address,
              role: AccountRole.WRITABLE_SIGNER,
            },
            { address: userAddress, role: AccountRole.READONLY },
            { address: agentAddress, role: AccountRole.WRITABLE },
            { address: tickerAddress, role: AccountRole.WRITABLE },
          ],
          data: Uint8Array.from([7]),
        },
        m,
      ),
  );

  const signedTx = await partiallySignTransactionMessageWithSigners(
    setTransactionMessageFeePayerSigner(
      broadcasterSigner,
      message as unknown as Parameters<
        typeof setTransactionMessageFeePayerSigner
      >[1],
    ),
  );

  assertIsFullySignedTransaction(signedTx);
  assertIsTransactionWithinSizeLimit(signedTx);

  const sendTx = sendTransactionWithoutConfirmingFactory({
    rpc: rpc as Parameters<typeof sendTransactionWithoutConfirmingFactory>[0]["rpc"],
  });
  await sendTx(signedTx, { commitment: "confirmed" });

  const signature = getSignatureFromTransaction(signedTx);

  console.log(`[${logScope}] closed trade / cleared is_in_position`, {
    userWalletAddress,
    agentName,
    signature,
  });

  return { signature };
}

export async function getVaultSnapshotData(
  userWalletAddress: string,
  agentName: string,
  executionWalletAddress?: string,
) {
  const rpc = createRpc();
  const [snapshot, planning] = await Promise.all([
    fetchUserVaultSnapshot(rpc, userWalletAddress, agentName),
    getWithdrawPlanningContext({
      userWalletAddress,
      agentName,
      executionWalletAddress,
    }),
  ]);
  return {
    decimals: planning.decimals,
    mint: planning.mint,
    vaultBalance: planning.vaultBalance.toString(),
    executionWalletBalance: planning.executionWalletBalance.toString(),
    totalWithdrawableBalance: planning.totalWithdrawableBalance.toString(),
    vaultAllowance: snapshot.ticker?.amountToSpend.toString() ?? null,
    isInPosition: snapshot.ticker?.isInPosition ?? null,
  };
}

export async function getFundingTokenBalanceData(userWalletAddress: string) {
  const rpc = createRpc();
  const balance = await fetchFundingTokenWalletBalance(rpc, userWalletAddress);

  return {
    mint: balance.mint,
    decimals: balance.decimals,
    ataAddress: balance.ataAddress,
    hasTokenAccount: balance.hasTokenAccount,
    balanceBaseUnits: balance.balance.toString(),
  };
}
