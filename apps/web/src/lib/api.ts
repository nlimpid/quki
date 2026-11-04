import type { RotationView } from "@quki/analytics";
import type { Overview } from "@quki/types";

export async function fetchOverview(code: string): Promise<Overview> {
  const response = await fetch(`/api/indices/${encodeURIComponent(code)}/overview`);
  const body = (await response.json().catch(() => null)) as
    | (Overview & { error?: string; message?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `行情加载失败（${response.status}）`);
  }
  if (!body || !body.instrument) throw new Error("行情加载失败");
  return body;
}

export async function fetchRotation(pairId: string): Promise<RotationView> {
  const response = await fetch(`/api/rotation/${encodeURIComponent(pairId)}`);
  const body = (await response.json().catch(() => null)) as
    | (RotationView & { error?: string; message?: string })
    | null;
  if (!response.ok || !body || !("latest" in body)) {
    throw new Error(body?.message || body?.error || `轮动数据加载失败（${response.status}）`);
  }
  return body;
}
