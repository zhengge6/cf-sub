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
      const yaml = `# CF-Sub REALITY isolation test profile (meta-rules-dat routing)
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
    servername: www.apple.com
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
    servername: www.apple.com
    client-fingerprint: chrome
    reality-opts:
      public-key: jCmkxkAI6WpShwRODJvNnXb322wZR5OHc8tSZh_Xkx0
proxy-groups:
  - name: 🌍 全局出口
    type: select
    proxies:
      - 🇯🇵 日本-REALITY
      - 🇺🇸 美西-REALITY
  - name: 🤖 AI服务-链式
    type: select
    proxies:
      - 🌍 全局出口
      - 🇯🇵 日本-REALITY
      - 🇺🇸 美西-REALITY
  - name: ✉️ 邮件服务
    type: select
    proxies:
      - 🌍 全局出口
      - 🇯🇵 日本-REALITY
      - 🇺🇸 美西-REALITY
rule-providers:
  reject:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt
    path: ./ruleset/reject.yaml
    interval: 86400
  icloud:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt
    path: ./ruleset/icloud.yaml
    interval: 86400
  apple:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt
    path: ./ruleset/apple.yaml
    interval: 86400
  google:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google.txt
    path: ./ruleset/google.yaml
    interval: 86400
  proxy:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt
    path: ./ruleset/proxy.yaml
    interval: 86400
  direct:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt
    path: ./ruleset/direct.yaml
    interval: 86400
  private:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt
    path: ./ruleset/private.yaml
    interval: 86400
  gfw:
    type: http
    behavior: domain
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt
    path: ./ruleset/gfw.yaml
    interval: 86400
  cncidr:
    type: http
    behavior: ipcidr
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt
    path: ./ruleset/cncidr.yaml
    interval: 86400
  lancidr:
    type: http
    behavior: ipcidr
    url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt
    path: ./ruleset/lancidr.yaml
    interval: 86400
  category-ai-chat-!cn:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-ai-chat-!cn.mrs
    path: ./ruleset/category-ai-chat-!cn.mrs
    interval: 86400
  telegram:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/telegram.mrs
    path: ./ruleset/telegram.mrs
    interval: 86400
  twitter:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/twitter.mrs
    path: ./ruleset/twitter.mrs
    interval: 86400
  facebook:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/facebook.mrs
    path: ./ruleset/facebook.mrs
    interval: 86400
  instagram:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/instagram.mrs
    path: ./ruleset/instagram.mrs
    interval: 86400
  tiktok:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/tiktok.mrs
    path: ./ruleset/tiktok.mrs
    interval: 86400
  github:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/github.mrs
    path: ./ruleset/github.mrs
    interval: 86400
  gitlab:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/gitlab.mrs
    path: ./ruleset/gitlab.mrs
    interval: 86400
  microsoft:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/microsoft.mrs
    path: ./ruleset/microsoft.mrs
    interval: 86400
  netflix:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/netflix.mrs
    path: ./ruleset/netflix.mrs
    interval: 86400
  disney:
    type: http
    format: mrs
    behavior: domain
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/disney.mrs
    path: ./ruleset/disney.mrs
    interval: 86400
  telegramcidr:
    type: http
    format: mrs
    behavior: ipcidr
    url: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/telegramcidr.mrs
    path: ./ruleset/telegramcidr.mrs
    interval: 86400
rules:
  - DOMAIN,telemetry.open-design.ai,REJECT
  - DOMAIN,us.i.posthog.com,REJECT
  - PROCESS-NAME,Mail,✉️ 邮件服务
  - PROCESS-NAME,accountsd,✉️ 邮件服务
  - DST-PORT,993,✉️ 邮件服务
  - DST-PORT,465,✉️ 邮件服务
  - DST-PORT,587,✉️ 邮件服务
  - DST-PORT,143,✉️ 邮件服务
  - DOMAIN-SUFFIX,example.com,DIRECT
  - DOMAIN-KEYWORD,ipinfo,🌍 全局出口
  - RULE-SET,category-ai-chat-!cn,🤖 AI服务-链式
  - DOMAIN-SUFFIX,openai.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,chatgpt.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,oaistatic.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,oaiusercontent.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,anthropic.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,claude.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,claude.ai,🤖 AI服务-链式
  - DOMAIN,gemini.google.com,🤖 AI服务-链式
  - DOMAIN,aistudio.google.com,🤖 AI服务-链式
  - DOMAIN,makersuite.google.com,🤖 AI服务-链式
  - DOMAIN,generativelanguage.googleapis.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,perplexity.ai,🤖 AI服务-链式
  - DOMAIN-SUFFIX,poe.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,x.ai,🤖 AI服务-链式
  - DOMAIN-SUFFIX,grok.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,whatsapp.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,whatsapp.net,🤖 AI服务-链式
  - DOMAIN-SUFFIX,wa.me,🤖 AI服务-链式
  - DOMAIN-SUFFIX,kraken.com,🤖 AI服务-链式
  - DOMAIN-SUFFIX,kraken.net,🤖 AI服务-链式
  - DOMAIN-SUFFIX,kraken.pro,🤖 AI服务-链式
  - PROCESS-NAME,tor,🌍 全局出口
  - PROCESS-NAME,tor.real,🌍 全局出口
  - PROCESS-NAME,Tor Browser,🌍 全局出口
  - PROCESS-NAME,lyrebird,🌍 全局出口
  - PROCESS-NAME,obfs4proxy,🌍 全局出口
  - PROCESS-NAME,Telegram,🌍 全局出口
  - PROCESS-NAME,Discord,🌍 全局出口
  - PROCESS-NAME,steam_osx,🌍 全局出口
  - IP-CIDR,91.108.4.0/22,🌍 全局出口,no-resolve
  - IP-CIDR,91.108.8.0/22,🌍 全局出口,no-resolve
  - IP-CIDR,91.108.56.0/22,🌍 全局出口,no-resolve
  - IP-CIDR,149.154.160.0/20,🌍 全局出口,no-resolve
  - DOMAIN-SUFFIX,brew.sh,🌍 全局出口
  - DOMAIN-SUFFIX,github.com,🌍 全局出口
  - DOMAIN-SUFFIX,githubusercontent.com,🌍 全局出口
  - DOMAIN-SUFFIX,ghcr.io,🌍 全局出口
  - DOMAIN-SUFFIX,pypi.org,🌍 全局出口
  - DOMAIN-SUFFIX,files.pythonhosted.org,🌍 全局出口
  - DOMAIN-SUFFIX,gstatic.com,🌍 全局出口
  - DOMAIN-SUFFIX,apple.com,🌍 全局出口
  - DOMAIN-SUFFIX,cdn-apple.com,🌍 全局出口
  - RULE-SET,twitter,🌍 全局出口
  - RULE-SET,facebook,🌍 全局出口
  - RULE-SET,instagram,🌍 全局出口
  - RULE-SET,tiktok,🌍 全局出口
  - RULE-SET,github,🌍 全局出口
  - RULE-SET,gitlab,🌍 全局出口
  - RULE-SET,microsoft,🌍 全局出口
  - RULE-SET,netflix,🌍 全局出口
  - RULE-SET,disney,🌍 全局出口
  - RULE-SET,telegram,🌍 全局出口
  - RULE-SET,telegramcidr,🌍 全局出口,no-resolve
  - RULE-SET,reject,REJECT
  - RULE-SET,private,DIRECT
  - RULE-SET,lancidr,DIRECT
  - RULE-SET,direct,DIRECT
  - RULE-SET,cncidr,DIRECT
  - GEOIP,CN,DIRECT
  - RULE-SET,google,🌍 全局出口
  - RULE-SET,icloud,🌍 全局出口
  - RULE-SET,apple,🌍 全局出口
  - RULE-SET,gfw,🌍 全局出口
  - RULE-SET,proxy,🌍 全局出口
  - MATCH,🌍 全局出口
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
