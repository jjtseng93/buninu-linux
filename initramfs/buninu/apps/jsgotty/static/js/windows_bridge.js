(function () {
  const MSG_WINDOWS_BRIDGE = "9";
  const CHUNK_SIZE = 48 * 1024;
  const downloads = new Map();

  function encodeJson(message) {
    return JSON.stringify(message);
  }

  function getWsSend() {
    return WebSocket.prototype.send;
  }

  function sendBridgeMessage(socket, message) {
    getWsSend().call(socket, MSG_WINDOWS_BRIDGE + encodeJson(message));
  }

  function saveBlob(blob, name) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = name || "download.bin";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function pickFiles() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.style.display = "none";
      input.addEventListener("change", () => {
        resolve(Array.from(input.files || []));
        input.remove();
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function handleUploadRequest(socket, message) {
    const files = await pickFiles();
    if (files.length === 0) {
      sendBridgeMessage(socket, {
        op: "upload_cancel",
        requestId: message.requestId
      });
      return;
    }

    for (const file of files) {
      sendBridgeMessage(socket, {
        op: "upload_start",
        requestId: message.requestId,
        name: file.name,
        size: file.size,
        mtime: file.lastModified
      });

      const bytes = new Uint8Array(await file.arrayBuffer());
      for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
        let text = "";
        for (let index = 0; index < chunk.length; index += 1) {
          text += String.fromCharCode(chunk[index]);
        }
        sendBridgeMessage(socket, {
          op: "upload_chunk",
          requestId: message.requestId,
          name: file.name,
          data: btoa(text)
        });
      }

      sendBridgeMessage(socket, {
        op: "upload_end",
        requestId: message.requestId,
        name: file.name
      });
    }

    sendBridgeMessage(socket, {
      op: "upload_finish",
      requestId: message.requestId
    });
  }

  function handleDownloadMessage(message) {
    const key = `${message.requestId}:${message.name}`;
    if (message.op === "download_start") {
      downloads.set(key, {
        name: message.name,
        chunks: []
      });
      return;
    }

    if (message.op === "download_chunk") {
      const entry = downloads.get(key);
      if (!entry) {
        return;
      }
      entry.chunks.push(message.data);
      return;
    }

    if (message.op === "download_end") {
      const entry = downloads.get(key);
      if (!entry) {
        return;
      }
      downloads.delete(key);
      const bytes = entry.chunks.map((base64) => {
        const binary = atob(base64);
        const chunk = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          chunk[i] = binary.charCodeAt(i);
        }
        return chunk;
      });
      saveBlob(new Blob(bytes), entry.name);
    }
  }

  function handleBridgeMessage(socket, payload) {
    const message = JSON.parse(payload);
    if (message.op === "upload_request") {
      void handleUploadRequest(socket, message);
      return true;
    }
    if (message.op && message.op.startsWith("download_")) {
      handleDownloadMessage(message);
      return true;
    }
    return false;
  }

  const nativeAddEventListener = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, options) {
    if (type !== "message") {
      return nativeAddEventListener.call(this, type, listener, options);
    }

    const wrapped = function (event) {
      if (typeof event.data === "string" && event.data[0] === MSG_WINDOWS_BRIDGE) {
        if (handleBridgeMessage(this, event.data.slice(1))) {
          return;
        }
      }
      return listener.call(this, event);
    };
    listener.__windowsBridgeWrapped = wrapped;
    return nativeAddEventListener.call(this, type, wrapped, options);
  };

  const nativeRemoveEventListener = WebSocket.prototype.removeEventListener;
  WebSocket.prototype.removeEventListener = function (type, listener, options) {
    if (type === "message" && listener && listener.__windowsBridgeWrapped) {
      return nativeRemoveEventListener.call(this, type, listener.__windowsBridgeWrapped, options);
    }
    return nativeRemoveEventListener.call(this, type, listener, options);
  };

  const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage");
  Object.defineProperty(WebSocket.prototype, "onmessage", {
    configurable: true,
    enumerable: descriptor ? descriptor.enumerable : true,
    get() {
      return this.__windowsBridgeOnMessage || null;
    },
    set(handler) {
      this.__windowsBridgeOnMessage = handler;
      if (!descriptor || !descriptor.set) {
        return;
      }
      if (typeof handler !== "function") {
        descriptor.set.call(this, handler);
        return;
      }
      descriptor.set.call(this, function (event) {
        if (typeof event.data === "string" && event.data[0] === MSG_WINDOWS_BRIDGE) {
          if (handleBridgeMessage(this, event.data.slice(1))) {
            return;
          }
        }
        return handler.call(this, event);
      });
    }
  });
})();
