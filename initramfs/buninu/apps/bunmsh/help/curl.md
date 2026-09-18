## curl

Transfer a URL over HTTP or HTTPS, built on Bun's own `fetch`.

This is a **fallback builtin**: a real `curl` found on `PATH` always wins, so
scripts keep the system binary where there is one and still run on a device
that has none. `builtin curl` selects this implementation explicitly.

### Usage

```sh
curl [OPTIONS] URL...
```

A URL with no scheme gets one: `http://` by default, `https://` when the port
is `443`, or whatever `--proto-default` says. So `curl localhost:8080` and
`curl example.com/page` work the way they do with the real curl. Only `http`
and `https` are supported; anything else fails with exit code `1`.

### Options and forms

#### Output and files

- `-o, --output FILE`: Write the body to `FILE` instead of stdout. `-o -`
  means stdout. Repeat it to pair one target with each URL, in order.
- `-O, --remote-name`: Save under the filename from the URL path.
- `--remote-name-all`: Treat every URL as if it had its own `-O`.
- `-J, --remote-header-name`: With `-O`, prefer the name in the
  `Content-Disposition` header.
- `--output-dir DIR`: Write `-o`/`-O` files under `DIR`.
- `--create-dirs`: Create missing parent directories for the output file.
- `-a, --append`: Append to the output file instead of truncating it.
- `-C, --continue-at OFFSET|-`: Resume a partial download. `-` sizes the
  existing file and asks for the rest with a `Range` header; the file is
  appended to when the server answers `206`, and rewritten when it answers
  `200` and ignored the range. A `416` answer means the local file is already
  complete: nothing is written and the exit status is `0`.
- `-D, --dump-header FILE`: Write the response headers to `FILE` (`-` for
  stdout).
- `-i, --include`: Print the response headers before the body. With `-L`,
  every hop's headers are printed, as the real curl does.
- `-I, --head`: Send `HEAD` and print the response headers.
- `-w, --write-out FORMAT`: Print `FORMAT` after the transfer, with
  `%{variable}` substitutions and `\n`, `\t`, `\r` escapes. `@FILE` (or `@-`)
  reads the format from a file. Supported variables: `url`, `url_effective`,
  `method`, `scheme`, `http_code`, `response_code`, `http_version`,
  `num_redirects`, `num_headers`, `redirect_url`, `size_download`,
  `size_upload`, `size_header`, `size_request`, `speed_download`,
  `speed_upload`, `content_type`, `filename_effective`, `remote_ip`,
  `remote_port`, `ssl_verify_result`, `exitcode`, `errormsg`, `time_total`,
  `time_namelookup`, `time_connect`, `time_appconnect`, `time_pretransfer`,
  `time_starttransfer`, `time_redirect`, `header_json`, `json`, `stdout`,
  `stderr`.

#### Request shaping

- `-X, --request METHOD`: Set the request method.
- `-H, --header 'Name: value'`: Add or replace a header. `'Name;'` sends an
  empty value; `'Name:'` removes a header that would otherwise be sent.
- `-d, --data DATA`, `--data-ascii DATA`: `POST` body; `@file` reads a file
  (newlines stripped) and `@-` reads stdin. Repeats join with `&`.
- `--data-raw DATA`: Same, but `@` has no special meaning.
- `--data-binary DATA`: Same, but a `@file` is sent byte for byte.
- `--data-urlencode DATA`: Percent-encode before sending. Accepts `content`,
  `=content`, `name=content`, `@file`, and `name@file`.
- `--json DATA`: `--data-binary` plus `Content-Type: application/json` and
  `Accept: application/json`. `@file` and `@-` work here too.
- `-G, --get`: Move the data onto the query string and send `GET`.
- `-F, --form 'name=value'`, `--form-string`: `multipart/form-data`. `@file`
  attaches a file, `<file` sends its contents as the field value, and
  `;type=` / `;filename=` set the part's type and name.
- `-T, --upload-file FILE`: `PUT` the file (`-` reads stdin).
- `-u, --user USER[:PASSWORD]`: HTTP basic authentication.
- `--oauth2-bearer TOKEN`: Send `Authorization: Bearer TOKEN`.
- `-A, --user-agent NAME`: Override the default `curl/8.14.1`.
- `-e, --referer URL`: Send a `Referer` header; a trailing `;auto` is ignored.
- `-b, --cookie 'k=v'`: Send a `Cookie` header.
- `-r, --range RANGE`: Send `Range: bytes=RANGE`.
- `--compressed`: Ask for and transparently decode a compressed response.
  Without it, no `Accept-Encoding` is negotiated, matching curl's default.
- `-x, --proxy URL`: Send the request through a proxy.

#### Redirects, failure, and timing

- `-L, --location`: Follow redirects. `301`/`302`/`303` turn a `POST` into a
  `GET`; `307`/`308` keep the method and body. `Authorization` is dropped when
  the host changes, unless `--location-trusted` is given.
- `--max-redirs N`: Cap the redirect chain (default 50, `-1` for unlimited).
  Exceeding it fails with exit code `47`.
- `-f, --fail`: No body output on HTTP errors; exit `22` instead.
- `--fail-with-body`: Print the body and still exit `22`.
- `-k, --insecure`: Do not verify the server certificate.
- `-m, --max-time SECONDS`, `--connect-timeout SECONDS`: Abort a slow
  transfer with exit code `28`.
- `--retry N`, `--retry-delay SECONDS`, `--retry-all-errors`,
  `--retry-connrefused`: Retry connection failures, timeouts, and the
  transient statuses `408`, `429`, `500`, `502`, `503`, and `504`.

#### Reporting

- `-s, --silent`: No progress meter and no error messages.
- `-S, --show-error`: Keep error messages while `-s` is in effect.
- `-#, --progress-bar`: A single-bar progress display instead of the meter.
- `--no-progress-meter`: Keep errors, drop the meter.
- `-v, --verbose`: Trace the request and response headers on stderr.
- `-V, --version`: Print the version banner.

Like the real curl, the progress meter is shown only when the body is *not*
being painted on the terminal — a `-o`/`-O` download or a redirected stdout
gets a meter, `curl URL` at a prompt does not.

#### Accepted and ignored

These are parsed so a script does not die on them, and then have no effect,
because `fetch` either handles that part itself or does not expose it:
`--cacert`, `--capath`, `-E/--cert`, `--key`, `--interface`, `--limit-rate`,
`--resolve`, `--connect-to`, `--unix-socket`, `--noproxy`, `--proxy-user`,
`--proxy-header`, `-n/--netrc`, `-c/--cookie-jar`, `-z/--time-cond`,
`-R/--remote-time`, `-N/--no-buffer` (output is always streamed anyway),
`-g/--globoff` (URL globbing is not performed, so `{}` and `[]` are already
literal), `-q/--disable`, `-4`, `-6`, `--http1.0`, `--http1.1`, `--http2`,
`--http3`, `--tlsv1.x`, `--tcp-nodelay`, `--keepalive`, `--anyauth`,
`--basic`, `--digest`, `-Z/--parallel`, `--max-filesize`, `--path-as-is`.

### Where it differs from the system curl

- `fetch` reports header names in lower case, so `-i`, `-I`, `-D`, and `-v`
  rebuild the conventional capitalisation (`Content-Type`, `ETag`) and list
  the headers in `fetch`'s order rather than the server's wire order.
- The negotiated HTTP version is not exposed, so status lines are written as
  `HTTP/1.1`.
- Bun adds a `Connection: keep-alive` request header of its own.
- The progress meter is a look-alike: same columns, not the same arithmetic.
- URL globbing (`{a,b}`, `[1-10]`) is not implemented.
- `fetch` forbids a body on `GET` and `HEAD`, so `-X GET -d ...` sends the
  request without the data; use `-G` to put it on the query string instead.

### Exit status

`0` on success, `1` unsupported protocol, `2` bad usage, `3` malformed URL,
`6` host not resolved, `7` connection failed, `22` HTTP error with `-f`,
`23` write error, `26` local file could not be read, `28` timeout,
`47` too many redirects, `56` connection reset, `60` certificate problem.

### Example

```sh
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' example.com
```

Output:

```text
200 text/html
```

The invocations a package script tends to use:

```sh
curl -kLO https://example.com/pkg.tar.gz
curl -C - -kLO https://example.com/pkg.tar.gz
curl -fsSL https://example.com/install.sh | sh
curl -#k https://example.com/pkg.tar.gz.sha256
curl -kfsS https://example.com/probe >/dev/null 2>/dev/null
curl localhost:8080
```

Calling a JSON API — enough for the OpenAI chat completions endpoint:

```sh
curl -sS https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
```

`--json` shortens that, and `-N` streaming responses arrive chunk by chunk:

```sh
curl -sN --json @request.json https://api.openai.com/v1/chat/completions
```
