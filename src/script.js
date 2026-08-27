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
        "example.com"
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
    const socksServer = customSocks.server || "2603:1040:401::206";
    const socksPort = customSocks.port ? Number(customSocks.port) : 41025;
    const socksUsername = customSocks.username || "proxyuser";
    const socksPassword = customSocks.password || "3SuKneO3gKnSKKJCk78";
    const socksCipher = customSocks.cipher || ((typeof SOCKS_CIPHER !== 'undefined' && SOCKS_CIPHER) ? SOCKS_CIPHER : "chacha20-ietf-poly1305");
    const socksUuid = customSocks.uuid || ((typeof SOCKS_UUID !== 'undefined' && SOCKS_UUID) ? SOCKS_UUID : "");
    const socksSni = customSocks.sni || ((typeof SOCKS_SNI !== 'undefined' && SOCKS_SNI) ? SOCKS_SNI : "");
    const socksNodeName = customSocks.name || homeExitName;

    // 根据不同出口协议组装家宽代理节点
    // Clash 中 http/https 出口均使用 type=http，https 通过 tls=true 区分
    const clashProxyType = (socksType === 'https') ? 'http' : socksType;

    let homeExitProxy = {
        name: socksNodeName,
        type: clashProxyType,
        server: socksServer,
        port: socksPort,
        "dialer-proxy": frontGroupName
    };

    if (socksType === 'socks5') {
        if (socksUsername) homeExitProxy.username = socksUsername;
        if (socksPassword) homeExitProxy.password = socksPassword;
        homeExitProxy.udp = true;
    } else if (socksType === 'http') {
        if (socksUsername) homeExitProxy.username = socksUsername;
        if (socksPassword) homeExitProxy.password = socksPassword;
    } else if (socksType === 'https') {
        if (socksUsername) homeExitProxy.username = socksUsername;
        if (socksPassword) homeExitProxy.password = socksPassword;
        homeExitProxy.tls = true;
        if (socksSni) homeExitProxy.sni = socksSni;
    } else if (socksType === 'ss') {
        homeExitProxy.cipher = socksCipher;
        homeExitProxy.password = socksPassword;
        homeExitProxy.udp = true;
    } else if (socksType === 'trojan') {
        homeExitProxy.password = socksPassword;
        homeExitProxy.tls = true;
        if (socksSni) homeExitProxy.sni = socksSni;
        homeExitProxy.udp = true;
    } else if (socksType === 'vless') {
        homeExitProxy.uuid = socksUuid;
        homeExitProxy.cipher = 'auto';
        homeExitProxy.udp = true;
    }

    config.proxies.push(homeExitProxy);

    // ===== 自建 REALITY 直连节点（作为普通节点加入前置组，不带 dialer-proxy） =====
    const japanRealityName = "🇯🇵 日本-REALITY";
    const westusNodeName = "🇺🇸 美西-REALITY";

    const realityClientBase = {
        type: "vless",
        network: "tcp",
        tls: true,
        udp: true,
        flow: "xtls-rprx-vision",
        "client-fingerprint": "chrome"
    };

    // 参数来源：各机 `sing-box url` 输出（2026-08-27 核对）
    config.proxies.push(
        {
            ...realityClientBase,
            name: japanRealityName,
            server: "2603:1040:401::206",
            port: 31025,
            uuid: "bfbe82b6-055a-4bfc-877d-5a402fc2a65f",
            servername: "www.paypal.com",
            "reality-opts": {
                "public-key": "UsO1gtWCVDuY05LFkTrlpqdaXpHnzacCfhPKGHQ13zA"
            }
        },
        {
            ...realityClientBase,
            name: westusNodeName,
            server: "2603:1030:a04:27::83",
            port: 57968,
            uuid: "115dd6c9-dba6-4c3e-9e43-89acfea74610",
            servername: "www.amazon.com",
            "reality-opts": {
                "public-key": "jCmkxkAI6WpShwRODJvNnXb322wZR5OHc8tSZh_Xkx0"
            }
        }
    );

    // 第二落点：美西 socks5（与家宽出口同构，链式经前置节点）
    const westusExitName = "🇺🇸 美西出口";
    config.proxies.push({
        name: westusExitName,
        type: "socks5",
        server: "2603:1030:a04:27::83",
        port: 41025,
        username: socksUsername,
        password: socksPassword,
        udp: true,
        "dialer-proxy": frontGroupName
    });

    // 前置池 = 机场全部节点 + 两台自建 REALITY 直连
    const frontProxyNames = unique([
        ...sourceProxyNames,
        japanRealityName,
        westusNodeName
    ]);

    // 策略组定义（带 Emoji 图标）
    config["proxy-groups"] = [
        {
            name: frontGroupName,
            type: "url-test",
            url: "http://cp.cloudflare.com/generate_204",
            interval: 300,
            tolerance: 50,
            lazy: true,
            fallback: frontProxyNames.length ? frontProxyNames[0] : "DIRECT",
            proxies: frontProxyNames.length ? frontProxyNames : ["DIRECT"]
        },
        {
            name: finalExitGroupName,
            type: "select",
            proxies: unique([
                frontGroupName,
                socksNodeName,
                westusExitName
            ])
        },
        {
            name: aiGroupName,
            type: "select",
            proxies: unique([
                socksNodeName,
                westusExitName,
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
        `DOMAIN-SUFFIX,openai.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,chatgpt.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,oaistatic.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,oaiusercontent.com,${aiGroupName}`,
        `DOMAIN-SUFFIX,anthropic.com,${aiGroupName}`,
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
        `DOMAIN-SUFFIX,netflix.com,${finalExitGroupName}`,

        ...processNames.map(name =>
            `PROCESS-NAME,${name},${finalExitGroupName}`
        ),

        ...ipCidrs.map(ip =>
            `IP-CIDR,${ip},${finalExitGroupName},no-resolve`
        ),

        ...proxyDomainSuffixes.map(domain =>
            `DOMAIN-SUFFIX,${domain},${finalExitGroupName}`
        ),

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

