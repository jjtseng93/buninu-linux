const rerenderQueues = new WeakMap();

function settleWaiters(waiters, method, value) {
  for (const waiter of waiters) waiter[method](value);
}

async function drainRerenders(target, state, firstRequest) {
  try {
    let request = firstRequest;
    while (request) {
      try {
        const value = await request.operation();
        settleWaiters(request.waiters, "resolve", value);
      } catch (error) {
        settleWaiters(request.waiters, "reject", error);
      }

      request = state.pending;
      state.pending = null;
    }
  } finally {
    rerenderQueues.delete(target);
    state.resolveIdle();
  }
}

export function enqueueMdcuiRerender(target, operation) {
  if ((typeof target !== "object" && typeof target !== "function") || target === null)
    return Promise.reject(new TypeError("MDCUI rerender target must be an object"));
  if (typeof operation !== "function")
    return Promise.reject(new TypeError("MDCUI rerender operation must be a function"));

  let resolve;
  let reject;
  const result = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const waiter = { resolve, reject };
  const state = rerenderQueues.get(target);

  if (!state) {
    let resolveIdle;
    const idle = new Promise((done) => {
      resolveIdle = done;
    });
    const nextState = { idle, pending: null, resolveIdle };
    rerenderQueues.set(target, nextState);
    void Promise.resolve().then(() => drainRerenders(
      target,
      nextState,
      { operation, waiters: [waiter] },
    ));
  } else if (state.pending) {
    state.pending.operation = operation;
    state.pending.waiters.push(waiter);
  } else {
    state.pending = { operation, waiters: [waiter] };
  }

  return result;
}

export function waitForMdcuiRerenders(target) {
  return rerenderQueues.get(target)?.idle ?? Promise.resolve();
}
