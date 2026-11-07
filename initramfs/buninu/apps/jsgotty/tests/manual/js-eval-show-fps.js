(() => {
    window.stopKittyFPS?.();

    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;top:0;right:0;z-index:2147483647;" +
      "background:#000b;color:cyan;padding:4px 8px;" +
      "font:16px monospace;pointer-events:none";
    box.textContent = "Kitty: 0 FPS";
    document.body.append(box);

    let count = 0, last = performance.now();
    const loaded = e => {
      if (e.target.matches?.("img.kitty-image__content"))
  count++;
    };
    document.addEventListener("load", loaded, true);

    const timer = setInterval(() => {
      const now = performance.now();
      box.textContent =
        `Kitty: ${(count * 1000 / (now - last)).toFixed(1)}
  FPS`;
      count = 0;
      last = now;
    }, 1000);

    window.stopKittyFPS = () => {
      clearInterval(timer);
      document.removeEventListener("load", loaded, true);
      box.remove();
      delete window.stopKittyFPS;
    };
    return "Kitty FPS enabled";
  })()
