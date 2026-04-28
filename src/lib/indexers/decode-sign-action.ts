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
 *        nonce: u64
 *        max_block_height: u64
 *        public_key: PublicKey
 *
 * For classification we only need the first action's enum tag — that's
 * enough to label the sign event as AddKey / FunctionCall / Transfer / etc.
 *
 * The action enum (from near-primitives):
 *   0 = CreateAccount
 *   1 = DeployContract
 *   2 = FunctionCall
 *   3 = Transfer
 *   4 = Stake
 *   5 = AddKey
 *   6 = DeleteKey
 *   7 = DeleteAccount
 *   (8 = Delegate, but a Delegate inside a Delegate isn't expected here)
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

function readU32LE(buf: Uint8Array, offset: number): number | null {
  if (offset + 4 > buf.length) return null;
  // Use unsigned right shift to coerce to a non-negative 32-bit integer in case
  // the high bit is set (e.g. for the NEP-366 discriminant 0x4000_016E).
  return (
    ((buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>>
      0)
  );
}

/**
 * Decode the first action type from a sign_payload byte sequence. Returns:
 *   - "AddKey" / "FunctionCall" / etc. if NEP-366 DelegateAction with ≥1 action
 *   - "Empty" if the DelegateAction has no actions
 *   - "Raw" if the discriminant doesn't match NEP-366 (other signable types)
 *   - null if the payload is too short or malformed
 */
export function decodeSignActionType(payload: number[] | Uint8Array | null | undefined): string | null {
  if (!payload) return null;

  const buf = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (buf.length < 16) return null;

  const discriminant = readU32LE(buf, 0);
  if (discriminant !== NEP_366_DELEGATE_DISCRIMINANT) {
    return "Raw";
  }

  let offset = 4;

  const senderLen = readU32LE(buf, offset);
  if (senderLen === null) return null;
  offset += 4 + senderLen;

  const receiverLen = readU32LE(buf, offset);
  if (receiverLen === null) return null;
  offset += 4 + receiverLen;

  const actionsCount = readU32LE(buf, offset);
  if (actionsCount === null) return null;
  offset += 4;

  if (actionsCount === 0) return "Empty";
  if (offset >= buf.length) return null;

  const tag = buf[offset];
  return ACTION_TAG_TO_NAME[tag] ?? `Unknown(${tag})`;
}
