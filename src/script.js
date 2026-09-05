function main(config, profileName) {
    if (!Array.isArray(config.proxies)) config.proxies = [];

    const frontGroupName = "🚀 前置节点";
    const finalExitGroupName = "🌍 全局出口";
    const aiGroupName = "🤖 AI服务-链式";
    const mailGroupName = "✉️ 邮件服务";
    const homeExitName = "🇯🇵 日本出口";

    const processNames = [
        "tor",
        "tor.real",
        "Tor Browser",
        "lyrebird",
        "obfs4proxy",
        "Telegram",
        "Discord",
        "steam_osx"
    ];

    const ipCidrs = [
        "91.108.4.0/22",
        "91.108.8.0/22",
        "91.108.56.0/22",
        "149.154.160.0/20"
    ];

    const directDomainSuffixes = [
        "example.com",
        "bing.com",
        "bing.net",
        "bingapis.com"
    ];

    // ===== 自定义域名拦截区 =====

    const blockedDomains = [
        "telemetry.open-design.ai",
        "us.i.posthog.com"
    ];

    const blockedDomainSuffixes = [];

    // ===== 自定义域名拦截区结束 =====

    const proxyDomainSuffixes = [
        "brew.sh",
        "github.com",
        "githubusercontent.com",
        "ghcr.io",
        "pypi.org",
        "files.pythonhosted.org",
        "gstatic.com",
        "apple.com",
        "cdn-apple.com"
    ];

    const unique = list => [
        ...new Set(list.filter(Boolean))
    ];

    // 保留原始 Emoji 图标，仅修剪头尾多余空格
    const formatNodeName = text => String(text || "").replace(/\s+/g, " ").trim();

    const usedSourceNames = new Map();
    const sourceProxies = [];

    config.proxies.forEach((proxy, index) => {
        if (!proxy || !proxy.name) return;
        if (proxy.name === homeExitName || proxy.name.includes("家宽出口") || proxy.name.includes("日本出口")) return;
        // 过滤机场免费体验节点（名称形如 "🇯🇵 免费-日本X"，emoji 前缀故不可锚定开头）
        if (/免费/.test(proxy.name)) return;

        const baseName = formatNodeName(proxy.name) || `节点 ${index + 1}`;
        const duplicateIndex = (usedSourceNames.get(baseName) || 0) + 1;
        usedSourceNames.set(baseName, duplicateIndex);

        const cleanProxy = {
            ...proxy,
            name: duplicateIndex === 1
                ? baseName
                : `${baseName} (${duplicateIndex})`
        };

        delete cleanProxy["dialer-proxy"];
        sourceProxies.push(cleanProxy);
    });

    config.proxies = sourceProxies;
    const sourceProxyNames = sourceProxies.map(proxy => proxy.name);

    // 读取动态参数 -> 环境变量 -> 默认值
    const customSocks = (typeof CUSTOM_SOCKS !== 'undefined' && CUSTOM_SOCKS) ? CUSTOM_SOCKS : {};

    const socksType = (customSocks.type || (typeof SOCKS_TYPE !== 'undefined' ? SOCKS_TYPE : "socks5")).toLowerCase();
    // 硬编码默认优先，query 参数可临时覆盖；忽略环境变量（避免占位符污染）
    const socksServer = customSocks.server || "2603:1040:401:15::ce";
    const socksPort = customSocks.port ? Number(customSocks.port) : 41025;
    const socksUsername = customSocks.username || "proxyuser";
    const socksPassword = customSocks.password || "3SuKneO3gKnSKKJCk78";
    const socksCipher = customSocks.cipher || ((typeof SOCKS_CIPHER !== 'undefined' && SOCKS_CIPHER) ? SOCKS_CIPHER : "chacha20-ietf-poly1305");
    const socksUuid = customSocks.uuid || ((typeof SOCKS_UUID !== 'undefined' && SOCKS_UUID) ? SOCKS_UUID : "");
    const socksSni = customSocks.sni || ((typeof SOCKS_SNI !== 'undefined' && SOCKS_SNI) ? SOCKS_SNI : "");
    const socksNodeName = customSocks.name || homeExitName;

    // ===== 自建 REALITY 直连节点（作为普通节点加入前置组，不带 dialer-proxy） =====
    const westusNodeName = "🇺🇸 美西-REALITY";

    const realityClientBase = {
        type: "vless",
        network: "tcp",
        tls: true,
        udp: true,
        "ip-version": "ipv6",
        flow: "xtls-rprx-vision",
        encryption: "none",
        "packet-encoding": "xudp",
        "client-fingerprint": "chrome"
    };

    // 参数来源：各机 sing-box conf（日本 2026-09-02 az run-command 核对）
    config.proxies.push(
        {
            ...realityClientBase,
            name: westusNodeName,
            server: "20.228.81.252",
            port: 57968,
            uuid: "115dd6c9-dba6-4c3e-9e43-89acfea74610",
            servername: "www.apple.com",
            "ip-version": "ipv4",
            "reality-opts": {
                "public-key": "jCmkxkAI6WpShwRODJvNnXb322wZR5OHc8tSZh_Xkx0",
                "short-id": ""
            }
        }
    );

    // ===== 自建 HY2 直连节点（UDP 443/36712，晚高峰加速备线，同样进前置组） =====
    const westusHy2Name = "🇺🇸 美西-HY2";

    const hy2ClientBase = {
        type: "hysteria2",
        udp: true,
        "ip-version": "ipv6",
        sni: "tls",
        alpn: ["h3"],
        "skip-cert-verify": true,
        "handshake-timeout": 30
    };

    // 参数来源：各机 /etc/sing-box/conf/Hysteria2-*.json；证书 CN/SAN=tls，ALPN=h3
    config.proxies.push(
        {
            ...hy2ClientBase,
            name: westusHy2Name,
            server: "20.228.81.252",
            port: 36712,
            password: "a723d54c10a36c24d5e4b042",
            "ip-version": "ipv4"
        }
    );

    // 第二落点：美西 socks5 走 IPv6（圣何塞只保留 v6 + socks5 落地）
    const westusExitName = "🇺🇸 美西出口";
    config.proxies.push({
        name: westusExitName,
        type: "socks5",
        server: "2603:1030:a04:27::83",
        port: 41025,
        username: socksUsername,
        password: socksPassword,
        udp: true,
        "ip-version": "ipv6",
        "dialer-proxy": frontGroupName
    });

    const centralusExitName = "🇺🇸 中部出口";
    config.proxies.push({
        name: centralusExitName,
        type: "socks5",
        server: "2603:1030:7:6::41",
        port: 41025,
        username: socksUsername,
        password: socksPassword,
        udp: true,
        "ip-version": "ipv6",
        "dialer-proxy": frontGroupName
    });

    // 前置池 = 机场全部节点 + 自建 REALITY/HY2 直连
    const frontProxyNames = unique([
        ...sourceProxyNames,
        westusNodeName,
        westusHy2Name
    ]);

    // 前置分层：优先 IEPL/IPLC/专线标记节点（名称匹配）
    const FRONT_PREF = /(IEPL|IPLC|专线)/i;
    const ieplFrontNames = frontProxyNames.filter(n => FRONT_PREF.test(n));
    const normalFrontNames = frontProxyNames.filter(n => !FRONT_PREF.test(n));

    // 策略组定义（带 Emoji 图标）
    config["proxy-groups"] = [
        ...(ieplFrontNames.length
            ? [
                {
                    name: frontGroupName,
                    type: "select",
                    proxies: ["⚡ IEPL线路", ...(normalFrontNames.length ? ["🌐 普通线路"] : [])]
                },
                {
                    name: "⚡ IEPL线路",
                    type: "url-test",
                    url: "http://cp.cloudflare.com/generate_204",
                    interval: 300,
                    tolerance: 50,
                    lazy: true,
                    proxies: ieplFrontNames
                },
                ...(normalFrontNames.length
                    ? [{
                        name: "🌐 普通线路",
                        type: "select",
                        proxies: normalFrontNames
                    }]
                    : [])
              ]
            : [
                {
                    name: frontGroupName,
                    type: "url-test",
                    url: "http://cp.cloudflare.com/generate_204",
                    interval: 300,
                    tolerance: 50,
                    lazy: true,
                    fallback: frontProxyNames.length ? frontProxyNames[0] : "DIRECT",
                    proxies: frontProxyNames.length ? frontProxyNames : ["DIRECT"]
                }
              ]),
        {
            name: finalExitGroupName,
            type: "select",
            proxies: unique([
                frontGroupName,
                westusExitName,
                centralusExitName
            ])
        },
        {
            name: aiGroupName,
            type: "select",
            proxies: unique([
                westusExitName,
                centralusExitName,
                finalExitGroupName,
                "DIRECT"
            ])
        },
        {
            name: mailGroupName,
            type: "select",
            proxies: unique([
                ...frontProxyNames,
                "DIRECT"
            ])
        }
    ];

    // 客户端体验参数：上游机场 yaml 普遍缺失，缺省时补齐（对齐成熟模板）
    config["unified-delay"] = true;
    config["tcp-concurrent"] = true;
    config.ipv6 = true;
    if (!config.dns || typeof config.dns !== "object") config.dns = { enable: true };
    config.dns.ipv6 = true;
    if (!config["global-client-fingerprint"]) {
        config["global-client-fingerprint"] = "chrome";
    }
    // TLS/HTTP 嗅探：把 SNI 还原成域名参与分流，raw-IP 连接不再只靠 GeoIP 猜
    if (!config.sniffer) {
        config.sniffer = {
            enable: true,
            "parse-pure-ip": true,
            sniff: {
                TLS: { ports: [443, 8443] },
                HTTP: { ports: [80, 8080] }
            }
        };
    }

    delete config["proxy-providers"];
    delete config["sub-rules"];
    config["rule-providers"] = {};

    [
        "reject",
        "icloud",
        "apple",
        "google",
        "proxy",
        "direct",
        "private",
        "gfw"
    ].forEach(name => {
        config["rule-providers"][name] = {
            type: "http",
            behavior: "domain",
            url: `https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/${name}.txt`,
            path: `./ruleset/${name}.yaml`,
            interval: 86400
        };
    });

    [
        "cncidr",
        "lancidr"
    ].forEach(name => {
        config["rule-providers"][name] = {
            type: "http",
            behavior: "ipcidr",
            url: `https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/${name}.txt`,
            path: `./ruleset/${name}.yaml`,
            interval: 86400
        };
    });

    // 细分 mrs 类目（数据同源 Loyalsoldier/v2ray-rules-dat 背后的 v2fly 社区域名库）
    const metaDomainSets = [
        "category-ai-chat-!cn",
        "telegram",
        "twitter",
        "facebook",
        "instagram",
        "tiktok",
        "github",
        "gitlab",
        "microsoft",
        "netflix",
        "disney"
    ];
    const aiChatSetName = "category-ai-chat-!cn";
    const telegramDomainSet = "telegram";
    metaDomainSets.forEach(name => {
        config["rule-providers"][name] = {
            type: "http",
            format: "mrs",
            behavior: "domain",
            url: `https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/${name}.mrs`,
            path: `./ruleset/${name}.mrs`,
            interval: 86400
        };
    });
    config["rule-providers"]["telegramcidr"] = {
        type: "http",
        format: "mrs",
        behavior: "ipcidr",
        url: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/telegramcidr.mrs",
        path: "./ruleset/telegramcidr.mrs",
        interval: 86400
    };

    const rules = [
        ...blockedDomains.map(domain =>
            `DOMAIN,${domain},REJECT`
        ),

        ...blockedDomainSuffixes.map(domain =>
            `DOMAIN-SUFFIX,${domain},REJECT`
        ),

        `PROCESS-NAME,Mail,${mailGroupName}`,
        `PROCESS-NAME,accountsd,${mailGroupName}`,
        `DST-PORT,993,${mailGroupName}`,
        `DST-PORT,465,${mailGroupName}`,
        `DST-PORT,587,${mailGroupName}`,
        `DST-PORT,143,${mailGroupName}`,

        ...directDomainSuffixes.map(domain =>
            `DOMAIN-SUFFIX,${domain},DIRECT`
        ),

        `DOMAIN-KEYWORD,ipinfo,${finalExitGroupName}`,
        // AI 类目统一走 AI 链式组（mrs 数据自动覆盖 claude/openai/gemini/poe/grok 等）
        `RULE-SET,${aiChatSetName},${aiGroupName}`,
        `DOMAIN-SUFFIX,openai.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,chatgpt.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,oaistatic.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,oaiusercontent.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,anthropic.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,claude.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,claude.ai,${aiGroupName}`,
        `DOMAIN,gemini.google.com,${aiGroupName}`,
        `DOMAIN,aistudio.google.com,${aiGroupName}`,
        `DOMAIN,makersuite.google.com,${aiGroupName}`,
        `DOMAIN,generativelanguage.googleapis.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,perplexity.ai,${aiGroupName}`,
        `DOMAIN-SUFFIX,poe.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,x.ai,${aiGroupName}`,
        `DOMAIN-SUFFIX,grok.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,whatsapp.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,whatsapp.net,${aiGroupName}`,
        `DOMAIN-SUFFIX,wa.me,${aiGroupName}`,
        `DOMAIN-SUFFIX,kraken.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,kraken.net,${aiGroupName}`,
        `DOMAIN-SUFFIX,kraken.pro,${aiGroupName}`,

        ...processNames.map(name =>
            `PROCESS-NAME,${name},${finalExitGroupName}`
        ),

        ...ipCidrs.map(ip =>
            `IP-CIDR,${ip},${finalExitGroupName},no-resolve`
        ),

        ...proxyDomainSuffixes.map(domain =>
            `DOMAIN-SUFFIX,${domain},${finalExitGroupName}`
        ),

        // 细分类目 mrs 规则集（v2fly 社区库同源）→ 全局出口
        `RULE-SET,twitter,${finalExitGroupName}`,
        `RULE-SET,facebook,${finalExitGroupName}`,
        `RULE-SET,instagram,${finalExitGroupName}`,
        `RULE-SET,tiktok,${finalExitGroupName}`,
        `RULE-SET,github,${finalExitGroupName}`,
        `RULE-SET,gitlab,${finalExitGroupName}`,
        `RULE-SET,microsoft,${finalExitGroupName}`,
        `RULE-SET,netflix,${finalExitGroupName}`,
        `RULE-SET,disney,${finalExitGroupName}`,
        `RULE-SET,${telegramDomainSet},${finalExitGroupName}`,
        `RULE-SET,telegramcidr,${finalExitGroupName},no-resolve`,

        // Kraken 应用放行（其遥测域名会被 reject 规则集误杀）
        "PROCESS-NAME,com.kraken.pay.app,🤖 AI服务-链式",
        "RULE-SET,reject,REJECT",
        "RULE-SET,private,DIRECT",
        "RULE-SET,lancidr,DIRECT",
        "RULE-SET,direct,DIRECT",
        "RULE-SET,cncidr,DIRECT",
        "GEOIP,CN,DIRECT",
        `RULE-SET,google,${finalExitGroupName}`,
        `RULE-SET,icloud,${finalExitGroupName}`,
        `RULE-SET,apple,${finalExitGroupName}`,
        `RULE-SET,gfw,${finalExitGroupName}`,
        `RULE-SET,proxy,${finalExitGroupName}`,
        `MATCH,${finalExitGroupName}`
    ];

    config.rules = rules;
    return config;
}

export default main;
export { main };

