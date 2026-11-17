import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

/** Test helper. Signs a real RSA JWT. Not a Clerk account and not a mocked verify result. */

export type FixtureKey = {
  privateKey: KeyObject;
  jwks: { keys: Array<Record<string, string>> };
};

export function fixtureKey(kid = "fixture-key", alg: "RS256" | "RS384" | "RS512" = "RS256"): FixtureKey {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  jwk.kid = kid;
  jwk.alg = alg;
  jwk.use = "sig";
  return { privateKey, jwks: { keys: [jwk] } };
}

export function signSessionToken(
  privateKey: KeyObject,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "fixture-key", cat: "cl_B7d4PD111AAA" },
): string {
  const alg = String(header.alg);
  const hash = alg === "RS384" ? "RSA-SHA384" : alg === "RS512" ? "RSA-SHA512" : "RSA-SHA256";
  const signingInput = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
  const signature = createSign(hash).update(signingInput).sign(privateKey);
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

function b64(value: string): string {
  return Buffer.from(value).toString("base64url");
}
