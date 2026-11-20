// Chat images (#968 s2): POST /api/sessions/:id/message takes images [{ mediaType, data }] for Claude sessions;
// the CLI gets content blocks, the transcript keeps only "[이미지 N장]".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub, userContent } from "../../server/dispatch/hub.js";
import { checkImages, IMAGE_LIMITS, messageBody, routeTable } from "../../server/dispatch/routes.js";

const png = { mediaType: "image/png", data: "iVBORw0KGgo=" };

test("messageBody: text alone as before; images make empty text fine", () => {
  assert.deepEqual(messageBody({ text: " hi " }), { text: "hi", images: null });
  assert.throws(() => messageBody({ text: " " }), /text가 비어 있어요/);
  assert.deepEqual(messageBody({ text: "", images: [png] }), { text: "", images: [png] });
  assert.deepEqual(messageBody({ text: "look", images: [] }), { text: "look", images: null });
  assert.throws(() => messageBody({ text: "", images: [] }), /text가 비어 있어요/);
});

test("checkImages: count, type, size and base64 shape are enforced", () => {
  assert.throws(() => checkImages("x"), e => e.status === 400);
  assert.throws(() => checkImages(Array(IMAGE_LIMITS.max + 1).fill(png)), /4장까지/);
  assert.throws(() => checkImages([{ mediaType: "image/svg+xml", data: "AAAA" }]), /PNG, JPEG, GIF, WebP/);
  assert.throws(() => checkImages([{ mediaType: "image/png", data: "not base64!" }]), /올바르지 않아요/);
  assert.throws(() => checkImages([{ mediaType: "image/png", data: "A".repeat(IMAGE_LIMITS.base64Bytes + 4) }]), /5MB/);
  // Extra fields are dropped.
  assert.deepEqual(checkImages([{ ...png, name: "a.png" }]), [png]);
  for (const t of IMAGE_LIMITS.types) assert.equal(checkImages([{ mediaType: t, data: "AAAA" }])[0].mediaType, t);
});

test("message route passes images to hub.send and keeps text-only calls unchanged", async () => {
  const calls = [];
  const hub = { send: (...a) => calls.push(a) };
  const table = routeTable({ root: "/x", store: {}, hub, models: [], broadcast: () => {} });
  const entry = table.find(([m, re]) => m === "POST" && re.test("/api/sessions/a1/message"));
  assert.ok(entry[3].maxBody >= IMAGE_LIMITS.max * IMAGE_LIMITS.base64Bytes, "the route reads a body big enough for 4 images");
  await entry[2](["a1"], { text: "hi" });
  await entry[2](["a1"], { images: [png] });
  assert.deepEqual(calls, [["a1", "hi", undefined], ["a1", "", { images: [png] }]]);
});

test("userContent: plain text without images, image blocks then text with them", () => {
  assert.equal(userContent("hi", null), "hi");
  assert.equal(userContent("hi", []), "hi");
  assert.deepEqual(userContent("hi", [png]), [
    { type: "image", source: { type: "base64", media_type: "image/png", data: png.data } },
    { type: "text", text: "hi" },
  ]);
  assert.deepEqual(userContent("", [png]).map(b => b.type), ["image"]);
});

// A Hub stand-in with what send() and deliver() reach for on a running Claude session.
function fakeHub(s) {
  const lines = [];
  const proc = { stdin: { write: l => lines.push(JSON.parse(l)) } };
  const r = { proc, transcript: [], seq: 0, perms: new Map() };
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map([[s.id, r]]), store: { data: { sessions: { [s.id]: s }, settings: { team: {} }, guard: {} }, save() {} },
    emit() {}, runBlock: () => null, replaceDue: () => false, shouldRotate: () => false, cancelAutoRemove() {}, touch() {},
  });
  Object.defineProperty(hub, "paused", { get: () => false });
  return { hub, lines, r };
}

test("hub.send: a running Claude session gets content blocks; the transcript gets only the count", () => {
  const s = { id: "a", name: "Mina", provider: "claude", status: "running" };
  const { hub, lines, r } = fakeHub(s);
  hub.send("a", "what is this", { images: [png, png] });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].message.content.map(b => b.type), ["image", "image", "text"]);
  assert.equal(r.transcript.at(-1).text, "what is this\n[이미지 2장]");
  assert.doesNotMatch(JSON.stringify(r.transcript), new RegExp(png.data.replace(/[+/=]/g, ".")));
  hub.send("a", "plain");
  assert.equal(lines[1].message.content, "plain", "text-only stays a string");
});

test("hub.send: images to a non-Claude session are refused", () => {
  const s = { id: "a", name: "Mina", provider: "openai", status: "idle" };
  const { hub, lines } = fakeHub(s);
  assert.throws(() => hub.send("a", "x", { images: [png] }), e => e.status === 400);
  assert.equal(lines.length, 0);
});
