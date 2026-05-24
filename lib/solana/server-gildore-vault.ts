"use node";

import {
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  address,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  getBase58Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransactionMessageWithSigners,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
} from "@solana/kit";
import {
  prepareFundAgentVaultTransaction,
  prepareRegisterTickerTransaction,
  type PreparedFundAgentVaultTransaction,
  type PreparedRegisterTickerTransaction,
} from "./gildore-vault";
import { decodeBase64, encodeBase64 } from "../base64";

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";
let broadcasterSignerPromise: Promise<
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

function createRpc() {
  return createSolanaRpc(
    solanaRpcUrl as Parameters<typeof createSolanaRpc>[0],
  );
}

function summarizePreparedTransaction(
  prepared:
    | PreparedFundAgentVaultTransaction
    | PreparedRegisterTickerTransaction,
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
