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

// REALITY 测试订阅拉取统计（Cache API 计数器）
const STAT_KEY = 'https://cf-sub-internal.invalid/__realtrystats';

// 两台机每5分钟推送的真实流量累计（iptables 按端口计量）
const USAGE_KEY = 'https://cf-sub-internal.invalid/__realusage';
const PUSH_TOKEN = '8bb8c37257c099260c294e526e022f5b';
const TOTAL_QUOTA = 1099511627776; // 用量条参照值 1TB

interface MachineUsage {
  i: number;
  o: number;
  t: string;
}

interface UsageState {
  jp?: MachineUsage;
  us?: MachineUsage;
}

async function readUsage(cache: KVNamespaceLike): Promise<UsageState> {
  const cached = await cache.match(new Request(USAGE_KEY));
  if (!cached) return {};
  try {
    return await cached.json();
  } catch {
    return {};
  }
}

function gb(bytes: number): string {
  return (bytes / 1073741824).toFixed(2);
}

interface RealityStats {
  total: number;
  days: Record<string, number>;
  last: string;
}

function statDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readStats(cache: KVNamespaceLike): Promise<RealityStats> {
  const cached = await cache.match(new Request(STAT_KEY));
  if (!cached) return { total: 0, days: {}, last: '' };
  try {
    return await cached.json();
  } catch {
    return { total: 0, days: {}, last: '' };
  }
}

async function bumpStats(ctx: ExecutionContext): Promise<void> {
  const cache = caches.default as unknown as KVNamespaceLike;
  try {
    const s = await readStats(cache);
    s.total += 1;
    const d = statDay();
    s.days[d] = (s.days[d] || 0) + 1;
    s.last = new Date().toISOString();
    const keys = Object.keys(s.days).sort();
    while (keys.length > 30) delete s.days[keys.shift() as string];
    await cache.put(
      new Request(STAT_KEY),
      new Response(JSON.stringify(s), { headers: { 'Cache-Control': 'public, max-age=31536000' } })
    );
  } catch {
    // 统计失败不影响主流程
  }
}

function utf8b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
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

    // 调试端点：自建节点最小 Clash 配置。
    // 节点参数必须与 src/script.js 保持同步。
    if (url.pathname === '/sub' && url.searchParams.get('only') === 'reality') {
      const yaml = `# CF-Sub REALITY isolation test profile v2 (meta-rules-dat routing)
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: true
unified-delay: true
tcp-concurrent: true
global-client-fingerprint: chrome
proxies:
  - name: 🇺🇸 美西-REALITY
    type: vless
    server: 20.228.81.252
    port: 57968
    uuid: 115dd6c9-dba6-4c3e-9e43-89acfea74610
    network: tcp
    tls: true
    udp: true
    ip-version: ipv4
    flow: xtls-rprx-vision
    encryption: none
    packet-encoding: xudp
    servername: www.apple.com
    client-fingerprint: chrome
    reality-opts:
      public-key: jCmkxkAI6WpShwRODJvNnXb322wZR5OHc8tSZh_Xkx0
      short-id: ""
  - name: 🇺🇸 美西-HY2
    type: hysteria2
    server: 20.228.81.252
    port: 36712
    password: a723d54c10a36c24d5e4b042
    udp: true
    ip-version: ipv4
    sni: tls
    alpn:
      - h3
    skip-cert-verify: true
    handshake-timeout: 30
  - name: 🇺🇸 中部-REALITY
    type: vless
    server: 2603:1030:7:6::41
    port: 52839
    uuid: afe80ef8-f8f5-456c-b8df-b4235e7c4b60
    network: tcp
    tls: true
    udp: true
    ip-version: ipv6
    flow: xtls-rprx-vision
    encryption: none
    packet-encoding: xudp
    servername: www.ebay.com
    client-fingerprint: chrome
    reality-opts:
      public-key: 9tSQHVNii662_X_JojEIWkMsw1JPnDfKuRGDno7ZCyo
      short-id: ""
  - name: 🇺🇸 美西出口
    type: socks5
    server: 2603:1030:a04:27::83
    port: 41025
    username: proxyuser
    password: 3SuKneO3gKnSKKJCk78
    udp: true
    ip-version: ipv6
  - name: 🇺🇸 中部出口
    type: socks5
    server: 2603:1030:7:6::41
    port: 41025
    username: proxyuser
    password: 3SuKneO3gKnSKKJCk78
    udp: true
    ip-version: ipv6
  - name: 🇯🇵 日本-REALITY
    type: vless
    server: 2603:1040:401::206
    port: 22175
    uuid: 2c135989-458d-4eee-ae7e-b5cd4a0e63ea
    network: tcp
    tls: true
    udp: true
    ip-version: ipv6
    flow: xtls-rprx-vision
    encryption: none
    packet-encoding: xudp
    servername: www.apple.com
    client-fingerprint: chrome
    reality-opts:
      public-key: 8JH1c75ikJWfvXisGEj1ZRuz27gbgxW-AitOpg9qNAQ
      short-id: ""
  - name: 🇯🇵 日本-HY2
    type: hysteria2
    server: 2603:1040:401::206
    port: 443
    password: e384403d6e38658f32eb627f
    udp: true
    ip-version: ipv6
    sni: tls
    alpn:
      - h3
    skip-cert-verify: true
    handshake-timeout: 30
proxy-groups:
  - name: 🌍 全局出口
    type: select
    proxies:
      - 🇺🇸 美西-REALITY
      - 🇺🇸 美西-HY2
      - 🇺🇸 美西出口
      - 🇺🇸 中部-REALITY
      - 🇺🇸 中部出口
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
  - PROCESS-NAME,com.kraken.pay.app,🌍 全局出口
  - DOMAIN,telemetry.open-design.ai,REJECT
  - DOMAIN,us.i.posthog.com,REJECT
  - PROCESS-NAME,Mail,🌍 全局出口
  - PROCESS-NAME,accountsd,🌍 全局出口
  - DST-PORT,993,🌍 全局出口
  - DST-PORT,465,🌍 全局出口
  - DST-PORT,587,🌍 全局出口
  - DST-PORT,143,🌍 全局出口
  - DOMAIN-SUFFIX,example.com,DIRECT
  - DOMAIN-KEYWORD,ipinfo,🌍 全局出口
  - RULE-SET,category-ai-chat-!cn,🌍 全局出口
  - DOMAIN-SUFFIX,openai.com,🌍 全局出口
  - DOMAIN-SUFFIX,chatgpt.com,🌍 全局出口
  - DOMAIN-SUFFIX,oaistatic.com,🌍 全局出口
  - DOMAIN-SUFFIX,oaiusercontent.com,🌍 全局出口
  - DOMAIN-SUFFIX,anthropic.com,🌍 全局出口
  - DOMAIN-SUFFIX,claude.com,🌍 全局出口
  - DOMAIN-SUFFIX,claude.ai,🌍 全局出口
  - DOMAIN,gemini.google.com,🌍 全局出口
  - DOMAIN,aistudio.google.com,🌍 全局出口
  - DOMAIN,makersuite.google.com,🌍 全局出口
  - DOMAIN,generativelanguage.googleapis.com,🌍 全局出口
  - DOMAIN-SUFFIX,perplexity.ai,🌍 全局出口
  - DOMAIN-SUFFIX,poe.com,🌍 全局出口
  - DOMAIN-SUFFIX,x.ai,🌍 全局出口
  - DOMAIN-SUFFIX,grok.com,🌍 全局出口
  - DOMAIN-SUFFIX,whatsapp.com,🌍 全局出口
  - DOMAIN-SUFFIX,whatsapp.net,🌍 全局出口
  - DOMAIN-SUFFIX,wa.me,🌍 全局出口
  - DOMAIN-SUFFIX,kraken.com,🌍 全局出口
  - DOMAIN-SUFFIX,kraken.net,🌍 全局出口
  - DOMAIN-SUFFIX,kraken.pro,🌍 全局出口
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
      const started = Date.now();
      const statsCache = caches.default as unknown as KVNamespaceLike;
      const st = await readStats(statsCache);
      const usage = await readUsage(statsCache);
      ctx.waitUntil(bumpStats(ctx));
      // 真实流量用量：download=入站(客户端请求+回传内容) upload=出站
      const jpU = usage.jp || { i: 0, o: 0, t: '' };
      const usU = usage.us || { i: 0, o: 0, t: '' };
      const downB = (jpU.i || 0) + (usU.i || 0);
      const upB = (jpU.o || 0) + (usU.o || 0);
      const userinfo = `upload=${upB}; download=${downB}; total=${TOTAL_QUOTA}; expire=4102444800`;
      ctx.waitUntil(
        appendLog(ctx, { status: 200, durMs: Date.now() - started, cache: 'direct', path: '/sub?only=reality' })
      );
      return new Response(yaml, {
        status: 200,
        headers: {
          'Content-Type': 'text/yaml; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'profile-update-interval': '1',
          'profile-title': 'base64:' + utf8b64('🧪 REALITY 测试订阅'),
          'Content-Disposition': 'attachment; filename="reality-test.yaml"',
          'X-Reality-Fetches': String(st.total + 1),
          'subscription-userinfo': userinfo,
        },
      });
    }

    // REALITY 测试订阅拉取统计：/stats
    if (url.pathname === '/stats') {
      const cache = caches.default as unknown as KVNamespaceLike;
      const s = await readStats(cache);
      const d = statDay();
      const u = await readUsage(cache);
      const jp = u.jp || { i: 0, o: 0, t: '-' };
      const us = u.us || { i: 0, o: 0, t: '-' };
      const body =
        `REALITY 订阅拉取统计\n` +
        `总次数: ${s.total}\n` +
        `今日(${d}): ${s.days[d] || 0}\n` +
        `最近一次拉取: ${s.last || '-'}\n` +
        `\nREALITY 端口流量计量\n` +
        `日本(31025): ↓${gb(jp.i)}GB ↑${gb(jp.o)}GB  更新:${jp.t}\n` +
        `美西(57968): ↓${gb(us.i)}GB ↑${gb(us.o)}GB  更新:${us.t}\n`;
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 两台机流量推送入口：/stats/ingest?machine=jp|us&in=&out=&key=
    if (url.pathname === '/stats/ingest') {
      if (url.searchParams.get('key') !== PUSH_TOKEN) {
        return new Response(JSON.stringify({ success: false, message: 'forbidden' }), { status: 403 });
      }
      const machine = url.searchParams.get('machine') === 'us' ? 'us' : 'jp';
      const inB = Number(url.searchParams.get('in') || 0);
      const outB = Number(url.searchParams.get('out') || 0);
      // 单次增量保护：机器端推的是累计绝对值，异常大的跳变直接拒绝
      const cache = caches.default as unknown as KVNamespaceLike;
      const prev = await readUsage(cache);
      const before = prev[machine] || { i: 0, o: 0 };
      if (inB - before.i > 549755813888 || outB - before.o > 549755813888) {
        return new Response(JSON.stringify({ success: false, message: 'delta too large' }), { status: 400 });
      }
      const next: UsageState = { ...prev };
      next[machine] = { i: Math.max(inB, before.i), o: Math.max(outB, before.o), t: new Date().toISOString() };
      ctx.waitUntil(
        cache.put(
          new Request(USAGE_KEY),
          new Response(JSON.stringify(next), { headers: { 'Cache-Control': 'public, max-age=31536000' } })
        )
      );
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
