import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("auth lifecycle does not touch holdings", () => {
  it("keeps holdings access out of the login modules", () => {
    const files = [
      "apps/web/src/lib/authClient.ts",
      "apps/web/src/lib/authState.ts",
      "apps/web/src/lib/auth.tsx",
      "apps/web/src/components/AppHeader.tsx",
      "apps/web/src/components/AccountMenu.tsx",
      "apps/web/src/components/SessionBanner.tsx",
      "apps/web/src/pages/LoginPage.tsx",
      "workers/site/src/auth/routes.ts",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toMatch(/qk\.holdings|writeHoldings|readHoldings|localStorage/);
      expect(source).not.toContain("已退出");
      expect(source).not.toContain("登录同步即将推出");
    }
  });
});
