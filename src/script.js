function main(config, profileName) {
    if (!Array.isArray(config.proxies)) config.proxies = [];

    const frontGroupName = "🚀 前置节点";
    const finalExitGroupName = "🌍 全局出口";
    const aiGroupName = "🤖 AI服务";
    const mailGroupName = "✉️ 邮件服务";
    // Google/Gemini 专用组：钉死美西 VLESS/REALITY，不含 SOCKS5/HY2，避免双出口风控
    const googleGroupName = "🔍 Google";
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
        "bingapis.com",
        "hybgzs.com"
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
            server: "20.237.137.246",
            port: 443,
            uuid: "115dd6c9-dba6-4c3e-9e43-89acfea74610",
            servername: "home.tatou.works",
            "ip-version": "ipv4",
            "reality-opts": {
                "public-key": "jCmkxkAI6WpShwRODJvNnXb322wZR5OHc8tSZh_Xkx0",
                "short-id": "ee84f021716c334f"
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
            server: "20.237.137.246",
            port: 443,
            password: "a723d54c10a36c24d5e4b042",
            "ip-version": "ipv4",
            obfs: "salamander",
            "obfs-password": "3afbc4632a22032f43d6f0e25facd894"
        }
    );

    // 第二落点：美西 socks5 走 IPv4（前置常无 IPv6，dialer-proxy 用 v4 更稳）
    const westusExitName = "🇺🇸 美西出口";
    // 美西出口直连 SOCKS（不经 dialer-proxy）：机场前置常封 41025，链式第二跳会超时；直连已实测可出网
    config.proxies.push({
        name: westusExitName,
        type: "socks5",
        server: "20.237.137.246",
        port: 41025,
        username: socksUsername,
        password: socksPassword,
        udp: false,
        "ip-version": "ipv4"
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
            // Google/Gemini 钉死美西 VLESS/REALITY（与「美西出口」SOCKS5、HY2 分离；同机 IPv4，避免双出口风控）
            name: googleGroupName,
            type: "select",
            proxies: [westusNodeName]
        },
        {
            name: finalExitGroupName,
            type: "select",
            proxies: unique([
                frontGroupName,
                westusExitName
            ])
        },
        {
            // Claude/GPT 等直连美西，不走机场链式；Google/Gemini 仍走 googleGroupName
            name: aiGroupName,
            type: "select",
            proxies: unique([
                westusNodeName,
                westusHy2Name
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
    config["find-process-mode"] = "always";
    config.ipv6 = true;
    if (!config["global-client-fingerprint"]) {
        config["global-client-fingerprint"] = "chrome";
    }

    // DNS：补齐 fake-ip 与过滤。oauth2.googleapis.com 解析到 198.18.x.x 是正常假 IP；
    // 若出现 dial tcp 198.18.0.x:443 refused，说明流量没进 mihomo（常见：未开 TUN / 未管理员）。
    // 不把 googleapis/google 放进 fake-ip-filter，否则真 IP 直连在国内常被墙，且域名规则易失效。
    const prevDns = (config.dns && typeof config.dns === "object") ? config.dns : {};
    const prevPolicy = (prevDns["nameserver-policy"] && typeof prevDns["nameserver-policy"] === "object")
        ? { ...prevDns["nameserver-policy"] }
        : {};
    const lanFakeIpFilter = [
        "*.lan",
        "*.local",
        "*.localhost",
        "+.lan",
        "+.local",
        "+.localhost",
        "time.*.com",
        "ntp.*.com",
        "+.market.xiaomi.com",
        "localhost.ptlogin2.qq.com",
        "dns.msftncsi.com",
        "www.msftconnecttest.com",
        "www.msftncsi.com"
    ];
    const prevFilter = Array.isArray(prevDns["fake-ip-filter"]) ? prevDns["fake-ip-filter"] : [];
    // 若上游/客户端误把 * 或 google 放进 filter，会破坏假 IP 分流；此处强制去掉
    const scrubbedFilter = prevFilter.filter(item => {
        const s = String(item || "").toLowerCase();
        if (!s || s === "*") return false;
        if (s.includes("google")) return false;
        if (s.includes("gstatic")) return false;
        if (s.includes("googleapis")) return false;
        return true;
    });
    // 国内线路 + TUN 稳定版 DNS：bootstrap/节点解析/直连全用纯 IP 的 UDP，不依赖先解析域名的 DoH
    // （doh.pub 这类域名式 DoH 在 TUN 下常出现 context deadline exceeded，导致全部 DNS 失败）
    const cnUdpDns = ["223.5.5.5", "119.29.29.29"];
    // Google 域名经 🔍 Google（美西 REALITY）去海外 DoH 查询，IP 形式免 bootstrap
    const googleDns = [
        `https://8.8.8.8/dns-query#${googleGroupName}`,
        `https://1.1.1.1/dns-query#${googleGroupName}`
    ];
    // 机场自带的 nameserver-policy（如其自有域名）保留；其余上游 DNS 字段全部覆盖
    const keptPolicy = {};
    Object.keys(prevPolicy).forEach(key => {
        if (/google|gstatic/i.test(key)) return;
        keptPolicy[key] = prevPolicy[key];
    });
    config.dns = {
        enable: true,
        ipv6: true,
        "enhanced-mode": "fake-ip",
        "fake-ip-range": "198.18.0.1/16",
        "fake-ip-filter-mode": "blacklist",
        "fake-ip-filter": unique([...lanFakeIpFilter, ...scrubbedFilter]),
        "use-hosts": true,
        "use-system-hosts": true,
        "respect-rules": false,
        "prefer-h3": false,
        "cache-algorithm": "arc",
        "default-nameserver": cnUdpDns,
        "proxy-server-nameserver": cnUdpDns,
        "direct-nameserver": cnUdpDns,
        "direct-nameserver-follow-policy": false,
        nameserver: [
            "https://223.5.5.5/dns-query",
            "https://1.12.12.12/dns-query",
            ...cnUdpDns
        ],
        "nameserver-policy": {
            ...keptPolicy,
            "+.googleapis.com": googleDns,
            "+.google.com": googleDns,
            "+.gstatic.com": googleDns,
            "+.googleusercontent.com": googleDns
        }
    };
    if (!config.profile || typeof config.profile !== "object") config.profile = {};
    config.profile["store-selected"] = true;
    config.profile["store-fake-ip"] = true;

    // TLS/HTTP 嗅探：force-dns-mapping 让假 IP 连接仍按域名命中 Google 规则
    config.sniffer = {
        enable: true,
        "parse-pure-ip": true,
        "force-dns-mapping": true,
        "override-destination": true,
        sniff: {
            TLS: { ports: [443, 8443] },
            HTTP: { ports: [80, 8080, 8000, 8880] }
        },
        ...(config.sniffer && typeof config.sniffer === "object" ? {} : {})
    };

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

        // linux.do 避开 Azure 出口（Cloudflare 对 Azure IP 易 429），走机场/前置
        `DOMAIN-SUFFIX,linux.do,${frontGroupName}`,

        `DOMAIN-KEYWORD,ipinfo,${finalExitGroupName}`,
        // Google + Gemini 全家桶 → 🔍 Google（固定美西 REALITY，不链式、不 SOCKS）；须在 AI 规则集之前
        `AND,((NETWORK,UDP),(RULE-SET,google)),REJECT`,
        // Windows「Google 账号设置」/OAuth 进程兜底（仍建议开 TUN，否则假 IP 会 refused）
        `PROCESS-NAME,SystemSettings.exe,${googleGroupName}`,
        `PROCESS-NAME,SystemSettings,${googleGroupName}`,
        `PROCESS-NAME,AccountAccessor.exe,${googleGroupName}`,
        `PROCESS-NAME,GoogleUpdate.exe,${googleGroupName}`,
        `PROCESS-NAME,Antigravity.app,${googleGroupName}`,
        `PROCESS-NAME,Antigravity,${googleGroupName}`,
        `PROCESS-NAME,com.google.antigravity,${googleGroupName}`,
        `PROCESS-NAME,Gemini.app,${googleGroupName}`,
        `PROCESS-NAME,Gemini,${googleGroupName}`,
        `PROCESS-NAME,com.google.GeminiMacOS,${googleGroupName}`,
        `PROCESS-NAME,Antigravity IDE.app,${googleGroupName}`,
        `PROCESS-NAME,Antigravity IDE,${googleGroupName}`,
        `PROCESS-NAME,com.google.antigravity-ide,${googleGroupName}`,
        `PROCESS-NAME,language_server_macos_arm,${googleGroupName}`,
        `PROCESS-NAME,language_server_macos_x64,${googleGroupName}`,
        `PROCESS-NAME,language_server,${googleGroupName}`,
        `PROCESS-NAME,language_server.exe,${googleGroupName}`,
        `PROCESS-NAME,language_server_windows,${googleGroupName}`,
        `PROCESS-NAME,language_server_windows_x64.exe,${googleGroupName}`,
        `PROCESS-NAME,Antigravity.exe,${googleGroupName}`,
        `PROCESS-NAME,Antigravity IDE.exe,${googleGroupName}`,
        `PROCESS-NAME,agy.exe,${googleGroupName}`,
        `PROCESS-NAME,node.exe,${googleGroupName}`,
        `DOMAIN-SUFFIX,googleapis.com,${googleGroupName}`,
        `DOMAIN-SUFFIX,gstatic.com,${googleGroupName}`,
        `DOMAIN-SUFFIX,googleusercontent.com,${googleGroupName}`,
        `DOMAIN-SUFFIX,ggpht.com,${googleGroupName}`,
        `DOMAIN-SUFFIX,withgoogle.com,${googleGroupName}`,
        `DOMAIN-SUFFIX,google.com,${googleGroupName}`,
        `DOMAIN-SUFFIX,googlemail.com,${googleGroupName}`,
        `DOMAIN-SUFFIX,googlevideo.com,${googleGroupName}`,
        `DOMAIN,accounts.google.com,${googleGroupName}`,
        `DOMAIN,myaccount.google.com,${googleGroupName}`,
        `DOMAIN,oauth2.googleapis.com,${googleGroupName}`,
        `DOMAIN,www.googleapis.com,${googleGroupName}`,
        `DOMAIN,oauthaccountmanager.googleapis.com,${googleGroupName}`,
        `DOMAIN,gemini.google.com,${googleGroupName}`,
        `DOMAIN,aistudio.google.com,${googleGroupName}`,
        `DOMAIN,makersuite.google.com,${googleGroupName}`,
        `DOMAIN,generativelanguage.googleapis.com,${googleGroupName}`,
        `DOMAIN,daily-cloudcode-pa.googleapis.com,${googleGroupName}`,
        `RULE-SET,google,${googleGroupName}`,

        // AI 类目统一走 AI 组（直连美西 REALITY/HY2；Gemini/Google 已在上方截获）
        `RULE-SET,${aiChatSetName},${aiGroupName}`,
        `DOMAIN-SUFFIX,openai.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,chatgpt.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,oaistatic.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,oaiusercontent.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,anthropic.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,claude.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,claude.ai,${aiGroupName}`,
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
        `PROCESS-NAME,com.kraken.pay.app,${aiGroupName}`,

        "RULE-SET,reject,REJECT",
        "RULE-SET,private,DIRECT",
        "RULE-SET,lancidr,DIRECT",
        "RULE-SET,direct,DIRECT",
        "RULE-SET,cncidr,DIRECT",
        "GEOIP,CN,DIRECT",
        // google 已在上方统一进 googleGroupName
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

