import { afterAll, describe, expect, it } from "vitest";
import { MemoryBus } from "../src/realtime/bus";
import { ChatService, MemoryChatStore } from "../src/chat/service";
import { cleanChat } from "../src/chat/filter";
import { AdminService } from "../src/admin/service";
import { ProgressService } from "../src/progress/service";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

describe("chat filter", () => {
  it("removes links, invisible characters and masks abuse", () => {
    expect(cleanChat("  hi‮ there \u0000 ")).toBe("hi there");
    expect(cleanChat("free chips at https://evil.example/x")).toBe("free chips at [link removed]");
    expect(cleanChat("go to scam.xyz now")).toBe("go to [link removed] now");
    expect(cleanChat("what the fuck")).toBe("what the f***");
    expect(cleanChat("classic")).toBe("classic");
    expect(cleanChat("a".repeat(500))).toHaveLength(200);
  });
});

describe("ChatService", () => {
  it("broadcasts to the room, keeps 50, and enforces guest/mute/rate rules", async () => {
    const bus = new MemoryBus();
    let t = 0;
    const chat = new ChatService(db, new MemoryChatStore(() => t), bus);
    const seen: unknown[] = [];
    bus.subscribe((m) => seen.push(m));
    const id = await createUser(db);
    const u = { id, name: "Ana", email: "", isAnonymous: false };

    const m = await chat.post(u, "crash", "hello");
    expect(seen).toEqual([{ kind: "room", room: "crash", message: { type: "chat", message: m } }]);
    await expect(chat.post(u, "crash", "again")).rejects.toMatchObject({ code: "SLOW_DOWN" });
    for (let i = 0; i < 60; i++) {
      t += 20_000;
      await chat.post(u, "crash", `m${i}`);
    }
    const h = await chat.history(u, "crash");
    expect(h.messages).toHaveLength(50);
    expect(h.messages.at(-1)!.text).toBe("m59");
    expect(h.canPost).toBe(true);

    const guest = { id: await createUser(db, { anonymous: true }), name: "G", email: "", isAnonymous: true };
    expect((await chat.history(guest, "crash")).reason).toBe("guest");
    await expect(chat.post(guest, "crash", "hi")).rejects.toMatchObject({ code: "SIGN_UP_REQUIRED" });

    const wallet = new WalletService(db);
    await new AdminService(db, wallet, new ProgressService(db, wallet)).setChatMuted(id, true);
    t += 20_000;
    await expect(chat.post(u, "crash", "hi")).rejects.toMatchObject({ code: "CHAT_MUTED" });
    expect((await chat.history(u, "crash")).reason).toBe("muted");
  });
});
