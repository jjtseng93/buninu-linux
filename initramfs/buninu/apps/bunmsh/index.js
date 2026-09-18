#!/usr/bin/env bun
// This top-level entry exists because Bun's bin-link containment check uses openat2
// when a package bin target has a parent directory. Android blocks that syscall
// with SIGSYS on affected Bun versions, so a target such as ./src/main.js is
// installed without its bin link. A target at the package root avoids that
// containment path while keeping the real entry point in src/main.js.
import "./src/main.js";
