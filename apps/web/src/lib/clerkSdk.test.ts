import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { clerkFlowRedirects } from "./authState.js";

const require = createRequire(new URL("../../package.json", import.meta.url));

describe("installed Clerk React SDK", () => {
  it("forwards withSignUp and email-code verification through the SPA SignIn mount", () => {
    const pkgPath = require.resolve("@clerk/react/package.json");
    const root = dirname(pkgPath);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(pkg.version).toBe("6.18.9");
    const hooksName = readdirSync(join(root, "dist")).find((name) => name.startsWith("hooks-"));
    if (!hooksName) throw new Error("missing Clerk hooks bundle");
    const hooks = readFileSync(join(root, "dist", hooksName), "utf8");
    const signIn = hooks.slice(hooks.indexOf("const SignIn = withClerk"));
    expect(signIn).toContain("mount: clerk.mountSignIn");
    expect(signIn).toContain("props");
    const providerName = readdirSync(join(root, "dist")).find((name) =>
      name.startsWith("ClerkProvider-"),
    );
    if (!providerName) throw new Error("missing Clerk provider bundle");
    const provider = readFileSync(join(root, "dist", providerName), "utf8");
    expect(provider).toContain(
      'emailCode: this.wrapMethods(() => target().emailCode, ["sendCode", "verifyCode"])',
    );
    expect(provider).toContain('"sendEmailCode"');
    expect(provider).toContain('"verifyEmailCode"');
    const button = readFileSync(join(root, "dist/index.mjs"), "utf8");
    expect(button).toContain("withSignUp");
    expect(button).toContain("signUpForceRedirectUrl");
    const redirects = clerkFlowRedirects("/portfolio?add=1");
    expect(redirects.forceRedirectUrl).toBe("/portfolio?add=1");
    expect(redirects.signUpForceRedirectUrl).toBe("/portfolio?add=1");
    expect(redirects.signUpFallbackRedirectUrl).toBe("/portfolio?add=1");
    expect(new URL(redirects.signUpUrl, "https://quki.cc").origin).toBe("https://quki.cc");
    expect(new URL(redirects.signUpUrl, "https://quki.cc").pathname).toBe("/login");
  });
});
