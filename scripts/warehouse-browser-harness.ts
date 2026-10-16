import type { Express } from "express";
import type { Server } from "node:http";
import { createServer } from "vite";
import config from "../vite.config";
import path from "node:path";

/** Actual production component and HTTP routes, test-owned DB; no application login is bypassed. */
export async function serveWarehouseBrowserHarness(app:Express,server:Server) {
  const vite=await createServer({...config,configFile:false,server:{middlewareMode:true,hmr:false}});
  app.get("/api/csrf-token",(_req,res)=>res.json({csrfToken:"disposable-test-token"}));
  app.get("/warehouse-release-test",async(_req,res)=>{
    const entry=path.resolve("scripts/warehouse-browser-entry.tsx").replaceAll("\\","/");
    const html=`<!doctype html><html><head><link rel="icon" href="data:,"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Disposable warehouse release verification</title></head><body><div id="root"></div><script type="module" src="/@fs/${entry}"></script></body></html>`;
    res.type("html").send(await vite.transformIndexHtml("/warehouse-release-test",html));
  });
  const finished=new Promise<void>(resolve=>{app.post("/api/__warehouse-test-finish",(_req,res)=>{res.json({closed:true});resolve();});});
  app.use(vite.middlewares);
  console.log(`Browser fixture ready: http://127.0.0.1:${(server.address() as {port:number}).port}/warehouse-release-test`);
  try{await finished;}
  finally{await vite.close();}
}
