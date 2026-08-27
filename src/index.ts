import { Env } from './types';
import { handleRequest } from './router';

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

    // /sub 路由双层缓存：
    //   主键（去掉 refresh/nocache/cb 的规范化 URL）max-age 1h
    //   副本键（追加 _bk=1）max-age 7d，用于上游机场失败时兜底回吐最后成功版本
    // 带 refresh=1 或 nocache=1 跳过主键读取并强制重建
    if (url.pathname === '/sub' && url.searchParams.has('url')) {
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

        return new Response(response.body, { status: 200, headers: mainHeaders });
      }

      // 处理成功但状态非200（如机场下载失败的400）：优先回吐副本
      const stale = await cache.match(bkReq);
      if (stale) {
        return new Response(stale.body, {
          status: 200,
          headers: { ...Object.fromEntries(stale.headers.entries()), 'X-Sub-Cache': 'fail-stale' },
        });
      }
      return response;
    }

    // 其它非订阅转换请求直接响应
    return handleRequest(request, env);
  },
};
