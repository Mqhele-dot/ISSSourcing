import { chromium } from "playwright";
const base="http://127.0.0.1:5000";
const ready=await fetch(`${base}/api/ready`);
if(!ready.ok)throw new Error("Local app is not ready.");
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`${base}/auth`,{waitUntil:"networkidle"});
  console.log("Login shell:",await page.getByPlaceholder("Enter your username").isVisible());
  await page.getByPlaceholder("Enter your username").fill("admin");
  await page.getByPlaceholder("Enter your password").fill("Admin123!");
  await page.getByRole("button",{name:/sign in/i}).click();
  await page.waitForURL(url=>!url.pathname.startsWith("/auth"),{timeout:20_000});
  for(const route of ["/admin/system-diagnostics","/analytics/overview","/procurement/overview","/inventory","/operations/control-tower","/action-inbox"]) {
    const failures=[];
    const observe=response=>{if(response.status()>=500)failures.push(`${response.status()} ${new URL(response.url()).pathname}`);};
    page.on("response",observe);
    await page.goto(base+route,{waitUntil:"networkidle"});
    await page.waitForTimeout(500);
    page.off("response",observe);
    if(failures.length)throw new Error(`${route}: ${failures.join(", ")}`);
    try { await page.locator("main").waitFor({state:"visible",timeout:20_000}); }
    catch { throw new Error(`${route}: main content missing; ${page.url()} — ${(await page.locator("body").innerText()).slice(0,400)}`); }
    console.log(`Local smoke passed: ${route}`);
  }
  if(errors.length)throw new Error(`Browser errors: ${errors.join("; ")}`);
}finally{await browser.close();}
