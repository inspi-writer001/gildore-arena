"use node";

import {
  AccountRole,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
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
import {
  fetchGlobalState,
  fetchFundingTokenInfo,
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
import { decodeBase64, encodeBase64 } from "../base64";

const PROGRAM_ADDRESS = address(
  "2um3F4vyQwcuhwrGdPHGMwwK5C4K5rFU84cxHPoYNMKg",
);
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
  logScope = "agent-vault:prepare-withdraw",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const prepared = await prepareWithdrawTransaction({
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

  console.log(`[${logScope}] prepared withdraw transaction`, {
    userWalletAddress,
    broadcasterWalletAddress: broadcasterSigner.address,
    agentName,
    amountUi,
    amountBaseUnits: prepared.amountBaseUnits.toString(),
    mint: prepared.mint,
  });

  return summarizePreparedTransaction(prepared, transactionBase64);
}

export async function submitServerWithdrawTransaction(
  userWalletAddress: string,
  signedTransactionBase64: string,
  logScope = "agent-vault:submit-withdraw",
) {
  return await submitServerFundAgentVaultTransaction(
    userWalletAddress,
    signedTransactionBase64,
    logScope,
  );
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
) {
  const rpc = createRpc();
  const snapshot = await fetchUserVaultSnapshot(rpc, userWalletAddress, agentName);
  return {
    decimals: snapshot.decimals,
    mint: snapshot.mint,
    vaultBalance: snapshot.userState?.amount.toString() ?? null,
    vaultAllowance: snapshot.ticker?.amountToSpend.toString() ?? null,
    isInPosition: snapshot.ticker?.isInPosition ?? null,
  };
}
