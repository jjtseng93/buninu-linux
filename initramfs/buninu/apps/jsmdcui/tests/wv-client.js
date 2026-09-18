const cdpUrl = Bun.argv[2] ?? "ws://127.0.0.1:9222";

const view = new Bun.WebView({
  backend: {
    type: "chrome",
    url: cdpUrl,
  },
});

view.onNavigated = (url, title) => {
  console.log(`[navigated] ${title || "(no title)"} — ${url.slice(0, 80)}`);
};

const delay = Bun.sleep

try {

  await delay(2000);
  
  // 1. navigate to first page
  console.log("\n--- navigate: https://example.com ---");
  await view.navigate("https://example.com");
  await delay(2000);


  // 2. navigate to second page
  console.log("\n--- evaluate: micro.cmd.tab() ---");
  await view.evaluate("micro.cmd.tab()");
  await delay(500);
  
  console.log("\n--- navigate: github bunmicro hlw.md ---");
  await view.navigate("https://raw.githubusercontent.com/jjtseng93/bunmicro/refs/heads/main/hlw.md");
  await delay(2000);


  // 3. navigate to third page
  console.log("\n--- evaluate: micro.cmd.tab() ---");
  await view.evaluate("micro.cmd.tab()");
  await delay(500);
  
  console.log("\n--- navigate: https://bun.sh/docs dns ---");
  await view.navigate("https://bun.com/docs/runtime/networking/dns");
  await delay(2000);


  // 4. go back twice
  console.log("\n--- goBack (dns → hlw) ---");
  await view.goBack();
  await delay(2000);

  console.log("\n--- goBack (hlw → example.com) ---");
  await view.goBack();
  await delay(2000);


  // 5. go forward
  console.log("\n--- goForward (example.com → hlw) ---");
  await view.goForward();
  await delay(2000);


  // 6. type before # hello & click
  console.log("\n--- click #hello to focus ---");
  await view.scrollTo("#hello");
  await view.evaluate('micro.action.StartOfLine()');
  await delay(2000);

  console.log("\n--- type: '# Bun is great' ---");
  await view.type("# Bun is great");
  await delay(2000);
  

  console.log("\n--- press Enter ---");
  await view.press("Enter");
  await delay(2000);
  
  
  console.log("\n--- Click 3,3 ---");  
  await view.click(3,3); //點33
  await delay(2000);


  // 7. resize
  console.log("\n--- resize 1280x720 ---");
  await view.resize(1280, 720);
  await delay(2000);

  // 8. go forward to dns
  console.log("\n--- goForward (hlw → dns) ---");
  await view.goForward();
  await delay(2000);

  console.log("\nAll done.");
} finally {
  view.close();
}
