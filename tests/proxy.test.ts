import assert from "node:assert/strict";
import test from "node:test";
import { isPublicPath } from "../src/proxy";

test("PWA installation assets are public to Android's WebAPK fetcher", () => {
  for (const pathname of [
    "/manifest.webmanifest",
    "/sw.js",
    "/favicon.ico",
    "/icon.png",
    "/apple-icon.png",
    "/icons/our-days-192.png",
    "/icons/our-days-512.png",
    "/icons/our-days-maskable-512.png",
  ]) {
    assert.equal(isPublicPath(pathname), true, `${pathname} should be public`);
  }
});

test("private rota pages are not made public with the PWA assets", () => {
  assert.equal(isPublicPath("/month"), false);
  assert.equal(isPublicPath("/settings"), false);
});
