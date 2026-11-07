/**
 * Facilitator capability resolution. An HTTP 200 from /supported is not enough:
 * we require an x402 v2 `exact` kind on the exact network, a valid fee payer, and that
 * fee payer listed among the facilitator's own Hedera signers.
 */
import type { FacilitatorClient } from "@x402/core/server";
import { CapabilityError } from "./errors.ts";
import { ENTITY_RE } from "./canonical.ts";

export type HederaNetwork = "hedera:testnet" | "hedera:mainnet";

export interface HederaCapability {
  network: HederaNetwork;
  scheme: "exact";
  x402Version: 2;
  feePayer: string;
  signers: string[];
}

export async function resolveHederaCapability(
  facilitator: Pick<FacilitatorClient, "getSupported">,
  network: HederaNetwork,
): Promise<HederaCapability> {
  const supported = await facilitator.getSupported();
  const kind = supported.kinds.find((k) => k.x402Version === 2 && k.scheme === "exact" && k.network === network);
  if (!kind) {
    const seen = supported.kinds.map((k) => `v${k.x402Version}/${k.scheme}/${k.network}`).join(", ");
    throw new CapabilityError(`facilitator does not advertise v2 exact on ${network} (advertises: ${seen || "nothing"})`);
  }
  const feePayer = kind.extra?.feePayer;
  if (typeof feePayer !== "string" || !ENTITY_RE.test(feePayer)) {
    throw new CapabilityError(`facilitator ${network} kind has no valid extra.feePayer`);
  }
  const signers = supported.signers?.["hedera:*"] ?? supported.signers?.[network] ?? [];
  if (!signers.includes(feePayer)) {
    throw new CapabilityError(`advertised feePayer ${feePayer} is not among facilitator hedera signers [${signers.join(", ")}]`);
  }
  return { network, scheme: "exact", x402Version: 2, feePayer, signers };
}
