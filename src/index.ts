import { Env } from './types';
import { handleRequest } from './router';

// 请求日志环形缓冲（存储于 Cache API，按数据中心分区，保留最近 100 条）
const LOG_KEY = 'https://cf-sub-internal.invalid/__logbuf';

function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const redacted = new URL(u.origin + u.pathname);
    for (const [k, v] of u.searchParams.entries()) {
      // url/refresh/cb 等参数可能含机场 token，只保留参数名与值长度
      redacted.searchParams.set(k, k === 'url' ? `<len:${v.length}>` : v.slice(0, 24));
    }
    return redacted.toString();
  } catch {
    return '<unparsable>';
  }
}

async function readLogBuf(cache: KVNamespaceLike): Promise<Record<string, unknown>[]> {
  const cached = await cache.match(new Request(LOG_KEY));
  if (!cached) return [];
  try {
    return await cached.json();
  } catch {
    return [];
  }
}

// 最小接口，避免为日志功能引入额外类型依赖
interface KVNamespaceLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

async function appendLog(ctx: ExecutionContext, entry: Record<string, unknown>): Promise<void> {
  const cache = caches.default as unknown as KVNamespaceLike;
  try {
    const arr = await readLogBuf(cache);
    arr.unshift({ t: new Date().toISOString(), ...entry });
    if (arr.length > 100) arr.length = 100;
    const res = new Response(JSON.stringify(arr), {
      headers: { 'Cache-Control': 'public, max-age=31536000' },
    });
    await cache.put(new Request(LOG_KEY), res);
  } catch {
    // 日志失败不影响主流程
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 限制仅处理 GET / HEAD 请求
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(
        JSON.stringify({ success: false, message: 'Method Not Allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const url = new URL(request.url);

    // 日志查看/清空：/logs 与 /logs?clear=1
    if (url.pathname === '/logs') {
      const cache = caches.default as unknown as KVNamespaceLike;
      if (url.searchParams.has('clear')) {
        await cache.delete(new Request(LOG_KEY));
        return new Response('log buffer cleared\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      const arr = await readLogBuf(cache);
      const body = arr.length
        ? arr
            .map((e) => {
              const r = e as Record<string, unknown>;
              return `${r.t}  ${r.status}  ${r.durMs}ms  cache=${r.cache}  ${r.path}${r.err ? '  err=' + r.err : ''}`;
            })
            .join('\n')
        : '(empty)';
      return new Response(body + '\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 调试端点：仅含两台自建 REALITY 节点的最小 Clash 配置。
    // 节点参数必须与 src/script.js 中 realityClientBase/两个节点保持同步。
    if (url.pathname === '/sub' && url.searchParams.get('only') === 'reality') {
      const yaml = `# CF-Sub REALITY isolation test profile
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: true
unified-delay: true
tcp-concurrent: true
global-client-fingerprint: chrome
proxies:
  - name: 🇯🇵 日本-REALITY
    type: vless
    server: 2603:1040:401::206
    port: 31025
    uuid: bfbe82b6-055a-4bfc-877d-5a402fc2a65f
    network: tcp
    tls: true
    udp: true
    ip-version: ipv6
    flow: xtls-rprx-vision
    servername: www.shopify.com
    client-fingerprint: chrome
    reality-opts:
      public-key: UsO1gtWCVDuY05LFkTrlpqdaXpHnzacCfhPKGHQ13zA
  - name: 🇺🇸 美西-REALITY
    type: vless
    server: 2603:1030:a04:27::83
    port: 57968
    uuid: 115dd6c9-dba6-4c3e-9e43-89acfea74610
    network: tcp
    tls: true
    udp: true
    ip-version: ipv6
    flow: xtls-rprx-vision
    servername: www.shopify.com
    client-fingerprint: chrome
    reality-opts:
      public-key: jCmkxkAI6WpShwRODJvNnXb322wZR5OHc8tSZh_Xkx0
proxy-groups:
  - name: 🧪 REALITY测试
    type: select
    proxies:
      - 🇯🇵 日本-REALITY
      - 🇺🇸 美西-REALITY
rules:
  - MATCH,🧪 REALITY测试
`;
      return new Response(yaml, {
        status: 200,
        headers: {
          'Content-Type': 'text/yaml; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'profile-update-interval': '1',
        },
      });
    }

    // /sub 路由双层缓存：
    //   主键（去掉 refresh/nocache/cb 的规范化 URL）max-age 1h
    //   副本键（追加 _bk=1）max-age 7d，用于上游机场失败时兜底回吐最后成功版本
    // 带 refresh=1 或 nocache=1 跳过主键读取并强制重建
    if (url.pathname === '/sub' && url.searchParams.has('url')) {
      const started = Date.now();
      const rPath = redactUrl(request.url);
      const cache = caches.default;

      const forceRefresh = url.searchParams.has('refresh') || url.searchParams.has('nocache');

      const canonicalUrl = new URL(url.origin + url.pathname + url.search);
      ['refresh', 'nocache', 'cb'].forEach((k) => canonicalUrl.searchParams.delete(k));
      const bkUrl = new URL(canonicalUrl.toString());
      bkUrl.searchParams.set('_bk', '1');
      const cacheReq = new Request(canonicalUrl.toString());
      const bkReq = new Request(bkUrl.toString());

      if (!forceRefresh) {
        const cachedResponse = await cache.match(cacheReq);
        if (cachedResponse) {
          const hitHeaders = new Headers(cachedResponse.headers);
          hitHeaders.set('X-Sub-Cache', 'hit');
          ctx.waitUntil(appendLog(ctx, { status: 200, durMs: Date.now() - started, cache: 'hit', path: rPath }));
          return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            headers: hitHeaders,
          });
        }
      }

      const response = await handleRequest(request, env);

      // 成功：双键写入（waitUntil 异步，不阻塞响应）
      if (response.status === 200) {
        const mainHeaders = new Headers(response.headers);
        mainHeaders.set('Cache-Control', 'public, max-age=3600');
        mainHeaders.set('X-Sub-Cache', forceRefresh ? 'bypass' : 'miss');
        const bkHeaders = new Headers(response.headers);
        bkHeaders.set('Cache-Control', 'public, max-age=604800');

        ctx.waitUntil(
          Promise.all([
            cache.put(cacheReq, new Response(response.clone().body, { status: 200, headers: mainHeaders })),
            cache.put(bkReq, new Response(response.clone().body, { status: 200, headers: bkHeaders })),
          ])
        );

        ctx.waitUntil(
          appendLog(ctx, {
            status: 200,
            durMs: Date.now() - started,
            cache: forceRefresh ? 'bypass' : 'miss',
            path: rPath,
          })
        );

        return new Response(response.body, { status: 200, headers: mainHeaders });
      }

      // 处理成功但状态非200（如机场下载失败的400）：优先回吐副本
      let errMsg = '';
      if (response.status !== 200) {
        try {
          const j = (await response.clone().json()) as { message?: string };
          errMsg = j?.message || '';
        } catch {
          errMsg = 'non-json-body';
        }
      }
      const stale = await cache.match(bkReq);
      if (stale) {
        ctx.waitUntil(
          appendLog(ctx, { status: response.status, durMs: Date.now() - started, cache: 'fail-stale', path: rPath, err: errMsg })
        );
        return new Response(stale.body, {
          status: 200,
          headers: { ...Object.fromEntries(stale.headers.entries()), 'X-Sub-Cache': 'fail-stale' },
        });
      }
      ctx.waitUntil(appendLog(ctx, { status: response.status, durMs: Date.now() - started, cache: 'none', path: rPath, err: errMsg }));
      return response;
    }

    // 其它非订阅转换请求直接响应
    return handleRequest(request, env);
  },
};
