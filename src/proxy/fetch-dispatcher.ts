import { ProxyAgent, type Dispatcher } from "undici";
import { getConfig } from "../config.js";

let cachedProxyUrl: string | null = null;
let cachedDispatcher: Dispatcher | undefined;

export function getFetchDispatcher(): Dispatcher | undefined {
  let proxyUrl: string | null = null;
  try {
    const config = getConfig();
    proxyUrl = config.tls.proxy_url;
    if (!proxyUrl && config.tls.proxy_enabled) {
      proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;
    }
  } catch {
    // config not loaded — skip env var fallback, go direct
    proxyUrl = null;
  }

  if (!proxyUrl) return undefined;
  if (proxyUrl === cachedProxyUrl && cachedDispatcher) return cachedDispatcher;

  cachedProxyUrl = proxyUrl;
  cachedDispatcher = new ProxyAgent(proxyUrl);
  return cachedDispatcher;
}

export function withFetchDispatcher(init: RequestInit): RequestInit & { dispatcher?: Dispatcher } {
  const dispatcher = getFetchDispatcher();
  return dispatcher ? { ...init, dispatcher } : init;
}
