/**
 * Decoder for FastAuth sign() payloads (NEP-366 SignableMessage).
 *
 * The bytes passed to FastAuth.sign() as `sign_payload` are:
 *   1. u32 LE discriminant = (1 << 30) + 366  (NEP-366 DelegateAction)
 *   2. Borsh-serialized DelegateAction:
 *        sender_id: AccountId          // u32 len + utf-8 bytes
 *        receiver_id: AccountId        // u32 len + utf-8 bytes
 *        actions: Vec<NonDelegateAction>
 *          // u32 count, then for each action:
 *          //   u8 enum tag + body
 *        nonce: u64                    // 8 bytes
 *        max_block_height: u64         // 8 bytes
 *        public_key: PublicKey         // 1 byte variant + 32 (ed25519) or 64 (secp256k1)
 *
 * Two extractors:
 *   - decodeSignActionType: cheap, just reads the first action's enum tag
 *   - decodeSignDelegatePublicKey: full Borsh skip past actions[] to read the
 *     trailing public_key field. Used by the worker so it can populate the
 *     in-memory FastAuth pubkey set synchronously and match consumer txs in
 *     the same iteration.
 *
 * Action enum (from near-primitives):
 *   0 = CreateAccount   1 = DeployContract  2 = FunctionCall  3 = Transfer
 *   4 = Stake           5 = AddKey          6 = DeleteKey     7 = DeleteAccount
 */

const NEP_366_DELEGATE_DISCRIMINANT = (1 << 30) + 366; // 1_073_742_190

const ACTION_TAG_TO_NAME: Record<number, string> = {
  0: "CreateAccount",
  1: "DeployContract",
  2: "FunctionCall",
  3: "Transfer",
  4: "Stake",
  5: "AddKey",
  6: "DeleteKey",
  7: "DeleteAccount",
  8: "Delegate",
};

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function readU32LE(buf: Uint8Array, offset: number): number | null {
  if (offset + 4 > buf.length) return null;
  return (
    ((buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>>
      0)
  );
}

// Skip a Borsh u32 length-prefixed field (String or Vec<u8>). Returns the
// offset just past the field, or -1 on under-read.
function skipLengthPrefixed(buf: Uint8Array, offset: number): number {
  const len = readU32LE(buf, offset);
  if (len === null) return -1;
  const next = offset + 4 + len;
  if (next > buf.length) return -1;
  return next;
}

// Skip a NEAR PublicKey: 1 byte variant + 32 (ed25519) or 64 (secp256k1) bytes.
function skipPublicKey(buf: Uint8Array, offset: number): number {
  if (offset + 1 > buf.length) return -1;
  const variant = buf[offset];
  const keyLen = variant === 0 ? 32 : variant === 1 ? 64 : -1;
  if (keyLen < 0) return -1;
  const next = offset + 1 + keyLen;
  if (next > buf.length) return -1;
  return next;
}

// Skip an AccessKey: u64 nonce + AccessKeyPermission enum
//   0 FunctionCall = Option<u128> allowance + AccountId + Vec<String> method_names
//   1 FullAccess   = empty
function skipAccessKey(buf: Uint8Array, offset: number): number {
  offset += 8; // nonce u64
  if (offset + 1 > buf.length) return -1;
  const permission = buf[offset];
  offset += 1;
  if (permission === 1) return offset; // FullAccess: nothing more
  if (permission === 0) {
    if (offset + 1 > buf.length) return -1;
    const allowanceTag = buf[offset];
    offset += 1;
    if (allowanceTag === 1) offset += 16; // Some(u128)
    offset = skipLengthPrefixed(buf, offset); // AccountId
    if (offset < 0) return -1;
    const methodCount = readU32LE(buf, offset);
    if (methodCount === null) return -1;
    offset += 4;
    for (let i = 0; i < methodCount; i++) {
      offset = skipLengthPrefixed(buf, offset);
      if (offset < 0) return -1;
    }
    return offset;
  }
  return -1; // unknown permission variant
}

// Skip a single NonDelegateAction (u8 tag + variant body).
function skipAction(buf: Uint8Array, offset: number): number {
  if (offset + 1 > buf.length) return -1;
  const tag = buf[offset];
  offset += 1;
  switch (tag) {
    case 0:
      return offset; // CreateAccount: empty
    case 1:
      return skipLengthPrefixed(buf, offset); // DeployContract { code }
    case 2: {
      // FunctionCall { method_name, args, gas: u64, deposit: u128 }
      offset = skipLengthPrefixed(buf, offset);
      if (offset < 0) return -1;
      offset = skipLengthPrefixed(buf, offset);
      if (offset < 0) return -1;
      offset += 8 + 16; // gas + deposit
      return offset > buf.length ? -1 : offset;
    }
    case 3:
      // Transfer { deposit: u128 }
      return offset + 16 > buf.length ? -1 : offset + 16;
    case 4: {
      // Stake { stake: u128, public_key }
      offset += 16;
      return skipPublicKey(buf, offset);
    }
    case 5: {
      // AddKey { public_key, access_key }
      offset = skipPublicKey(buf, offset);
      if (offset < 0) return -1;
      return skipAccessKey(buf, offset);
    }
    case 6:
      // DeleteKey { public_key }
      return skipPublicKey(buf, offset);
    case 7:
      // DeleteAccount { beneficiary_id }
      return skipLengthPrefixed(buf, offset);
    default:
      return -1;
  }
}

/** Borsh-encode independent base58 of a byte buffer (NEAR / Bitcoin alphabet). */
function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

/**
 * Decode the first action type from a sign_payload byte sequence. Returns:
 *   - "AddKey" / "FunctionCall" / etc. if NEP-366 DelegateAction with ≥1 action
 *   - "Empty" if the DelegateAction has no actions
 *   - "Raw" if the discriminant doesn't match NEP-366 (other signable types)
 *   - null if the payload is too short or malformed
 */
export function decodeSignActionType(
  payload: number[] | Uint8Array | null | undefined,
): string | null {
  if (!payload) return null;

  const buf = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (buf.length < 16) return null;

  const discriminant = readU32LE(buf, 0);
  if (discriminant !== NEP_366_DELEGATE_DISCRIMINANT) {
    return "Raw";
  }

  let offset = 4;

  offset = skipLengthPrefixed(buf, offset);
  if (offset < 0) return null;
  offset = skipLengthPrefixed(buf, offset);
  if (offset < 0) return null;

  const actionsCount = readU32LE(buf, offset);
  if (actionsCount === null) return null;
  offset += 4;

  if (actionsCount === 0) return "Empty";
  if (offset >= buf.length) return null;

  const tag = buf[offset];
  return ACTION_TAG_TO_NAME[tag] ?? `Unknown(${tag})`;
}

/**
 * Inner: try to read a DelegateAction starting at `startOffset`, return the
 * trailing public_key as "ed25519:<base58>" / "secp256k1:<base58>", or null
 * if the byte stream doesn't parse as a valid DelegateAction.
 */
function tryDecodeDelegateAction(buf: Uint8Array, startOffset: number): string | null {
  let offset = startOffset;

  offset = skipLengthPrefixed(buf, offset); // sender_id
  if (offset < 0) return null;
  offset = skipLengthPrefixed(buf, offset); // receiver_id
  if (offset < 0) return null;

  const actionsCount = readU32LE(buf, offset);
  if (actionsCount === null) return null;
  offset += 4;
  for (let i = 0; i < actionsCount; i++) {
    offset = skipAction(buf, offset);
    if (offset < 0) return null;
  }

  // nonce (u64) + max_block_height (u64) = 16 bytes
  offset += 16;
  if (offset + 1 > buf.length) return null;

  const variant = buf[offset];
  offset += 1;
  const keyLen = variant === 0 ? 32 : variant === 1 ? 64 : -1;
  if (keyLen < 0) return null;
  if (offset + keyLen > buf.length) return null;

  const keyBytes = buf.slice(offset, offset + keyLen);
  const prefix = variant === 0 ? "ed25519:" : "secp256k1:";
  return prefix + base58Encode(keyBytes);
}

/**
 * Decode the trailing public_key from a sign_payload.
 *
 * Sign payloads come in two encodings depending on SDK / wallet version:
 *
 *   1. NEP-366 SignableMessage: 4-byte discriminant prefix + DelegateAction
 *   2. Raw DelegateAction with no prefix
 *
 * The official relayer's deserialization tries both (apps/relayer/src/modules/
 * relayer/relayer.service.ts:74-90 in the FastAuth monorepo). We mirror that:
 * try with the discriminant first, fall back to no prefix on failure. Returns
 * null if neither shape parses.
 */
export function decodeSignDelegatePublicKey(
  payload: number[] | Uint8Array | null | undefined,
): string | null {
  if (!payload) return null;

  const buf = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (buf.length < 16) return null;

  // Variant 1: starts with NEP-366 discriminant (4 bytes), then DelegateAction.
  const discriminant = readU32LE(buf, 0);
  if (discriminant === NEP_366_DELEGATE_DISCRIMINANT) {
    const decoded = tryDecodeDelegateAction(buf, 4);
    if (decoded) return decoded;
    // Fall through: discriminant matched but parse failed — try unprefixed.
  }

  // Variant 2: bare DelegateAction with no discriminant prefix.
  return tryDecodeDelegateAction(buf, 0);
}
