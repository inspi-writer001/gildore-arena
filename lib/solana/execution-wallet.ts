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
  getAddressDecoder,
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
import { Connection } from "@solana/web3.js";
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

function decodeAddressSlice(data: Uint8Array, start: number, end: number) {
  return getAddressDecoder().decode(data.slice(start, end));
}

function decodeSplTokenAccountMint(data: Uint8Array): Address {
  if (data.length < 32) {
    throw new Error(
      `Execution wallet ATA is not a valid SPL token account (expected at least 32 bytes, got ${data.length}).`,
    );
  }

  return decodeAddressSlice(data, 0, 32);
}

function decodeSplTokenAccountOwner(data: Uint8Array): Address {
  if (data.length < 64) {
    throw new Error(
      `Execution wallet ATA owner layout is invalid (expected at least 64 bytes, got ${data.length}).`,
    );
  }

  return decodeAddressSlice(data, 32, 64);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmAtaCreation(args: {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}) {
  const connection = new Connection(solanaRpcUrl, "confirmed");
  const result = await connection.confirmTransaction(
    {
      signature: args.signature,
      blockhash: args.blockhash,
      lastValidBlockHeight: args.lastValidBlockHeight,
    },
    "confirmed",
  );

  if (result.value.err) {
    throw new Error(
      `Execution wallet ATA creation failed: ${JSON.stringify(result.value.err)}`,
    );
  }
}

async function verifyExecutionWalletFundingAta(args: {
  rpc: ReturnType<typeof createRpc>;
  ataAddress: Address;
  executionWalletAddress: Address;
  fundingMint: Address;
  logScope: string;
}) {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ataAccount = await fetchEncodedAccount(args.rpc, args.ataAddress);

    if (!ataAccount.exists) {
      if (attempt < maxAttempts) {
        await sleep(400);
        continue;
      }

      throw new Error(
        `Execution wallet funding ATA ${args.ataAddress} is still not visible after confirmation.`,
      );
    }

    if ("programAddress" in ataAccount) {
      const accountProgramAddress = ataAccount.programAddress as Address;
      if (accountProgramAddress !== TOKEN_PROGRAM_ADDRESS) {
        throw new Error(
          `Execution wallet funding ATA ${args.ataAddress} is owned by ${accountProgramAddress}, expected ${TOKEN_PROGRAM_ADDRESS}.`,
        );
      }
    }

    const accountMint = decodeSplTokenAccountMint(ataAccount.data);
    if (accountMint !== args.fundingMint) {
      throw new Error(
        `Execution wallet funding ATA ${args.ataAddress} mint mismatch. Expected ${args.fundingMint}, got ${accountMint}.`,
      );
    }

    const tokenAccountOwner = decodeSplTokenAccountOwner(ataAccount.data);
    if (tokenAccountOwner !== args.executionWalletAddress) {
      throw new Error(
        `Execution wallet funding ATA ${args.ataAddress} token owner mismatch. Expected ${args.executionWalletAddress}, got ${tokenAccountOwner}.`,
      );
    }

    console.log(`[${args.logScope}] verified funding ATA`, {
      ataAddress: args.ataAddress,
      executionWalletAddress: args.executionWalletAddress,
      mint: args.fundingMint,
      attempt,
    });

    return;
  }
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
    await verifyExecutionWalletFundingAta({
      rpc,
      ataAddress,
      executionWalletAddress,
      fundingMint: fundingToken.mint,
      logScope,
    });

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
  await confirmAtaCreation({
    signature,
    blockhash: latestBlockhash.value.blockhash,
    lastValidBlockHeight: Number(latestBlockhash.value.lastValidBlockHeight),
  });
  await verifyExecutionWalletFundingAta({
    rpc,
    ataAddress,
    executionWalletAddress,
    fundingMint: fundingToken.mint,
    logScope,
  });

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
