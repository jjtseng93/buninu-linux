(function () {
  const MSG_OUTPUT = "1";
  const MSG_KITTY = "7";
  const DEFAULT_TOUCH_SCROLL_THRESHOLD = 24;
  const overlay = document.getElementById("kitty-overlay");
  const terminal = document.getElementById("terminal");
  const KITTY_TRACE = Boolean(window.gotty_kitty_trace);
  const state = {
    cols: 80,
    rows: 24,
    placements: new Map(),
    scrollBound: false,
    renderBound: false,
    renderDisposables: [],
    relayoutFrame: 0,
    outputTail: "",
    recentCursorHome: false,
    recentClearLineCount: 0,
    touchBound: false,
    touchScroll: null,
    contextMenu: null,
    imageContextBound: false,
    socket: null,
    // False until the client has sent its first resize. Until then cols/rows
    // above are placeholders, not the PTY's real geometry.
    sizeFromClient: false
  };

  //  The PTY size only reaches us through the resize messages the client
  //  sends. A placement that arrives before the first of those would be laid
  //  out against 80x24 instead of the terminal the user is looking at, so
  //  borrow xterm's own geometry until the real size shows up.
  function syncViewerSize() {
    if (state.sizeFromClient) {
      return;
    }
    const xterm = terminal && terminal.__gottyXterm;
    if (!xterm) {
      return;
    }
    if (Number.isFinite(xterm.cols) && xterm.cols > 0) {
      state.cols = xterm.cols;
    }
    if (Number.isFinite(xterm.rows) && xterm.rows > 0) {
      state.rows = xterm.rows;
    }
  }

  function browserTerminalState() {
    const xterm = terminal && terminal.__gottyXterm;
    const active = xterm && xterm.buffer && xterm.buffer.active;
    if (!active) {
      return null;
    }
    const { screen, viewport } = xtermElements();
    const terminalRect = terminal.getBoundingClientRect();
    const screenRect = screen && screen.getBoundingClientRect();
    const viewportRect = viewport && viewport.getBoundingClientRect();
    return {
      type: active.type || null,
      baseY: active.baseY,
      viewportY: active.viewportY,
      cursorX: active.cursorX,
      cursorY: active.cursorY,
      cursorCol: active.cursorX + 1,
      cursorRow: active.cursorY + 1,
      absoluteCursorRow: active.baseY + active.cursorY + 1,
      windowInnerWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      terminalWidth: terminalRect.width,
      screenWidth: screenRect?.width ?? null,
      viewportWidth: viewportRect?.width ?? null,
      viewportClientWidth: viewport?.clientWidth ?? null,
      viewportScrollWidth: viewport?.scrollWidth ?? null,
    };
  }

  function sendBrowserDebug(stage, details = {}) {
    if (!KITTY_TRACE) {
      return;
    }
    const socket = state.socket;
    if (!socket || socket.readyState !== 1) {
      return;
    }
    try {
      socket.send("K" + JSON.stringify({
        stage,
        terminal: browserTerminalState(),
        ...details,
      }));
    } catch (error) {}
  }

  function xtermElements() {
    if (!terminal) {
      return {};
    }
    return {
      xterm: terminal.querySelector(".xterm"),
      screen: terminal.querySelector(".xterm-screen"),
      rows: terminal.querySelector(".xterm-rows"),
      viewport: terminal.querySelector(".xterm-viewport"),
      helper: terminal.querySelector(".xterm-helper-textarea")
    };
  }

  function ensureOverlayBounds() {
    if (!overlay || !terminal) {
      return;
    }
    const { screen } = xtermElements();
    const containerRect = terminal.getBoundingClientRect();
    const rect = screen ? screen.getBoundingClientRect() : containerRect;
    overlay.style.left = `${rect.left - containerRect.left}px`;
    overlay.style.top = `${rect.top - containerRect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }

  function cellMetrics() {
    ensureOverlayBounds();
    const { screen, rows } = xtermElements();
    const rect = (screen || terminal).getBoundingClientRect();
    let cellWidth = rect.width / Math.max(1, state.cols);
    let cellHeight = rect.height / Math.max(1, state.rows);
    const xterm = terminal && terminal.__gottyXterm;
    const rendererCell = xterm && xterm._core && xterm._core._renderService &&
      xterm._core._renderService.dimensions &&
      xterm._core._renderService.dimensions.css &&
      xterm._core._renderService.dimensions.css.cell;

    if (rendererCell) {
      if (Number.isFinite(rendererCell.width) && rendererCell.width > 0) {
        cellWidth = rendererCell.width;
      }
      if (Number.isFinite(rendererCell.height) && rendererCell.height > 0) {
        cellHeight = rendererCell.height;
      }
    }

    if (rows) {
      const firstRow = rows.firstElementChild;
      if (firstRow) {
        const rowRect = firstRow.getBoundingClientRect();
        if (rowRect.height > 0) {
          cellHeight = rowRect.height;
        }
      }
    }

    return {
      width: cellWidth,
      height: cellHeight
    };
  }

  function anchorOffset() {
    return {
      left: 0,
      top: 0
    };
  }

  function placementKey(message) {
    const control = message.control || {};
    const imageId = control.i || control.I || (message.image && message.image.id) || "anon";
    return `${imageId}:${control.p || "0"}`;
  }

  function currentViewportY() {
    const xterm = terminal && terminal.__gottyXterm;
    const active = xterm && xterm.buffer && xterm.buffer.active;
    return active ? active.viewportY : 0;
  }

  function createPlacementMarker(cursor) {
    syncViewerSize();
    const xterm = terminal && terminal.__gottyXterm;
    if (!xterm || typeof xterm.registerMarker !== "function") {
      return null;
    }
    try {
      const active = xterm.buffer && xterm.buffer.active;
      let offset = 0;
      if (active && cursor && Number.isFinite(cursor.bufferRow)) {
        const currentBufferRow = active.baseY + active.cursorY + 1;
        offset = Math.trunc(cursor.bufferRow - currentBufferRow);
      } else if (
        active && cursor && Number.isFinite(cursor.row) &&
        cursor.row >= 1 && cursor.row <= state.rows
      ) {
        // Kitty's cursor row is 1-based within the live terminal screen.
        // registerMarker() takes an offset from xterm's current 0-based row.
        offset = Math.trunc(cursor.row - (active.cursorY + 1));
      }
      const marker = xterm.registerMarker(offset);
      sendBrowserDebug("marker-created", {
        protocolCursor: cursor,
        offset,
        markerLine: marker?.line ?? null,
      });
      return marker;
    } catch (error) {
      return null;
    }
  }

  function disposePlacementMarker(node) {
    if (!node || !node.__kittyMarker) {
      return;
    }
    try {
      node.__kittyMarker.dispose();
    } catch (error) {
      // The marker may already have been disposed by xterm buffer trimming.
    }
    node.__kittyMarker = null;
  }

  function removePlacementNode(node) {
    if (!node) {
      return;
    }
    disposePlacementMarker(node);
    node.__kittyGeneration = (node.__kittyGeneration || 0) + 1;
    revokeNodeUrl(node);
    node.remove();
  }

  function decodeRawImage(image) {
    const binary = atob(image.data);
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    let rgba;
    if (image.format === 32) {
      rgba = bytes;
    } else if (image.format === 24) {
      rgba = new Uint8ClampedArray((bytes.length / 3) * 4);
      for (let src = 0, dst = 0; src < bytes.length; src += 3, dst += 4) {
        rgba[dst] = bytes[src];
        rgba[dst + 1] = bytes[src + 1];
        rgba[dst + 2] = bytes[src + 2];
        rgba[dst + 3] = 255;
      }
    } else {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
    return canvas;
  }

  function binaryFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function stringFromBase64(base64) {
    return atob(base64);
  }

  function inferBlobMimeType(image, control) {
    const explicit = control && (control.U || control.mime);
    if (explicit) {
      return explicit;
    }
    if (!image) {
      return "application/octet-stream";
    }
    if (image.format === 100) {
      return "image/png";
    }
    return "application/octet-stream";
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Failed to create blob from canvas"));
      }, "image/png");
    });
  }

  function sourceRectangle(width, height, control = {}) {
    const sourceWidth = Math.max(1, Math.trunc(Number(width) || 1));
    const sourceHeight = Math.max(1, Math.trunc(Number(height) || 1));
    const requestedX = Math.max(0, Math.trunc(Number.parseInt(control.x || "0", 10) || 0));
    const requestedY = Math.max(0, Math.trunc(Number.parseInt(control.y || "0", 10) || 0));
    const requestedWidth = Math.max(0, Math.trunc(Number.parseInt(control.w || "0", 10) || 0));
    const requestedHeight = Math.max(0, Math.trunc(Number.parseInt(control.h || "0", 10) || 0));
    const right = requestedWidth > 0 ? requestedX + requestedWidth : sourceWidth;
    const bottom = requestedHeight > 0 ? requestedY + requestedHeight : sourceHeight;
    const x = Math.min(sourceWidth, requestedX);
    const y = Math.min(sourceHeight, requestedY);
    const clippedRight = Math.min(sourceWidth, Math.max(x, right));
    const clippedBottom = Math.min(sourceHeight, Math.max(y, bottom));
    const cropWidth = clippedRight - x;
    const cropHeight = clippedBottom - y;
    if (cropWidth < 1 || cropHeight < 1) {
      return null;
    }
    return {
      x,
      y,
      width: cropWidth,
      height: cropHeight,
      sourceWidth,
      sourceHeight,
      cropped: x !== 0 || y !== 0 || cropWidth !== sourceWidth || cropHeight !== sourceHeight,
    };
  }

  async function blobDimensions(blob) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    }

    return new Promise((resolve, reject) => {
      const probe = new Image();
      const url = URL.createObjectURL(blob);
      probe.onload = () => {
        const dimensions = {
          width: probe.naturalWidth,
          height: probe.naturalHeight
        };
        URL.revokeObjectURL(url);
        resolve(dimensions);
      };
      probe.onerror = (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      };
      probe.src = url;
    });
  }

  async function resolveImageAsset(image, control = {}) {
    if (!image) {
      return null;
    }
    let blob;
    let dimensions;
    if (image.format === 100) {
      blob = new Blob([binaryFromBase64(image.data)], {
        type: inferBlobMimeType(image, image.control || {})
      });
      dimensions = await blobDimensions(blob);
    } else {
      const canvas = decodeRawImage(image);
      if (!canvas) {
        return null;
      }
      blob = await canvasToBlob(canvas);
      dimensions = { width: canvas.width, height: canvas.height };
    }
    const sourceRect = sourceRectangle(dimensions.width, dimensions.height, control);
    if (!sourceRect) {
      return null;
    }
    return {
      blob,
      width: sourceRect.width,
      height: sourceRect.height,
      sourceRect,
    };
  }

  function revokeNodeUrl(node) {
    if (node && node.__kittyObjectUrl) {
      URL.revokeObjectURL(node.__kittyObjectUrl);
      node.__kittyObjectUrl = "";
    }
  }

  function layoutNode(node) {
    if (!node || !node.__kittyPlacement) {
      return;
    }
    const { control, cursor, intrinsicWidth, intrinsicHeight, sourceRect } = node.__kittyPlacement;
    syncViewerSize();
    const metrics = cellMetrics();
    const anchor = anchorOffset();
    const controlCols = Math.max(0, Number.parseInt(control.c || "0", 10) || 0);
    const controlRows = Math.max(0, Number.parseInt(control.r || "0", 10) || 0);
    let requestedCols;
    let requestedRows;
    if (controlCols > 0 && controlRows > 0) {
      requestedCols = controlCols;
      requestedRows = controlRows;
    } else if (controlCols > 0) {
      requestedCols = controlCols;
      requestedRows = Math.max(1, Math.round(
        controlCols * metrics.width * intrinsicHeight / intrinsicWidth / metrics.height,
      ));
    } else if (controlRows > 0) {
      requestedRows = controlRows;
      requestedCols = Math.max(1, Math.round(
        controlRows * metrics.height * intrinsicWidth / intrinsicHeight / metrics.width,
      ));
    } else {
      requestedCols = Math.max(1, Math.round(intrinsicWidth / Math.max(1, metrics.width)));
      requestedRows = Math.max(1, Math.round(intrinsicHeight / Math.max(1, metrics.height)));
    }
    const xterm = terminal && terminal.__gottyXterm;
    const viewerCols = Math.max(1, Math.trunc(Number(xterm?.cols) || state.cols));
    const viewerRows = Math.max(1, Math.trunc(Number(xterm?.rows) || state.rows));
    const cursorCol = Math.max(1, Math.trunc(Number(cursor?.col) || 1));
    // A fixed-width PTY may be wider than the browser's xterm instance. Match
    // viu's final-column safety margin using the viewer's real column count,
    // then scale both axes so the image is visible rather than merely clipped.
    const availableViewerCols = Math.max(1, viewerCols - cursorCol);
    const scale = Math.min(1, availableViewerCols / requestedCols);
    const cols = Math.max(1, Math.min(requestedCols, availableViewerCols));
    const rows = Math.max(1, Math.round(requestedRows * scale));
    const marker = node.__kittyMarker;
    const activeBuffer = xterm?.buffer?.active;
    const useProtocolRow = activeBuffer?.type === "alternate" && cursor && Number.isFinite(cursor.row);
    const row = useProtocolRow
      ? cursor.row
      : marker && !marker.isDisposed && Number.isFinite(marker.line)
        ? marker.line - currentViewportY() + 1
      : cursor && Number.isFinite(cursor.bufferRow)
        ? cursor.bufferRow - currentViewportY()
        : (cursor && cursor.row) || 1;
    // Fixed-size PTYs can have more rows than the browser-side xterm. Leave
    // the viewer's final row for the TUI status line in that mismatch mode.
    const viewerBottomRow = Math.max(1, viewerRows - (viewerRows < state.rows ? 1 : 0));
    const visibleRows = Math.max(0, Math.min(rows, viewerBottomRow - row + 1));
    node.style.display = visibleRows > 0 ? "block" : "none";
    node.style.left = `${anchor.left + (Math.max(1, cursor.col) - 1) * metrics.width}px`;
    node.style.top = `${anchor.top + (row - 1) * metrics.height}px`;
    node.style.width = `${cols * metrics.width}px`;
    node.style.height = `${visibleRows * metrics.height}px`;
    node.style.zIndex = String(Number.parseInt(control.z || "0", 10) || 0);
    const imageElement = node.__kittyImageElement;
    if (imageElement && sourceRect) {
      const targetWidth = cols * metrics.width;
      const targetHeight = rows * metrics.height;
      const sourceScaleX = targetWidth / sourceRect.width;
      const sourceScaleY = targetHeight / sourceRect.height;
      imageElement.style.left = `${-sourceRect.x * sourceScaleX}px`;
      imageElement.style.top = `${-sourceRect.y * sourceScaleY}px`;
      imageElement.style.width = `${sourceRect.sourceWidth * sourceScaleX}px`;
      imageElement.style.height = `${sourceRect.sourceHeight * sourceScaleY}px`;
    }
    const { screen, viewport } = xtermElements();
    const overlayRect = overlay.getBoundingClientRect();
    const terminalRect = terminal.getBoundingClientRect();
    const screenRect = screen && screen.getBoundingClientRect();
    const viewportRect = viewport && viewport.getBoundingClientRect();
    sendBrowserDebug("layout", {
      imageId: control.i || control.I || null,
      placementId: control.p || null,
      requestedCols,
      requestedRows,
      viewerCols,
      viewerRows,
      viewerBottomRow,
      terminalVisibleRows: visibleRows,
      availableViewerCols,
      viewerScale: scale,
      positionSource: useProtocolRow ? "protocol" : "marker",
      sourceRect: sourceRect || null,
      protocolCursor: cursor,
      markerLine: marker?.line ?? null,
      markerDisposed: marker?.isDisposed ?? null,
      currentViewportY: currentViewportY(),
      selectedRow: row,
      cssLeft: node.style.left,
      cssTop: node.style.top,
      cssWidth: node.style.width,
      cssHeight: node.style.height,
      cellWidth: metrics.width,
      cellHeight: metrics.height,
      geometry: {
        windowInnerWidth: window.innerWidth,
        documentClientWidth: document.documentElement.clientWidth,
        terminalWidth: terminalRect.width,
        screenWidth: screenRect?.width ?? null,
        viewportWidth: viewportRect?.width ?? null,
        viewportClientWidth: viewport?.clientWidth ?? null,
        viewportScrollWidth: viewport?.scrollWidth ?? null,
        overlayWidth: overlayRect.width,
        overlayClientWidth: overlay.clientWidth,
        overlayScrollWidth: overlay.scrollWidth,
        overlayComputedWidth: getComputedStyle(overlay).width,
        overlayOverflow: getComputedStyle(overlay).overflow,
      },
    });
  }

  function relayoutAll() {
    ensureOverlayBounds();
    for (const node of state.placements.values()) {
      layoutNode(node);
    }
  }

  function scheduleRelayout() {
    if (state.relayoutFrame) {
      return;
    }
    state.relayoutFrame = requestAnimationFrame(() => {
      state.relayoutFrame = 0;
      relayoutAll();
    });
  }

  function bindViewportScroll() {
    if (state.scrollBound) {
      return;
    }
    const { viewport } = xtermElements();
    if (!viewport) {
      return;
    }
    viewport.addEventListener("scroll", () => {
      sendBrowserDebug("viewport-scroll", { currentViewportY: currentViewportY() });
      relayoutAll();
    }, { passive: true });
    state.scrollBound = true;
  }

  function bindTerminalRender() {
    if (state.renderBound || !terminal) {
      return;
    }
    const xterm = terminal.__gottyXterm;
    if (!xterm) {
      return;
    }
    if (typeof xterm.onRender === "function") {
      state.renderDisposables.push(xterm.onRender(() => {
        scheduleRelayout();
      }));
    }
    if (typeof xterm.onWriteParsed === "function") {
      state.renderDisposables.push(xterm.onWriteParsed(() => {
        scheduleRelayout();
      }));
    }
    state.renderBound = state.renderDisposables.length > 0;
  }

  function dispatchSyntheticWheel(target, touch, deltaX, deltaY) {
    if (!target) {
      return;
    }
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      deltaX,
      deltaY,
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    target.dispatchEvent(event);
  }

  function touchScrollThreshold() {
    const configured = Number(window.touchScrollThreshold);
    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return DEFAULT_TOUCH_SCROLL_THRESHOLD;
  }

  function bindTouchScrolling() {
    if (state.touchBound || !terminal) {
      return;
    }

    const bindTarget = terminal;
    const activeTouchId = () => state.touchScroll && state.touchScroll.identifier;
    const wheelTarget = () => {
      const { screen, viewport, xterm } = xtermElements();
      return screen || viewport || xterm || terminal;
    };

    bindTarget.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1) {
        state.touchScroll = null;
        return;
      }
      const touch = event.touches[0];
      state.touchScroll = {
        identifier: touch.identifier,
        lastX: touch.clientX,
        lastY: touch.clientY,
        residualX: 0,
        residualY: 0
      };
    }, { passive: true });

    bindTarget.addEventListener("touchmove", (event) => {
      if (!state.touchScroll) {
        return;
      }
      const touch = Array.from(event.touches).find((entry) => entry.identifier === activeTouchId());
      if (!touch) {
        return;
      }

      const deltaX = state.touchScroll.lastX - touch.clientX;
      const deltaY = state.touchScroll.lastY - touch.clientY;
      state.touchScroll.lastX = touch.clientX;
      state.touchScroll.lastY = touch.clientY;
      state.touchScroll.residualX += deltaX;
      state.touchScroll.residualY += deltaY;

      const threshold = touchScrollThreshold();
      const stepX = state.touchScroll.residualX >= 0 ? 1 : -1;
      const stepY = state.touchScroll.residualY >= 0 ? 1 : -1;
      const ticksX = Math.trunc(Math.abs(state.touchScroll.residualX) / threshold);
      const ticksY = Math.trunc(Math.abs(state.touchScroll.residualY) / threshold);

      if (ticksX === 0 && ticksY === 0) {
        return;
      }

      event.preventDefault();
      const target = wheelTarget();
      const count = Math.max(ticksX, ticksY);
      for (let i = 0; i < count; i += 1) {
        dispatchSyntheticWheel(
          target,
          touch,
          i < ticksX ? stepX : 0,
          i < ticksY ? stepY : 0
        );
      }
      state.touchScroll.residualX -= ticksX * threshold * stepX;
      state.touchScroll.residualY -= ticksY * threshold * stepY;
    }, { passive: false });

    const clearTouchScroll = () => {
      state.touchScroll = null;
    };
    bindTarget.addEventListener("touchend", clearTouchScroll, { passive: true });
    bindTarget.addEventListener("touchcancel", clearTouchScroll, { passive: true });
    state.touchBound = true;
  }

  function ensureContextMenu() {
    if (state.contextMenu) {
      return state.contextMenu;
    }

    const menu = document.createElement("div");
    menu.className = "kitty-context-menu";
    menu.hidden = true;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "kitty-context-menu__item";
    removeButton.textContent = "Remove image";
    menu.appendChild(removeButton);

    state.contextMenu = {
      root: menu,
      removeButton,
      targetKey: null
    };

    document.body.appendChild(menu);

    let remClick = (e) => {
    
      e.preventDefault();
      e.stopPropagation();
      
      if (!state.contextMenu || !state.contextMenu.targetKey) {
        return;
      }
      const node = state.placements.get(state.contextMenu.targetKey);
      if (node) {
        removePlacementNode(node);
        state.placements.delete(state.contextMenu.targetKey);
      }
      hideContextMenu();
    };
    
    removeButton.addEventListener("click",remClick)
    removeButton.addEventListener("contextmenu",remClick)

    document.addEventListener("pointerdown", (event) => {
      if (!state.contextMenu || state.contextMenu.root.hidden) {
        return;
      }
      if (state.contextMenu.root.contains(event.target)) {
        return;
      }
      hideContextMenu();
    }, { passive: true });

    //window.addEventListener("blur", hideContextMenu);
    //window.addEventListener("resize", hideContextMenu);

    return state.contextMenu;
  }

  function showContextMenu(x, y, key) {
    const menu = ensureContextMenu();
    menu.targetKey = key;
    menu.root.hidden = false;

    const margin = 10;
    const rect = menu.root.getBoundingClientRect();
    let left = x - rect.width - margin;
    if (left < margin) {
      left = Math.min(window.innerWidth - rect.width - margin, x + margin);
    }
    if (left < margin) {
      left = margin;
    }

    let top = y - rect.height - margin;
    if (top < margin) {
      top = Math.min(window.innerHeight - rect.height - margin, y + margin);
    }
    if (top < margin) {
      top = margin;
    }

    menu.root.style.left = `${left}px`;
    menu.root.style.top = `${top}px`;
  }

  function hideContextMenu() {
    if (!state.contextMenu) {
      return;
    }
    state.contextMenu.targetKey = null;
    state.contextMenu.root.hidden = true;
  }

  function placementAtPoint(clientX, clientY) {
    let found = null;
    let foundZ = -Infinity;
    let foundIndex = -1;
    let index = 0;
    for (const [key, node] of state.placements.entries()) {
      const rect = node.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const z = Number.parseInt(node.style.zIndex || "0", 10) || 0;
        if (z > foundZ || (z === foundZ && index > foundIndex)) {
          found = key;
          foundZ = z;
          foundIndex = index;
        }
      }
      index += 1;
    }
    return found;
  }

  function bindImageContextMenu() {
    if (state.imageContextBound || !terminal) {
      return;
    }

    const handleRightClick = (event) => {
      if (state.contextMenu && state.contextMenu.root.contains(event.target)) {
        return;
      }
      if (event.target instanceof Element && event.target.closest(".xterm-overlay")) {
        return;
      }
      const key = placementAtPoint(event.clientX, event.clientY);
      if (!key) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, key);
    };

    terminal.addEventListener("mousedown", (event) => {
      if (event.button === 2) {
        handleRightClick(event);
      }
    }, true);

    terminal.addEventListener("contextmenu", handleRightClick, true);
    state.imageContextBound = true;
  }

  async function placeImage(message) {
    if (!overlay || !terminal || !message.image) {
      return;
    }

    const key = placementKey(message);
    const control = message.control || {};
    const cursor = message.bufferCursor || message.cursor || { row: 1, col: 1 };
    sendBrowserDebug("placement-start", {
      key,
      control,
      protocolCursor: message.cursor || null,
      selectedCursor: cursor,
    });
    if (message.image) {
      message.image.control = control;
    }
    let node = state.placements.get(key);
    if (!node) {
      node = document.createElement("div");
      node.className = "kitty-image";
      const imageElement = document.createElement("img");
      imageElement.className = "kitty-image__content";
      imageElement.alt = "";
      node.__kittyImageElement = imageElement;
      node.appendChild(imageElement);
      node.__kittyObjectUrl = "";
      node.__kittyMarker = null;
      node.addEventListener("contextmenu", (event) => {
        showContextMenu(event.clientX, event.clientY, key);
      });
      state.placements.set(key, node);
      overlay.appendChild(node);
    }

    disposePlacementMarker(node);
    node.__kittyMarker = createPlacementMarker(cursor);
    const generation = (node.__kittyGeneration || 0) + 1;
    node.__kittyGeneration = generation;

    //  Bind before the decode, not after it. The server sends the placement
    //  ahead of the synthetic newlines that scroll room for the image, so the
    //  scroll this layout depends on can land while we are still decoding.
    //  Binding afterwards left the very first image of a session with no
    //  listener to correct it, which is why it could come out blank while
    //  every later image in the same session was fine.
    bindViewportScroll();
    bindTerminalRender();
    bindTouchScrolling();
    bindImageContextMenu();

    const asset = await resolveImageAsset(message.image, control);
    if (!asset || node.__kittyGeneration !== generation) {
      return;
    }
    const objectUrl = URL.createObjectURL(asset.blob);
    revokeNodeUrl(node);
    node.__kittyObjectUrl = objectUrl;
    node.__kittyPlacement = {
      control,
      cursor,
      intrinsicWidth: asset.width,
      intrinsicHeight: asset.height,
      sourceRect: asset.sourceRect,
    };
    const imageElement = node.__kittyImageElement;
    imageElement.onload = () => {
      imageElement.onload = null;
      if (node.__kittyGeneration === generation) {
        layoutNode(node);
      }
    };
    imageElement.src = objectUrl;
    layoutNode(node);
  }

  function deleteImages(message) {
    const info = message.delete || {};
    sendBrowserDebug("delete", {
      delete: info,
      placementKeys: Array.from(state.placements.keys()),
    });
    if (info.scope === "a" || info.scope === "A") {
      for (const node of state.placements.values()) {
        removePlacementNode(node);
      }
      state.placements.clear();
      return;
    }

    if (info.imageId) {
      for (const [key, node] of state.placements.entries()) {
        if (key.startsWith(`${info.imageId}:`)) {
          removePlacementNode(node);
          state.placements.delete(key);
        }
      }
    }
  }

  function clearAllImages() {
    deleteImages({ delete: { scope: "a" } });
  }

  function inspectTerminalOutput(data) {
    if (typeof data !== "string" || data[0] !== MSG_OUTPUT || data.length <= 1) {
      return;
    }

    let text;
    try {
      text = state.outputTail + stringFromBase64(data.slice(1));
    } catch (error) {
      state.outputTail = "";
      return;
    }

    if (text.includes("\u001bc") || text.includes("\f")) {
      clearAllImages();
    }

    const csiPattern = /\u001b\[([0-9;?]*)([A-Za-z])/g;
    let match;
    while ((match = csiPattern.exec(text)) !== null) {
      const params = match[1];
      const finalByte = match[2];
      if (finalByte === "H" || finalByte === "f") {
        const normalized = params === "" ? ["1"] : params.split(";");
        const row = Number.parseInt(normalized[0] || "1", 10) || 1;
        const col = Number.parseInt(normalized[1] || "1", 10) || 1;
        state.recentCursorHome = row === 1 && col === 1;
        if (state.recentCursorHome) {
          state.recentClearLineCount = 0;
        }
      }
      if (finalByte === "J") {
        const mode = params === "" ? 0 : Number.parseInt(params.split(";").pop() || "0", 10) || 0;
        if (mode === 2 || mode === 3 || (mode === 0 && state.recentCursorHome)) {
          clearAllImages();
        }
        state.recentCursorHome = false;
        state.recentClearLineCount = 0;
      }
      if (finalByte === "K") {
        const mode = params === "" ? 0 : Number.parseInt(params.split(";").pop() || "0", 10) || 0;
        if (state.recentCursorHome && mode === 0) {
          state.recentClearLineCount += 1;
          if (state.recentClearLineCount >= Math.max(4, Math.floor(state.rows / 3))) {
            clearAllImages();
            state.recentCursorHome = false;
            state.recentClearLineCount = 0;
          }
        } else {
          state.recentClearLineCount = 0;
        }
      }
      if (finalByte === "h" || finalByte === "l") {
        if (params === "?1049" || params === "?1047" || params === "?47") {
          clearAllImages();
        }
        state.recentCursorHome = false;
        state.recentClearLineCount = 0;
      }
      if (finalByte !== "H" && finalByte !== "f" && finalByte !== "K") {
        state.recentCursorHome = false;
        state.recentClearLineCount = 0;
      }
    }

    state.outputTail = text.slice(-64);
  }

  function handleKittyMessage(payload) {
    const message = JSON.parse(payload);
    sendBrowserDebug("kitty-message", {
      kind: message.kind,
      control: message.control || null,
      protocolCursor: message.cursor || message.delete?.cursor || null,
      delete: message.delete || null,
    });
    if (message.kind === "placement") {
      // The server records this cursor exactly where the Kitty APC occurred.
      // Do not replace it with xterm's later cursor, which may already have
      // moved because of redraw or scrolling output queued after the APC.
      placeImage(message);
      return true;
    }
    if (message.kind === "delete") {
      deleteImages(message);
      return true;
    }
    return false;
  }

  const nativeSend = WebSocket.prototype.send;
  const nativeOnOpen = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, options) {
    if (type !== "message") {
      return nativeOnOpen.call(this, type, listener, options);
    }
      const wrapped = function (event) {
        state.socket = this;
        inspectTerminalOutput(event.data);
        if (typeof event.data === "string" && event.data[0] === MSG_KITTY) {
          if (handleKittyMessage(event.data.slice(1))) {
            return;
          }
        }
        const result = listener.call(this, event);
        scheduleRelayout();
        return result;
      };
      listener.__kittyWrapped = wrapped;
      return nativeOnOpen.call(this, type, wrapped, options);
    };

  const nativeRemoveEventListener = WebSocket.prototype.removeEventListener;
  WebSocket.prototype.removeEventListener = function (type, listener, options) {
    if (type === "message" && listener && listener.__kittyWrapped) {
      return nativeRemoveEventListener.call(this, type, listener.__kittyWrapped, options);
    }
    return nativeRemoveEventListener.call(this, type, listener, options);
  };

  // Walk the prototype chain to find the native onmessage descriptor.
  // Safari/WebKit defines it on a parent prototype (e.g. EventTarget),
  // not directly on WebSocket.prototype, so a single-level lookup fails.
  let descriptor = null;
  for (let proto = WebSocket.prototype; proto; proto = Object.getPrototypeOf(proto)) {
    descriptor = Object.getOwnPropertyDescriptor(proto, "onmessage");
    if (descriptor) break;
  }
  Object.defineProperty(WebSocket.prototype, "onmessage", {
    configurable: true,
    enumerable: descriptor ? descriptor.enumerable : true,
    get() {
      return this.__kittyOnMessage || null;
    },
    set(handler) {
      this.__kittyOnMessage = handler;
      if (typeof handler !== "function") {
        if (descriptor && descriptor.set) {
          descriptor.set.call(this, handler);
        }
        return;
      }
      const wrapped = function (event) {
        state.socket = this;
        inspectTerminalOutput(event.data);
        if (typeof event.data === "string" && event.data[0] === MSG_KITTY) {
          if (handleKittyMessage(event.data.slice(1))) {
            return;
          }
        }
        return handler.call(this, event);
      };
      if (descriptor && descriptor.set) {
        descriptor.set.call(this, wrapped);
      } else {
        // Fallback: use addEventListener when no native setter is available.
        this.addEventListener("message", wrapped);
      }
    }
  });

  window.addEventListener("resize", relayoutAll);
  bindTouchScrolling();
  bindImageContextMenu();
  const originalNativeSend = nativeSend;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string" && data[0] === "3") {
      try {
        const resize = JSON.parse(data.slice(1));
        if (resize.columns) {
          state.cols = resize.columns;
          state.sizeFromClient = true;
        }
        if (resize.rows) {
          state.rows = resize.rows;
          state.sizeFromClient = true;
        }
      } catch (error) {
        // ignore
      }
    }
    return originalNativeSend.call(this, data);
  };
  relayoutAll();
})();
