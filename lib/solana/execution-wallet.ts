import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase58Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import { decodeBase64, encodeBase64 } from "../base64";
import {
  deriveAssociatedTokenAddress,
  fetchFundingTokenInfo,
} from "./gildore-vault";

const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
const TOKEN_PROGRAM_ADDRESS = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

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

export function createRpc() {
  return createSolanaRpc(
    solanaRpcUrl as Parameters<typeof createSolanaRpc>[0],
  );
}

export async function getBroadcasterSigner() {
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

export async function createExecutionWalletSignerFromSeed(seedBytes: Uint8Array) {
  if (seedBytes.length !== 32) {
    throw new Error(
      `Execution wallet seed must be 32 bytes, got ${seedBytes.length}.`,
    );
  }

  return await createKeyPairSignerFromPrivateKeyBytes(seedBytes);
}

export function createExecutionWalletSeed() {
  return crypto.getRandomValues(new Uint8Array(32));
}

function createAssociatedTokenIdempotentInstruction(input: {
  payer: Address;
  ata: Address;
  owner: Address;
  mint: Address;
}) {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: input.ata, role: AccountRole.WRITABLE },
      { address: input.owner, role: AccountRole.READONLY },
      { address: input.mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([1]),
  };
}

export async function ensureExecutionWalletFundingAta(
  executionWalletAddressInput: string,
  logScope = "execution-wallet:ensure-funding-ata",
) {
  const rpc = createRpc();
  const broadcasterSigner = await getBroadcasterSigner();
  const executionWalletAddress = address(executionWalletAddressInput);
  const fundingToken = await fetchFundingTokenInfo(rpc);
  const ataAddress = await deriveAssociatedTokenAddress(
    executionWalletAddress,
    fundingToken.mint,
  );
  const ataAccount = await fetchEncodedAccount(rpc, ataAddress);

  if (ataAccount.exists) {
    return {
      ataAddress,
      mint: fundingToken.mint,
      decimals: fundingToken.decimals,
      created: false,
      signature: null,
    };
  }

  const latestBlockhash = await rpc.getLatestBlockhash().send();
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
      appendTransactionMessageInstruction(
        createAssociatedTokenIdempotentInstruction({
          payer: broadcasterSigner.address,
          ata: ataAddress,
          owner: executionWalletAddress,
          mint: fundingToken.mint,
        }),
        transaction,
      ),
  );

  const signedTransaction =
    await partiallySignTransactionMessageWithSigners(message);
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

  console.log(`[${logScope}] created funding ATA`, {
    executionWalletAddress,
    ataAddress,
    signature,
  });

  return {
    ataAddress,
    mint: fundingToken.mint,
    decimals: fundingToken.decimals,
    created: true,
    signature,
  };
}

export async function assertExecutionWalletHasGas(
  executionWalletAddressInput: string,
  minimumLamports = BigInt(200_000),
) {
  const rpc = createRpc();
  const executionWalletAddress = address(executionWalletAddressInput);
  const balance = await rpc.getBalance(executionWalletAddress).send();
  const lamports = balance.value;

  if (lamports < minimumLamports) {
    throw new Error(
      `Execution wallet ${executionWalletAddress} does not have enough SOL to pay venue transaction fees yet. Required at least ${minimumLamports.toString()} lamports, found ${lamports.toString()}.`,
    );
  }

  return lamports;
}

export async function signAndBroadcastVenueTransaction(args: {
  transactionBase64: string;
  signer: Awaited<ReturnType<typeof createExecutionWalletSignerFromSeed>>;
  logScope?: string;
}) {
  const rpc = createRpc();
  const decodedTransaction = getTransactionDecoder().decode(
    decodeBase64(args.transactionBase64),
  ) as Parameters<typeof args.signer.signTransactions>[0][number];
  const [signatureDictionary] = await args.signer.signTransactions([
    decodedTransaction,
  ]);
  const signedTransaction = {
    ...decodedTransaction,
    signatures: {
      ...decodedTransaction.signatures,
      ...signatureDictionary,
    },
  } as unknown as typeof decodedTransaction;
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

  console.log(`[${args.logScope ?? "execution-wallet:venue-tx"}] sent`, {
    signer: args.signer.address,
    signature,
    signedTransactionBase64: encodeBase64(
      Uint8Array.from(getTransactionEncoder().encode(signedTransaction)),
    ),
  });

  return {
    signature,
    signerAddress: args.signer.address,
  };
}
