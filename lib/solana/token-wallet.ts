import {
  AccountRole,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  getAddressDecoder,
  getSignatureFromTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import {
  getTransferCheckedInstruction,
} from "@solana-program/token";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getFlashTradeSolanaRpcUrl } from "../flashtrade/v2";
import { createExecutionWalletSignerFromSeed, getBroadcasterSigner } from "./execution-wallet";

function toPublicKey(value: Address | string) {
  return new PublicKey(value);
}

function toKitAddress(value: string) {
  return getAddressDecoder().decode(toPublicKey(value).toBytes());
}

function createRpc(rpcUrl = getFlashTradeSolanaRpcUrl()) {
  return createSolanaRpc(rpcUrl as Parameters<typeof createSolanaRpc>[0]);
}

function readTokenAccountMint(data: Uint8Array) {
  return toKitAddress(new PublicKey(data.slice(0, 32)).toBase58());
}

function readTokenAccountOwner(data: Uint8Array) {
  return toKitAddress(new PublicKey(data.slice(32, 64)).toBase58());
}

function readTokenAccountAmount(data: Uint8Array) {
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(64, true);
}

function deriveAtaAddress(ownerAddress: string, mintAddress: string) {
  return getAssociatedTokenAddressSync(
    new PublicKey(mintAddress),
    new PublicKey(ownerAddress),
    true,
  ).toBase58();
}

export async function ensureSolanaTokenAta(args: {
  ownerAddress: string;
  mintAddress: string;
  rpcUrl?: string;
  logScope?: string;
}) {
  const rpc = createRpc(args.rpcUrl);
  const broadcasterSigner = await getBroadcasterSigner();
  const ataAddress = deriveAtaAddress(args.ownerAddress, args.mintAddress);
  const existingAccount = await fetchEncodedAccount(
    rpc,
    toKitAddress(ataAddress),
  );

  if (existingAccount.exists) {
    return {
      ataAddress,
      created: false,
      signature: null,
    };
  }

  const latestBlockhash = await rpc.getLatestBlockhash().send();
  const instruction = createAssociatedTokenAccountIdempotentInstruction(
    new PublicKey(broadcasterSigner.address),
    new PublicKey(ataAddress),
    new PublicKey(args.ownerAddress),
    new PublicKey(args.mintAddress),
  );
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
        {
          programAddress: toKitAddress(instruction.programId.toBase58()),
          accounts: instruction.keys.map((key: {
            pubkey: PublicKey;
            isSigner: boolean;
            isWritable: boolean;
          }) => ({
            address: toKitAddress(key.pubkey.toBase58()),
            role: key.isSigner
              ? key.isWritable
                ? AccountRole.WRITABLE_SIGNER
                : AccountRole.READONLY_SIGNER
              : key.isWritable
                ? AccountRole.WRITABLE
                : AccountRole.READONLY,
          })),
          data: instruction.data,
        } as never,
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

  return {
    ataAddress,
    created: true,
    signature: getSignatureFromTransaction(signedTransaction),
  };
}

export async function getSolanaTokenWalletBalance(args: {
  ownerAddress: string;
  mintAddress: string;
  rpcUrl?: string;
}) {
  const rpc = createRpc(args.rpcUrl);
  const ataAddress = deriveAtaAddress(args.ownerAddress, args.mintAddress);
  const account = await fetchEncodedAccount(rpc, toKitAddress(ataAddress));

  if (!account.exists) {
    return {
      ataAddress,
      balance: BigInt(0),
    };
  }

  return {
    ataAddress,
    balance: readTokenAccountAmount(account.data),
  };
}

export async function transferSolanaSplFromExecutionWallet(args: {
  seedBytes: Uint8Array;
  sourceMintAddress: string;
  destinationTokenAccount: string;
  amount: bigint;
  decimals: number;
  rpcUrl?: string;
}) {
  const rpc = createRpc(args.rpcUrl);
  const signer = await createExecutionWalletSignerFromSeed(args.seedBytes);
  const broadcasterSigner = await getBroadcasterSigner();
  const sourceAtaAddress = deriveAtaAddress(
    signer.address,
    args.sourceMintAddress,
  );
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
        getTransferCheckedInstruction({
          source: toKitAddress(sourceAtaAddress),
          mint: toKitAddress(args.sourceMintAddress),
          destination: toKitAddress(args.destinationTokenAccount),
          authority: signer,
          amount: args.amount,
          decimals: args.decimals,
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

  return {
    signature: getSignatureFromTransaction(signedTransaction),
    sourceAtaAddress,
  };
}

export {
  deriveAtaAddress as deriveSolanaAtaAddress,
  readTokenAccountAmount as decodeSolanaTokenAccountAmount,
  readTokenAccountMint as decodeSolanaTokenAccountMint,
  readTokenAccountOwner as decodeSolanaTokenAccountOwner,
};
