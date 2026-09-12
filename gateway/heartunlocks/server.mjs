import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const port = Number(process.env.PORT || 8787);
const apiBase = process.env.HEARTUNLOCKS_API_BASE_URL || "https://api.heartunlocks.com";
const apiToken = process.env.HEARTUNLOCKS_API_TOKEN;
const gatewaySecret = process.env.HEARTUNLOCKS_GATEWAY_SECRET;
const callbackSecret = process.env.HEARTUNLOCKS_CALLBACK_SECRET;
const feedbackBase = process.env.HEARTUNLOCKS_FEEDBACK_BASE_URL;
const appCallback = process.env.BANCADASOFT_CALLBACK_URL;
const internalSecret = process.env.BANCADASOFT_INTERNAL_SECRET;
if ([apiToken, gatewaySecret, callbackSecret, feedbackBase, appCallback, internalSecret].some((value) => !value)) throw new Error("Gateway environment is incomplete.");

const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
const authorized = (req) => req.headers.authorization === `Bearer ${gatewaySecret}`;
const read = async (req) => { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error("PAYLOAD_TOO_LARGE"); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); };

function providerRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(path, apiBase), { method, family: 4, timeout: 15000, headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiToken}` } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => { try { const data = JSON.parse(Buffer.concat(chunks).toString("utf8")); if ((response.statusCode || 500) >= 400) return reject(new Error(`PROVIDER_HTTP_${response.statusCode}`)); resolve(data); } catch { reject(new Error("PROVIDER_INVALID_JSON")); } });
    });
    request.on("timeout", () => request.destroy(new Error("PROVIDER_TIMEOUT_UNCERTAIN")));
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function forwardCallback(payload) {
  const response = await fetch(appCallback, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": internalSecret }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`APP_CALLBACK_HTTP_${response.status}`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return authorized(req) ? json(res, 200, { ok: true, service: "heartunlocks-gateway" }) : json(res, 401, { ok: false });
    if (req.method === "POST" && url.pathname === "/orders") {
      if (!authorized(req)) return json(res, 401, { error: "UNAUTHORIZED" });
      const body = await read(req);
      if (typeof body.productUuid !== "string" || typeof body.referenceId !== "string" || body.quantity !== 1) return json(res, 422, { error: "INVALID_ORDER" });
      const feedbackUrl = new URL(`/callbacks/heartunlocks?token=${encodeURIComponent(callbackSecret)}`, feedbackBase).toString();
      const payload = [{ product_uuid: body.productUuid, fields: [{ feedback_url: feedbackUrl, reference_id: body.referenceId, Quantity: 1 }] }];
      let result;
      try { result = await providerRequest("/api/reseller/v1/order", "POST", payload); }
      catch (error) {
        const code = error instanceof Error ? error.message : "PROVIDER_RESULT_UNCERTAIN";
        if (/^PROVIDER_HTTP_4\d\d$/.test(code)) return json(res, 422, { error: "PROVIDER_REJECTED" });
        return json(res, 202, { referenceId: body.referenceId, status: "PROCESSING", uncertain: true });
      }
      const item = Array.isArray(result?.data) ? result.data[0] : null;
      if (result?.status !== "success" || !item?.order_uuid) return json(res, 502, { error: "PROVIDER_REJECTED" });
      console.info("order accepted", { referenceId: body.referenceId, orderId: item.order_uuid });
      return json(res, 202, { externalOrderId: String(item.order_uuid), referenceId: body.referenceId, status: "PROCESSING" });
    }
    if (req.method === "POST" && url.pathname === "/callbacks/heartunlocks") {
      if (url.searchParams.get("token") !== callbackSecret) return json(res, 401, { error: "UNAUTHORIZED" });
      const body = await read(req);
      if (typeof body.reference_id !== "string" || typeof body.order_id !== "string" || typeof body.status !== "string") return json(res, 422, { error: "INVALID_CALLBACK" });
      await forwardCallback(body);
      console.info("callback forwarded", { referenceId: body.reference_id, orderId: body.order_id, status: body.status });
      return json(res, 200, { received: true });
    }
    return json(res, 404, { error: "NOT_FOUND" });
  } catch (error) { console.error("gateway request failed", { code: error instanceof Error ? error.message : "UNKNOWN" }); return json(res, 500, { error: "GATEWAY_ERROR" }); }
});

server.listen(port, "0.0.0.0", () => console.info(`heartunlocks gateway listening on ${port}`));
