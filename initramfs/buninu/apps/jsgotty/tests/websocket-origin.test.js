const assert = require("node:assert/strict");
const test = require("node:test");
const { webSocketOriginAllowed } = require("../gotty.js");

function request(host, origin) {
  return {
    headers: {
      host,
      ...(origin === undefined ? {} : { origin }),
    },
  };
}

test("WebSocket permits clients without Origin", () => {
  assert.equal(webSocketOriginAllowed(request("127.0.0.1:8080")), true);
});

test("WebSocket permits same-origin browsers", () => {
  assert.equal(
    webSocketOriginAllowed(request("127.0.0.1:8080", "http://127.0.0.1:8080")),
    true,
  );
  assert.equal(
    webSocketOriginAllowed(request("Example.COM:8080", "https://example.com:8080")),
    true,
  );
});

test("WebSocket rejects cross-origin and malformed browser origins", () => {
  assert.equal(
    webSocketOriginAllowed(request("127.0.0.1:8080", "https://attacker.example")),
    false,
  );
  assert.equal(webSocketOriginAllowed(request("127.0.0.1:8080", "null")), false);
  assert.equal(webSocketOriginAllowed(request("127.0.0.1:8080", "not a URL")), false);
});

test("--ws-origin regex replaces the same-origin default", () => {
  const matcher = /^https:\/\/trusted\.example$/;
  assert.equal(
    webSocketOriginAllowed(
      request("127.0.0.1:8080", "https://trusted.example"),
      matcher,
    ),
    true,
  );
  assert.equal(
    webSocketOriginAllowed(
      request("127.0.0.1:8080", "http://127.0.0.1:8080"),
      matcher,
    ),
    false,
  );
});
