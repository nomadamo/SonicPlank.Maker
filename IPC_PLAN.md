# Hardened IPC Handshake — Implementation Plan

## Architecture

```
stdin  → Auth (once at spawn), then Commands + Overlay  (JSON, Electron → Core)
stdout ← Ready (once),        then Events + Status      (JSON, Core → Electron)
named pipe (negotiated, randomized) ← Video frames only (binary, Core → Electron)
```

## Handshake Sequence

```
Electron spawns sonicplank-core
  │
  ├─ stdin ──► {"type":"auth","token":"<32-byte base64url>","pipe_id":"<16-byte hex>"}
  │
  │   Core reads Auth, validates, constructs pipe name:
  │     \\.\pipe\sonicplank-<pipe_id>
  │   Core creates pipe with first_pipe_instance(true)   ← squatting race eliminated
  │
  ├─ stdout ◄─ {"type":"ready","version":1,"pid":12345,"pipe":"\\.\pipe\sonicplank-<pipe_id>"}
  │
  ├─ Electron connects to negotiated pipe name
  │
  ├─ pipe ──► {"type":"hello","token":"<same token>"}    ← hijack verification
  │
  │   Core verifies token (constant-time compare)
  │   Mismatch → close connection immediately
  │
  └─ pipe established for binary frame data (Phase 1+)
     stdin/stdout remain the control plane for lifetime of process
```

---

## Block 1 — IPC Protocol Layer  (`src-native/crates/ipc/src/lib.rs`)

- [ ] Add `Auth { token: String, pipe_id: String }` variant to `Command` enum
- [ ] Add `Hello { token: String }` variant to `Command` enum
- [ ] Update `Event::Ready` — add `pipe: String` field
- [ ] Add `FrameType` enum: `VideoPreview = 1` (extensible for future frame types)
- [ ] Add `FrameHeader` struct: `{ frame_type: FrameType, payload_len: u32 }` (8 bytes LE)
- [ ] Add `encode_frame_header(header: &FrameHeader) -> [u8; 8]`
- [ ] Add `decode_frame_header(buf: &[u8; 8]) -> Result<FrameHeader, FrameError>`
- [ ] Update `ready_wire_format` test — now includes `pipe` field
- [ ] Add tests: `auth_round_trips`, `hello_round_trips`, `frame_header_encode_decode`
- [ ] Run `cargo test -p sonicplank-ipc` — all green

---

## Block 2 — Core Process Rewire  (`src-native/crates/core/src/main.rs`)

- [ ] On startup: read one line from stdin with 5 s timeout
- [ ] Decode line as `Command::Auth`; any other variant or parse error → exit(1) with message
- [ ] Store token (for Hello verification later)
- [ ] Construct pipe name: `format!(r"\\.\pipe\sonicplank-{}", pipe_id)`
- [ ] Create data pipe with `first_pipe_instance(true)` BEFORE emitting `Ready`
- [ ] Emit `Ready { version, pid, pipe: pipe_name.clone() }` on stdout
- [ ] Replace `run_ipc(named_pipe_server)` with `run_stdin_commands(stdin)`:
      - BufReader on tokio stdin
      - Dispatch: `Ping → stdout Pong`, `Shutdown → break`, unknown → stdout Error
- [ ] Accept data pipe connection in a separate `tokio::spawn` task (`run_data_pipe`)
- [ ] In `run_data_pipe`: read first message, decode as `Command::Hello`
- [ ] Constant-time token compare (`subtle::ConstantTimeEq` or manual XOR-fold)
      - Mismatch → close pipe, log warning
      - Match → log "data pipe authenticated", hold for Phase 1 frame writes
- [ ] Add `subtle = "2"` to `sonicplank-core` dev/workspace deps if using that crate
- [ ] Update `app.on("before-quit")` path: Shutdown still sent via stdin
- [ ] Add test: `auth_timeout_exits` (stdin silent for > timeout → process exits)
- [ ] Run `cargo test` — all green
- [ ] Run `cargo build` — clean

---

## Block 3 — Electron Wiring  (`src/main.ts`)

- [ ] At spawn time, generate:
      ```ts
      const token  = crypto.randomBytes(32).toString("base64url");
      const pipeId = crypto.randomBytes(16).toString("hex");
      ```
- [ ] Immediately after spawn, write Auth frame to stdin:
      ```ts
      coreProcess.stdin?.write(JSON.stringify({ type: "auth", token, pipe_id: pipeId }) + "\n");
      ```
- [ ] Update `waitForCoreReady()`:
      - Extract `pipe` field from Ready event
      - Store as `negotiatedPipeName` (module-level, replaces `CORE_PIPE_NAME`)
      - Validate field is present; reject if missing
- [ ] Update `connectCorePipe()`:
      - Connect to `negotiatedPipeName` (not hardcoded constant)
      - First write after connect: `JSON.stringify({ type: "hello", token }) + "\n"`
- [ ] Update `sendCoreCommand()`:
      - Write to `coreProcess.stdin` (not `coreSocket`)
      - `coreSocket` is now read-only (frame data in, no commands out)
- [ ] Update `stopCore()`:
      - Shutdown command → `coreProcess.stdin?.write(...)` then `coreProcess.stdin?.end()`
      - Close `coreSocket` after Shutdown is sent
- [ ] Remove hardcoded `CORE_PIPE_NAME` constant
- [ ] Token and pipeId are local to the spawn closure — not stored beyond connection setup
- [ ] TypeScript build clean (no new lint errors)

---

## Block 4 — Verification

- [ ] `cargo build --manifest-path src-native/Cargo.toml` — clean
- [ ] `cargo test --manifest-path src-native/Cargo.toml` — all green
- [ ] `npm start` — observe in console:
      - `[Core] ready — version=1 pid=XXXXX`
      - `[Core] IPC pipe connected`
      - `[Core] data pipe authenticated`
- [ ] Negative test: temporarily send wrong token in Hello, verify core closes pipe + logs warning
- [ ] Squatting test: pre-create `\\.\pipe\sonicplank-<pipeId>` before Core; verify Core exits cleanly

---

## Notes

- `first_pipe_instance(true)` eliminates the squatting race: pipe creation fails if the name is
  already taken, so Core will exit(1) rather than silently bind the wrong pipe.
- Token and pipe name travel exclusively over anonymous pipes (stdin/stdout) owned by Electron —
  they are never in a named, discoverable OS object before the data pipe is created.
- Phase 1 (video frames) connects to the already-established data pipe socket in `run_data_pipe`.
  No new handshake needed — the pipe is authenticated and open, just waiting for frame writes.
- `subtle` crate for constant-time compare is optional at this stage (local threat model doesn't
  include timing attacks), but noted for future hardening if the core ever accepts network connections.

---

## Status

- [x] Phase 0 complete — basic named pipe IPC, Electron spawns + connects, Ping/Pong works
- [x] Block 1 complete — Auth/Hello commands, Ready pipe field, FrameHeader + 20 tests green
- [x] Block 2 complete — stdin command loop, Auth validation, data pipe, Hello token verify + 8 tests green
- [x] Block 3 complete — Electron generates token/pipeId, writes Auth, connects negotiated pipe, sends Hello
- [x] Block 4 complete — 28/28 tests, zero warnings, live smoke test confirmed full handshake sequence
