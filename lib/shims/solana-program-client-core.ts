import { AccountRole, type Address } from "@solana/kit";

type ResolvedInstructionAccount =
  | Address
  | {
      address?: Address;
      value?: Address | null;
      isWritable?: boolean;
      isSigner?: boolean;
      role?: AccountRole;
    };

function toRole(account: Exclude<ResolvedInstructionAccount, Address>) {
  if (typeof account.role === "number") {
    return account.role;
  }

  if (account.isSigner) {
    return account.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  }

  return account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

export function getAddressFromResolvedInstructionAccount(
  account: ResolvedInstructionAccount,
): Address {
  if (typeof account === "string") {
    return account as Address;
  }

  if (account.value) {
    return account.value;
  }

  if (account.address) {
    return account.address;
  }

  throw new Error("Resolved instruction account is missing an address.");
}

export function getAccountMetaFactory(_programAddress: Address, _mode?: string) {
  return (_name: string, account: ResolvedInstructionAccount) => {
    const address = getAddressFromResolvedInstructionAccount(account);

    if (typeof account === "string") {
      return { address, role: AccountRole.READONLY };
    }

    return {
      address,
      role: toRole(account),
    };
  };
}

export function addSelfFetchFunctions<T>(value: T): T {
  return value;
}

export function addSelfPlanAndSendFunctions<T>(value: T): T {
  return value;
}
