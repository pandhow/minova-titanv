# Minova Titan V — 海外营销落地页（Cloudflare Pages + Pages Functions + 飞书 CRM）

> 部署状态:2026-09-02 环境变量(Turnstile/飞书 CRM)已在 CF Dashboard 配置,本提交用于触发重新部署使变量生效。

针对你的实际情况定制:**阿里云 DNS(不动 NS)+ Cloudflare Pages 静态站 + Pages Functions 表单后端 + 飞书多维表格 CRM**。

- **静态站**:Cloudflare Pages 托管,通过 GitHub 仓库自动部署,享受全球 CDN 加速与自动 HTTPS。
- **表单后端**:采用 **Cloudflare Pages Functions**(`functions/api/lead.js` → 路由 `/api/lead`),随静态站一起部署,**同域调用、无需独立 Worker、无需 CORS**。
- **域名 `minova.dhow.ink`**:DNS 仍留阿里云,只加一条 CNAME 指向 `xxx.pages.dev`(**不踩 522 坑**,见下文避坑说明)。
- **CRM**:飞书多维表格落库 + 飞书群机器人即时通知。
- **防垃圾**:Turnstile(Cloudflare 免费)。
- **Inbound SEO**:已内置 meta、JSON-LD、sitemap、robots,配合 Pages 的速度优势做 Google 排名。

## 目录结构

```
minova-titanv/
├── index.html                # 落地页(Pages 托管,表单同域 POST /api/lead)
├── functions/
│   └── api/
│       └── lead.js           # ★ Pages Function 表单后端(随 Pages 一起部署)
├── _headers                  # Pages 安全/CSP/缓存响应头
├── robots.txt                # 搜索引擎抓取规则
├── sitemap.xml               # 站点地图
├── wrangler.toml             # Pages 项目配置(pages_build_output_dir = ".")
├── package.json              # 本地调试脚本
├── .gitignore
├── .dev.vars.example         # 本地密钥模板
└── README.md
```

> 后端逻辑(字段校验、Turnstile、飞书落库、群通知)由 `functions/api/lead.js` 提供,和静态站**一次部署、同域路由**,不再区分独立 Worker。

## 上线前必须替换的占位符

| 位置 | 占位符 | 替换为 |
|---|---|---|
| `index.html` 内联脚本 | `TURNSTILE_SITE_KEY = 'YOUR_TURNSTILE_SITE_KEY'` | 你的 Turnstile Site Key |
| 全站(已统一) | `https://minova.dhow.ink` | 无需改,已是你的域名 |
| `index.html` 错误提示/JSON-LD | `sales@minova.com` | 你的真实联系邮箱 |

> 表单后端地址已写死为同域 `/api/lead`,由 `functions/api/lead.js` 自动接管,**无需再改 URL**。

## 部署四步(目标:网址可访问)

### 第 1 步:部署到 Cloudflare Pages(约 10 分钟)

1. 本仓库已推到 GitHub(`pandhow/minova-titanv`,公开/私有均可)。
2. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Continue with GitHub**。
3. 选 `pandhow/minova-titanv` → **Begin setup**:
   - Framework preset:**None**
   - Build command:**留空**(纯静态 + Pages Functions,无需构建)
   - Build output directory:**.**(根目录)
4. **Save and Deploy**。几分钟后得到预览地址 `https://minova-titanv.pages.dev`,先打开确认页面正常。

> 因为仓库含 `functions/` 目录 + Pages 风格 `wrangler.toml`,Cloudflare 会识别为 **Pages** 而非 Worker。

### 第 2 步:绑定 `minova.dhow.ink`(约 10 分钟,关键)

1. Pages 项目 → **Custom domains** → **Set up a custom domain** → 输入 `minova.dhow.ink`。
2. CF 会提示你加一条 DNS 记录,形如:`CNAME minova → minova-titanv.pages.dev`。
3. 去**阿里云 DNS** 加这条记录:
   - 类型:**CNAME**
   - 主机记录:**minova**
   - 记录值:**minova-titanv.pages.dev**(以 CF 给的为准)
   - TTL:默认(600 秒即可)
4. 回到 CF Pages,等几分钟,状态变绿(Active)。CF 会**自动签发 SSL 证书**,无需你操作。
5. 访问 `https://minova.dhow.ink`,确认能打开且是 HTTPS。

> **避坑说明**:DNS 留在阿里云 + CNAME 指向 `xxx.pages.dev` 是 Cloudflare 官方支持的标准配置,不会触发 522。522 的真正成因是「把 CNAME 指向 `*.pages.dev` 又同时开了 Cloudflare 代理(橙云)」——你的 DNS 在阿里云,根本没开 CF 代理,所以安全。

### 第 3 步:验证后端路由(约 5 分钟)

1. 访问 `https://minova-titanv.pages.dev/api/lead`(GET),应返回 `{"ok":false,"error":"not-found"}`(说明 Pages Function 已上线)。
2. 打开落地页,表单提交一次,观察浏览器 Network 里 `POST /api/lead` 的响应(此时飞书还没接,线索进日志但不落库)。

### 第 4 步:配置 Turnstile 防垃圾(约 10 分钟,可与飞书并行)

1. CF Dashboard → **Turnstile** → **Add widget** → 域名填 `minova.dhow.ink`。
2. 拿到 **Site Key** / **Secret Key**。
3. Site Key 填 `index.html` 的 `TURNSTILE_SITE_KEY`;Secret Key 待下一步填入 Pages 环境变量。
4. 推送 → Pages 自动重新部署。

> 到这里 `https://minova.dhow.ink` 已上线,表单可提交(此时飞书还没接,线索不落库)。

## 下午:接飞书 CRM + 优化(目标:线索落库 + Inbound 打磨)

### 第 5 步:飞书多维表格建表(约 15 分钟)

1. 飞书 → 新建「多维表格」,建一张线索表,列名与 `functions/api/lead.js` 顶部 `FIELDS` 完全一致(默认英文,可改成中文但必须同步改 `FIELDS`):
   - `First Name` / `Last Name` / `Email` / `Company` / `Country` / `Interest` / `Message` / `Page URL`
2. `Message`、`Page URL` 用「多行文本」字段;其余用「单行文本」。
3. 多维表格自带「创建时间」字段,无需手动建。

### 第 6 步:飞书自建应用拿凭证(约 15 分钟,关键避坑)

1. [飞书开放平台](https://open.feishu.cn) → 创建「企业自建应用」。
2. 应用 → **凭证与基础信息**:拿到 `App ID`、`App Secret`。
3. 应用 → **权限管理** → 开通 `bitable:app`(多维表格读写)权限 → **务必点「发布版本」**(只勾不发布会 403)。
4. **把多维表格添加为应用的协作者**:多维表格右上角「··· → 更多 → 添加协作者」→ 搜索你的应用名 → 添加(否则报 no permission)。
5. 拿 `app_token` 与 `table_id`:打开多维表格,URL 形如 `https://xxx.feishu.cn/base/AbCdEf123?table=tblXyz`
   - `app_token` = `/base/` 之后那段(`AbCdEf123`)
   - `table_id` = `?table=` 之后那段(`tblXyz`)
6. (可选)飞书群通知:目标群 → 设置 → 群机器人 → 添加「自定义机器人」→ 复制 webhook。

### 第 7 步:配置 Pages 环境变量(约 5 分钟)

CF Dashboard → Workers & Pages → `minova-titanv` → **Settings → Environment variables**:

| 变量名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `TURNSTILE_SECRET_KEY` | Secret | 生产必填 | Turnstile 密钥 |
| `ALLOWED_ORIGIN` | 变量 | 建议 | `https://minova.dhow.ink` |
| `FEISHU_APP_ID` | Secret | 是 | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | Secret | 是 | 飞书应用 App Secret |
| `FEISHU_BITABLE_APP_TOKEN` | 变量 | 是 | 多维表格 app_token |
| `FEISHU_BITABLE_TABLE_ID` | 变量 | 是 | 数据表 table_id |
| `FEISHU_BOT_WEBHOOK_URL` | Secret | 否 | 飞书群机器人 webhook |

保存后自动生效(可能需要重新部署一次)。**做一次真实提交测试**,确认飞书表格新增一行 + 群里收到通知。

### 第 8 步:Inbound SEO 打磨(约 20 分钟)

- [ ] 提交 `sitemap.xml` 到 [Google Search Console](https://search.google.com/search-console)(添加资源 `minova.dhow.ink`)。
- [ ] 接入 GA4:在 `index.html` 加 GA4 测量 ID,配合 UTM 命名规范追踪各渠道。
- [ ] 检查 `robots.txt` / `sitemap.xml` 可正常访问:`https://minova.dhow.ink/robots.txt`。
- [ ] 用 [PageSpeed Insights](https://pagespeed.web.dev/) 跑一次 `minova.dhow.ink`,确认移动端/桌面端评分(Pages 通常 90+)。

## 避坑清单(重要)

1. **别在阿里云开 CDN/云解析加速**:纯 CNAME 即可。开了阿里云 CDN 反而可能和 Cloudflare 的证书冲突。
2. **别把 `minova.dhow.ink` 的 CNAME 同时指向 `*.pages.dev` 又开 Cloudflare 代理**:你 DNS 在阿里云,天然没这个问题。
3. **仓库里不要保留 Worker 风格配置**(如 `main = "worker.js"` 的 wrangler.toml、独立 `worker.js`),否则 Cloudflare 会误判为 Worker 而非 Pages。
4. **飞书权限必须「发布版本」**:只勾权限没点发布,调接口报 403。
5. **多维表格必须「添加应用为协作者」**:否则报 no permission。
6. **字段名逐字符一致**:含空格、大小写。不一致报 field not found。
7. **密钥只放 Pages 后台 / `.dev.vars`**:`App Secret`、`TURNSTILE_SECRET_KEY`、群机器人 webhook 绝不能进 `index.html`(会公开)。
8. **国内访问测试**:目标客户在海外不受影响;你自己测试若 `pages.dev` 慢,用海外节点或手机流量验证一次即可。

## 本地调试(可选)

```bash
cd minova-titanv
cp .dev.vars.example .dev.vars   # 填入密钥,勿提交
npm install
npm run dev:site    # 本地预览静态站 + Pages Function http://localhost:8788
```

## 成本

- Cloudflare Pages + Pages Functions(10 万请求/天)免费;Turnstile 免费;飞书开放平台免费。
- 合计 **$0/月**,域名你已持有。
