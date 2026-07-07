import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  getUtf8Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type TransactionMessageWithBlockhashLifetime,
} from "@solana/kit";
import { decodeBase64, encodeBase64 } from "../base64";

const PROGRAM_ADDRESS = address("2Xefp1aBUabU12QNDPxpj3ieU7MjZzcS6uD7x4e9qye9");
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
const TOKEN_PROGRAM_ADDRESS = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const GLOBAL_STATE_DISCRIMINATOR = 2;
const USER_STATE_DISCRIMINATOR = 1;
const TICKER_DISCRIMINATOR = 5;

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

type GlobalState = {
  feeDestination: Address;
  feeBps: number;
  maxFee: bigint;
  bump: number;
  admin: Address[];
};

type UserState = {
  userAddress: Address;
  agentId: Address;
  tickerId: Address;
  isInitialized: boolean;
  modifiedTime: bigint;
  createdTime: bigint;
  amount: bigint;
  bump: number;
};

type TickerState = {
  amountToSpend: bigint;
  isInPosition: boolean;
};

type FundingTokenInfo = {
  feeDestinationTokenAccount: Address;
  mint: Address;
  decimals: number;
};

export type FundingTokenWalletBalance = {
  mint: Address;
  decimals: number;
  ataAddress: Address;
  hasTokenAccount: boolean;
  balance: bigint;
};

export type UserVaultSnapshot = {
  mint: Address;
  decimals: number;
  userStateAddress: Address;
  userState: UserState | null;
  tickerAddress: Address;
  ticker: TickerState | null;
};

export type PreparedFundAgentVaultTransaction = {
  amountBaseUnits: bigint;
  mint: Address;
  decimals: number;
  agentAddress: Address;
  agentId: Address;
  globalStateAddress: Address;
  userAddress: Address;
  payerAddress: Address;
  userStateAddress: Address;
  tickerAddress: Address;
  userTokenAccountAddress: Address;
  userStateVaultAddress: Address;
  transactionMessage: TransactionMessageWithBlockhashLifetime;
};

export type PreparedRegisterTickerTransaction = {
  amountBaseUnits: bigint;
  mint: Address;
  decimals: number;
  agentAddress: Address;
  agentId: Address;
  userAddress: Address;
  payerAddress: Address;
  userStateAddress: Address;
  tickerAddress: Address;
  userStateVaultAddress: Address;
  transactionMessage: TransactionMessageWithBlockhashLifetime;
};

export type PreparedWithdrawTransaction = {
  amountBaseUnits: bigint;
  mint: Address;
  decimals: number;
  agentAddress: Address;
  agentId: Address;
  userAddress: Address;
  payerAddress: Address;
  userStateAddress: Address;
  tickerAddress: Address;
  userStateVaultAddress: Address;
  userTokenAccountAddress: Address;
  transactionMessage: TransactionMessageWithBlockhashLifetime;
};

function readU16(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(
    offset,
    true,
  );
}

function readU64(data: Uint8Array, offset: number) {
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(offset, true);
}

function encodeU64(value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function decodeAddressSlice(data: Uint8Array, start: number, end: number) {
  return getAddressDecoder().decode(data.slice(start, end));
}

function parseUiAmountToBaseUnits(value: string, decimals: number) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid deposit amount");
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

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return new Uint8Array(digest);
}

export async function deriveGlobalStateAddress() {
  const [globalStateAddress] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode("global_state")],
  });
  return globalStateAddress;
}

export function normalizeAgentName(agentName: string) {
  return agentName.trim().toLowerCase();
}

export async function deriveAgentId(agentName: string) {
  const programBytes = getAddressEncoder().encode(PROGRAM_ADDRESS);
  const nameBytes = getUtf8Encoder().encode(normalizeAgentName(agentName));
  const payload = new Uint8Array(programBytes.length + nameBytes.length);
  payload.set(programBytes);
  payload.set(nameBytes, programBytes.length);
  return getAddressDecoder().decode(await sha256(payload));
}

export async function deriveAgentAddress(agentName: string) {
  const agentId = await deriveAgentId(agentName);
  const [agentAddress] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("agent"),
      getAddressEncoder().encode(agentId),
    ],
  });
  return { agentAddress, agentId };
}

export async function deriveUserStateAddress(
  userAddress: Address,
  mintAddress: Address,
  agentAddress: Address,
) {
  const [userStateAddress] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("user_state"),
      getAddressEncoder().encode(userAddress),
      getAddressEncoder().encode(mintAddress),
      getAddressEncoder().encode(agentAddress),
    ],
  });
  return userStateAddress;
}

export async function deriveTickerAddress(
  agentId: Address,
  userAddress: Address,
) {
  const [tickerAddress] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("ticker"),
      getAddressEncoder().encode(agentId),
      getAddressEncoder().encode(userAddress),
    ],
  });
  return tickerAddress;
}

export async function deriveAssociatedTokenAddress(
  ownerAddress: Address,
  mintAddress: Address,
) {
  const [ataAddress] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      getAddressEncoder().encode(ownerAddress),
      getAddressEncoder().encode(TOKEN_PROGRAM_ADDRESS),
      getAddressEncoder().encode(mintAddress),
    ],
  });
  return ataAddress;
}

function decodeGlobalStateAccount(data: Uint8Array): GlobalState {
  if (data[0] !== GLOBAL_STATE_DISCRIMINATOR) {
    throw new Error("Invalid global state discriminator");
  }

  const payload = data.slice(1);
  const feeDestination = decodeAddressSlice(payload, 0, 32);
  const feeBps = readU16(payload, 32);
  const maxFee = readU64(payload, 34);
  const bump = payload[42] ?? 0;
  const adminLength = readU16(payload, 43);
  const admin: Address[] = [];
  let cursor = 45;

  if (payload.length < cursor + adminLength * 32) {
    throw new Error(
      `Invalid global state admin layout: expected ${adminLength} admin address(es), but only ${payload.length - cursor} byte(s) remain after the header.`,
    );
  }

  for (let index = 0; index < adminLength; index += 1) {
    admin.push(decodeAddressSlice(payload, cursor, cursor + 32));
    cursor += 32;
  }

  return { feeDestination, feeBps, maxFee, bump, admin };
}

function decodeUserStateAccount(data: Uint8Array): UserState {
  if (data[0] !== USER_STATE_DISCRIMINATOR) {
    throw new Error("Invalid user state discriminator");
  }

  const payload = data.slice(1);
  return {
    userAddress: decodeAddressSlice(payload, 0, 32),
    agentId: decodeAddressSlice(payload, 32, 64),
    tickerId: decodeAddressSlice(payload, 64, 96),
    isInitialized: payload[96] === 1,
    modifiedTime: readU64(payload, 97),
    createdTime: readU64(payload, 105),
    amount: readU64(payload, 113),
    bump: payload[121] ?? 0,
  };
}

function decodeTickerAccount(data: Uint8Array): TickerState {
  if (data[0] !== TICKER_DISCRIMINATOR) {
    throw new Error("Invalid ticker discriminator");
  }

  // Layout: discriminator(1) + amountToSpend(8) + isInPosition(1)
  return {
    amountToSpend: readU64(data, 1),
    isInPosition: (data[9] ?? 0) === 1,
  };
}

function decodeSplTokenAccountMint(data: Uint8Array): Address {
  if (data.length < 32) {
    throw new Error(
      `Configured fee destination is not a valid SPL token account (expected at least 32 bytes, got ${data.length}).`,
    );
  }

  return decodeAddressSlice(data, 0, 32);
}

function decodeSplTokenAccountOwner(data: Uint8Array): Address {
  if (data.length < 64) {
    throw new Error(
      `Configured token account owner layout is invalid (expected at least 64 bytes, got ${data.length}).`,
    );
  }

  return decodeAddressSlice(data, 32, 64);
}

function decodeSplTokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < 72) {
    throw new Error(
      `Configured token account amount layout is invalid (expected at least 72 bytes, got ${data.length}).`,
    );
  }

  return readU64(data, 64);
}

function decodeSplMintDecimals(data: Uint8Array): number {
  if (data.length < 45) {
    throw new Error(
      `Configured funding mint is not a valid SPL mint account (expected at least 45 bytes, got ${data.length}).`,
    );
  }

  return data[44] ?? 0;
}

export async function fetchGlobalState(rpc: SolanaRpc) {
  const globalStateAddress = await deriveGlobalStateAddress();
  const account = await fetchEncodedAccount(rpc, globalStateAddress);
  if (!account.exists) {
    throw new Error("Vault global state is not initialized");
  }

  return {
    address: globalStateAddress,
    state: decodeGlobalStateAccount(account.data),
  };
}

export async function fetchFundingTokenInfo(
  rpc: SolanaRpc,
): Promise<FundingTokenInfo> {
  const {
    state: { feeDestination },
  } = await fetchGlobalState(rpc);

  const feeDestinationTokenAccount = await fetchEncodedAccount(
    rpc,
    feeDestination,
  );

  if (!feeDestinationTokenAccount.exists) {
    throw new Error(
      "Configured fee destination token account does not exist on the current cluster.",
    );
  }

  const mint = decodeSplTokenAccountMint(feeDestinationTokenAccount.data);
  const mintAccount = await fetchEncodedAccount(rpc, mint);

  if (!mintAccount.exists) {
    throw new Error(
      "Configured funding mint account does not exist on the current cluster.",
    );
  }

  const decimals = decodeSplMintDecimals(mintAccount.data);

  return {
    feeDestinationTokenAccount: feeDestination,
    mint,
    decimals,
  };
}

export async function fetchFundingTokenWalletBalance(
  rpc: SolanaRpc,
  userAddressInput: string,
): Promise<FundingTokenWalletBalance> {
  const userAddress = address(userAddressInput);
  const fundingToken = await fetchFundingTokenInfo(rpc);
  const ataAddress = await deriveAssociatedTokenAddress(
    userAddress,
    fundingToken.mint,
  );
  const tokenAccount = await fetchEncodedAccount(rpc, ataAddress);

  if (!tokenAccount.exists) {
    return {
      mint: fundingToken.mint,
      decimals: fundingToken.decimals,
      ataAddress,
      hasTokenAccount: false,
      balance: BigInt(0),
    };
  }

  const tokenAccountMint = decodeSplTokenAccountMint(tokenAccount.data);
  const tokenAccountOwner = decodeSplTokenAccountOwner(tokenAccount.data);

  if (tokenAccountMint !== fundingToken.mint) {
    throw new Error(
      `Connected wallet token account mint mismatch. Expected ${fundingToken.mint}, got ${tokenAccountMint}.`,
    );
  }
  if (tokenAccountOwner !== userAddress) {
    throw new Error(
      `Connected wallet token account owner mismatch. Expected ${userAddress}, got ${tokenAccountOwner}.`,
    );
  }

  return {
    mint: fundingToken.mint,
    decimals: fundingToken.decimals,
    ataAddress,
    hasTokenAccount: true,
    balance: decodeSplTokenAccountAmount(tokenAccount.data),
  };
}

function createDepositForAgentUseInstruction(input: {
  payer: Address;
  user: Address;
  agent: Address;
  globalStateAccount: Address;
  userState: Address;
  userStateVault: Address;
  ticker: Address;
  destinationFeeTokenAccount: Address;
  userTokenAccount: Address;
  mint: Address;
  amount: bigint;
}): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: input.user, role: AccountRole.WRITABLE_SIGNER },
      { address: input.agent, role: AccountRole.WRITABLE },
      { address: input.globalStateAccount, role: AccountRole.WRITABLE },
      { address: input.userState, role: AccountRole.WRITABLE },
      { address: input.userStateVault, role: AccountRole.WRITABLE },
      { address: input.ticker, role: AccountRole.WRITABLE },
      {
        address: input.destinationFeeTokenAccount,
        role: AccountRole.WRITABLE,
      },
      { address: input.userTokenAccount, role: AccountRole.WRITABLE },
      { address: input.mint, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([3, ...encodeU64(input.amount)]),
  };
}

function createRegisterTickerForMeInstruction(input: {
  payer: Address;
  user: Address;
  agent: Address;
  userState: Address;
  ticker: Address;
  mint: Address;
  amountToSpend: bigint;
}): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: input.user, role: AccountRole.WRITABLE_SIGNER },
      { address: input.agent, role: AccountRole.WRITABLE },
      { address: input.userState, role: AccountRole.READONLY },
      { address: input.ticker, role: AccountRole.WRITABLE },
      { address: input.mint, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([4, ...encodeU64(input.amountToSpend)]),
  };
}

function createUserWithdrawalInstruction(input: {
  user: Address;
  agent: Address;
  userState: Address;
  userStateVault: Address;
  mint: Address;
  globalStateAccount: Address;
  userTokenAccount: Address;
  amount: bigint;
}): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [
      { address: input.user, role: AccountRole.WRITABLE_SIGNER },
      { address: input.agent, role: AccountRole.READONLY },
      { address: input.userState, role: AccountRole.WRITABLE },
      { address: input.userStateVault, role: AccountRole.WRITABLE },
      { address: input.mint, role: AccountRole.READONLY },
      { address: input.globalStateAccount, role: AccountRole.WRITABLE },
      { address: input.userTokenAccount, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([6, ...encodeU64(input.amount)]),
  };
}

function createAssociatedTokenIdempotentInstruction(input: {
  payer: Address;
  ata: Address;
  owner: Address;
  mint: Address;
}): Instruction {
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

export async function fetchUserVaultSnapshot(
  rpc: SolanaRpc,
  userAddressInput: string,
  agentName: string,
): Promise<UserVaultSnapshot> {
  const userAddress = address(userAddressInput);
  const fundingToken = await fetchFundingTokenInfo(rpc);
  const { agentAddress, agentId } = await deriveAgentAddress(agentName);
  const userStateAddress = await deriveUserStateAddress(
    userAddress,
    fundingToken.mint,
    agentAddress,
  );
  const tickerAddress = await deriveTickerAddress(agentId, userAddress);
  const [userStateAccount, tickerAccount] = await Promise.all([
    fetchEncodedAccount(rpc, userStateAddress),
    fetchEncodedAccount(rpc, tickerAddress),
  ]);

  return {
    mint: fundingToken.mint,
    decimals: fundingToken.decimals,
    userStateAddress,
    userState: userStateAccount.exists
      ? decodeUserStateAccount(userStateAccount.data)
      : null,
    tickerAddress,
    ticker: tickerAccount.exists
      ? decodeTickerAccount(tickerAccount.data)
      : null,
  };
}

export async function prepareFundAgentVaultTransaction(input: {
  rpc: SolanaRpc;
  userAddressInput: string;
  payerAddressInput: string;
  agentName: string;
  amountUi: string;
}): Promise<PreparedFundAgentVaultTransaction> {
  const userAddress = address(input.userAddressInput);
  const payerAddress = address(input.payerAddressInput);

  const { address: globalStateAddress } = await fetchGlobalState(input.rpc);
  const fundingToken = await fetchFundingTokenInfo(input.rpc);
  const { agentAddress, agentId } = await deriveAgentAddress(input.agentName);

  const agentAccount = await fetchEncodedAccount(input.rpc, agentAddress);
  if (!agentAccount.exists) {
    throw new Error(
      `Vault agent account for "${input.agentName}" is not registered on this cluster.`,
    );
  }

  const amountBaseUnits = parseUiAmountToBaseUnits(
    input.amountUi,
    fundingToken.decimals,
  );
  const userStateAddress = await deriveUserStateAddress(
    userAddress,
    fundingToken.mint,
    agentAddress,
  );
  const tickerAddress = await deriveTickerAddress(agentId, userAddress);
  const userTokenAccountAddress = await deriveAssociatedTokenAddress(
    userAddress,
    fundingToken.mint,
  );
  const userStateVaultAddress = await deriveAssociatedTokenAddress(
    userStateAddress,
    fundingToken.mint,
  );

  const userTokenAccount = await fetchEncodedAccount(
    input.rpc,
    userTokenAccountAddress,
  );
  if (!userTokenAccount.exists) {
    throw new Error(
      `Connected wallet does not have a token account for funding mint ${fundingToken.mint} on this cluster.`,
    );
  }

  const userTokenAccountMint = decodeSplTokenAccountMint(userTokenAccount.data);
  const userTokenAccountOwner = decodeSplTokenAccountOwner(
    userTokenAccount.data,
  );
  const userTokenAccountAmount = decodeSplTokenAccountAmount(
    userTokenAccount.data,
  );

  if (userTokenAccountMint !== fundingToken.mint) {
    throw new Error(
      `Connected wallet token account mint mismatch. Expected ${fundingToken.mint}, got ${userTokenAccountMint}.`,
    );
  }
  if (userTokenAccountOwner !== userAddress) {
    throw new Error(
      `Connected wallet token account owner mismatch. Expected ${userAddress}, got ${userTokenAccountOwner}.`,
    );
  }
  if (userTokenAccountAmount < amountBaseUnits) {
    throw new Error(
      `Insufficient funding token balance. Need ${amountBaseUnits.toString()} base units, but wallet only has ${userTokenAccountAmount.toString()}.`,
    );
  }

  const latestBlockhash = await input.rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: "legacy" }),
    (message) => setTransactionMessageFeePayer(payerAddress, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash.value,
        message,
      ),
    (message) =>
      appendTransactionMessageInstruction(
        createAssociatedTokenIdempotentInstruction({
          payer: payerAddress,
          ata: userStateVaultAddress,
          owner: userStateAddress,
          mint: fundingToken.mint,
        }),
        message,
      ),
    (message) =>
      appendTransactionMessageInstruction(
        createDepositForAgentUseInstruction({
          payer: payerAddress,
          user: userAddress,
          agent: agentAddress,
          globalStateAccount: globalStateAddress,
          userState: userStateAddress,
          userStateVault: userStateVaultAddress,
          ticker: tickerAddress,
          destinationFeeTokenAccount: fundingToken.feeDestinationTokenAccount,
          userTokenAccount: userTokenAccountAddress,
          mint: fundingToken.mint,
          amount: amountBaseUnits,
        }),
        message,
      ),
  );

  return {
    amountBaseUnits,
    mint: fundingToken.mint,
    decimals: fundingToken.decimals,
    agentAddress,
    agentId,
    globalStateAddress,
    userAddress,
    payerAddress,
    userStateAddress,
    tickerAddress,
    userTokenAccountAddress,
    userStateVaultAddress,
    transactionMessage,
  };
}

export async function prepareRegisterTickerTransaction(input: {
  rpc: SolanaRpc;
  userAddressInput: string;
  payerAddressInput: string;
  agentName: string;
  amountUi: string;
}): Promise<PreparedRegisterTickerTransaction> {
  const userAddress = address(input.userAddressInput);
  const payerAddress = address(input.payerAddressInput);
  const fundingToken = await fetchFundingTokenInfo(input.rpc);
  const { agentAddress, agentId } = await deriveAgentAddress(input.agentName);
  const agentAccount = await fetchEncodedAccount(input.rpc, agentAddress);

  if (!agentAccount.exists) {
    throw new Error(
      `Vault agent account for "${input.agentName}" is not registered on this cluster.`,
    );
  }

  const amountBaseUnits = parseUiAmountToBaseUnits(
    input.amountUi,
    fundingToken.decimals,
  );
  if (amountBaseUnits <= BigInt(0)) {
    throw new Error("Enter a spendable amount greater than zero.");
  }

  const userStateAddress = await deriveUserStateAddress(
    userAddress,
    fundingToken.mint,
    agentAddress,
  );
  const tickerAddress = await deriveTickerAddress(agentId, userAddress);
  const userStateVaultAddress = await deriveAssociatedTokenAddress(
    userStateAddress,
    fundingToken.mint,
  );

  const userStateAccount = await fetchEncodedAccount(
    input.rpc,
    userStateAddress,
  );

  if (!userStateAccount.exists) {
    throw new Error("Fund this agent first before configuring max spendable.");
  }

  const latestBlockhash = await input.rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: "legacy" }),
    (message) => setTransactionMessageFeePayer(payerAddress, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash.value,
        message,
      ),
    (message) =>
      appendTransactionMessageInstruction(
        createRegisterTickerForMeInstruction({
          payer: payerAddress,
          user: userAddress,
          agent: agentAddress,
          userState: userStateAddress,
          ticker: tickerAddress,
          mint: fundingToken.mint,
          amountToSpend: amountBaseUnits,
        }),
        message,
      ),
  );

  return {
    amountBaseUnits,
    mint: fundingToken.mint,
    decimals: fundingToken.decimals,
    agentAddress,
    agentId,
    userAddress,
    payerAddress,
    userStateAddress,
    tickerAddress,
    userStateVaultAddress,
    transactionMessage,
  };
}

export async function prepareWithdrawTransaction(input: {
  rpc: SolanaRpc;
  userAddressInput: string;
  payerAddressInput: string;
  agentName: string;
  amountUi: string;
}): Promise<PreparedWithdrawTransaction> {
  const userAddress = address(input.userAddressInput);
  const payerAddress = address(input.payerAddressInput);

  const { address: globalStateAddress } = await fetchGlobalState(input.rpc);
  const fundingToken = await fetchFundingTokenInfo(input.rpc);
  const { agentAddress, agentId } = await deriveAgentAddress(input.agentName);

  const agentAccount = await fetchEncodedAccount(input.rpc, agentAddress);
  if (!agentAccount.exists) {
    throw new Error(
      `Vault agent account for "${input.agentName}" is not registered on this cluster.`,
    );
  }

  const amountBaseUnits = parseUiAmountToBaseUnits(
    input.amountUi,
    fundingToken.decimals,
  );
  if (amountBaseUnits <= BigInt(0)) {
    throw new Error("Enter a withdrawal amount greater than zero.");
  }

  const userStateAddress = await deriveUserStateAddress(
    userAddress,
    fundingToken.mint,
    agentAddress,
  );
  const tickerAddress = await deriveTickerAddress(agentId, userAddress);
  const userStateVaultAddress = await deriveAssociatedTokenAddress(
    userStateAddress,
    fundingToken.mint,
  );
  const userTokenAccountAddress = await deriveAssociatedTokenAddress(
    userAddress,
    fundingToken.mint,
  );

  const [userStateAccount, userStateVaultAccount] = await Promise.all([
    fetchEncodedAccount(input.rpc, userStateAddress),
    fetchEncodedAccount(input.rpc, userStateVaultAddress),
  ]);

  if (!userStateAccount.exists) {
    throw new Error(
      "No vault position found for this agent. Deposit first before withdrawing.",
    );
  }

  if (!userStateVaultAccount.exists) {
    throw new Error(
      "Vault token account not found. Deposit first before withdrawing.",
    );
  }

  const vaultBalance = decodeSplTokenAccountAmount(userStateVaultAccount.data);
  if (vaultBalance < amountBaseUnits) {
    throw new Error(
      `Insufficient vault balance. Available: ${vaultBalance.toString()} base units, requested: ${amountBaseUnits.toString()}.`,
    );
  }

  const latestBlockhash = await input.rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: "legacy" }),
    (message) => setTransactionMessageFeePayer(payerAddress, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash.value,
        message,
      ),
    (message) =>
      appendTransactionMessageInstruction(
        createUserWithdrawalInstruction({
          user: userAddress,
          agent: agentAddress,
          userState: userStateAddress,
          userStateVault: userStateVaultAddress,
          mint: fundingToken.mint,
          globalStateAccount: globalStateAddress,
          userTokenAccount: userTokenAccountAddress,
          amount: amountBaseUnits,
        }),
        message,
      ),
  );

  return {
    amountBaseUnits,
    mint: fundingToken.mint,
    decimals: fundingToken.decimals,
    agentAddress,
    agentId,
    userAddress,
    payerAddress,
    userStateAddress,
    tickerAddress,
    userStateVaultAddress,
    userTokenAccountAddress,
    transactionMessage,
  };
}
