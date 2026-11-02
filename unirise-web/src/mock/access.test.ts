import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { call, signInAs } from "@/test/session";

describe("who can see which person", () => {
  it("a researcher can open their own profile but not a colleague's", async () => {
    signInAs("researcher");
    await expect(call(() => api.researcher(1))).resolves.toMatchObject({ id: 1 });
    await expect(call(() => api.researcher(4))).rejects.toMatchObject({ status: 403 });
  });
  it("a HoD cannot open a person outside their department", async () => {
    signInAs("hod");
    await expect(call(() => api.researcher(7))).resolves.toMatchObject({ id: 7 });
    await expect(call(() => api.researcher(4))).rejects.toMatchObject({ status: 403 });
  });
  it("find-a-researcher does not return people outside the viewer's scope", async () => {
    signInAs("scholar");
    await expect(call(() => api.lookup("employee", "EMP1007"))).rejects.toMatchObject({ status: 404 });
  });
  it("the review badge counts only what the viewer can act on", async () => {
    signInAs("admin");
    const admin = (await api.summary()).pendingReview;
    signInAs("scholar");
    expect((await api.summary()).pendingReview).toBeLessThan(admin);
  });
});
