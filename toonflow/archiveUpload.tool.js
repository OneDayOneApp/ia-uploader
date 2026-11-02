/*! toonflowTool:{"name":"archiveUpload","version":"1.0.0","displayName":"永久存档到 archive.org","description":"把工作区里的视频或图片上传到 archive.org（Internet Archive），获得永久可访问的存档地址。","prompt":"需要长期保存或对外分享成片、关键帧、参考图时使用 archive_upload。上传成功后必须把返回的 archive.org 详情页链接告知用户；这是公开存档，上传前确认用户已知晓内容会公开可见。不要用它上传含隐私、未授权素材或密钥的文件。","readme":"# 永久存档到 archive.org\n\n把当前工作区里的视频或图片上传到 [Internet Archive](https://archive.org)，得到永久可访问的公开存档地址。\n\n## 准备工作\n\n1. 注册 archive.org 账号。\n2. 打开 <https://archive.org/account/s3.php> 生成 **Access Key** 与 **Secret Key**。\n3. 在「设置 → 插件市场 → 已安装 → 永久存档到 archive.org → 配置」里填入这两个密钥。\n\n也可以改用环境变量 `IA_ACCESS_KEY` / `IA_SECRET_KEY`，优先级低于插件配置。\n\n## 使用方式\n\n在对话里说明要存档的文件即可，例如：\n\n> 把 assets/generated/成片.mp4 上传到 archive.org，标题叫「小蝌蚪找妈妈」。\n\nAgent 会调用 `archive_upload`，参数：\n\n| 参数 | 必填 | 说明 |\n| --- | --- | --- |\n| `path` | 是 | 工作区相对路径，例如 `assets/generated/xxx.mp4` |\n| `identifier` | 否 | 存档条目 ID，5–100 位字母数字或 `._-`；省略则自动生成 |\n| `title` | 否 | 条目标题，默认取文件名 |\n| `collection` | 否 | 合集，默认取插件配置 |\n| `mediatype` | 否 | `movies` / `image`，默认按扩展名推断 |\n| `derive` | 否 | 是否让 archive.org 生成预览，默认取插件配置 |\n\n## 返回内容\n\n- **详情页**：`https://archive.org/details/<identifier>`\n- **文件直链**：`https://archive.org/download/<identifier>/<文件名>`\n\n## 注意事项\n\n- **上传即公开**。Internet Archive 的条目默认公开可检索；含隐私内容请勿上传。\n- 大文件按流式上传，不会把整个文件读进内存。\n- 网络失败、HTTP 429/5xx 会自动重试（指数退避）。\n- 同一 `identifier` 重复上传会叠加文件（`x-archive-keep-old-version`）。\n","components":[],"author":"chequ","github":"","configRules":[{"type":"input","field":"accessKey","title":"Access Key","value":"","info":"在 archive.org/account/s3.php 生成；留空则读取环境变量 IA_ACCESS_KEY","props":{"placeholder":"S3 Access Key"}},{"type":"input","field":"secretKey","title":"Secret Key","value":"","info":"与 Access Key 配对；留空则读取环境变量 IA_SECRET_KEY","props":{"placeholder":"S3 Secret Key"}},{"type":"input","field":"collection","title":"默认合集","value":"opensource_media","info":"archive.org 要求至少一个合集名，例如 opensource_media、opensource_image"},{"type":"switch","field":"derive","title":"自动生成预览","value":true,"info":"开启后 archive.org 会为视频/图片生成缩略图与预览"}]} */

// 永久存档到 archive.org —— 基于 Internet Archive S3 风格接口实现。
// 协议参考 OneDayOneApp/ia-uploader（MIT）：
//   PUT https://s3.us.archive.org/<identifier>/<文件名>
//   Authorization: LOW <access>:<secret>
//   x-archive-meta-* 的值需按 uri(...) 做百分号编码

const S3_BASE = "https://s3.us.archive.org";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY = 4;

/* ---------- 工具函数 ---------- */

function uriEncode(value) {
  return "uri(" + encodeURIComponent(String(value)) + ")";
}

function authHeader(access, secret) {
  if (!access || !secret) {
    throw new Error(
      "缺少 archive.org 凭据：请在插件配置里填写 Access Key / Secret Key，" +
        "或设置环境变量 IA_ACCESS_KEY 与 IA_SECRET_KEY"
    );
  }
  return "LOW " + access + ":" + secret;
}

function readCredentials(config) {
  const env = typeof process !== "undefined" && process.env ? process.env : {};
  const access = String(config.accessKey || env.IA_ACCESS_KEY || "").trim();
  const secret = String(config.secretKey || env.IA_SECRET_KEY || "").trim();
  return { access, secret };
}

/** archive.org 的条目 ID 规则：5–100 位，仅 [A-Za-z0-9._-]，首字符必须是字母或数字 */
function sanitizeIdentifier(raw) {
  const cleaned = String(raw)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .slice(0, 100);
  if (cleaned.length < 5) {
    // 太短就用时间戳补足
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return (cleaned || "chequ") + "-" + stamp;
  }
  return cleaned;
}

function guessMediatype(fileName) {
  const ext = String(fileName).toLowerCase().split(".").pop() || "";
  if (
    ["mp4", "mov", "mkv", "webm", "avi", "flv", "m4v", "mpg", "mpeg"].includes(ext)
  ) {
    return "movies";
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif"].includes(ext)) {
    return "image";
  }
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) return "audio";
  return "data";
}

function baseName(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || "file";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---------- 上传实现 ---------- */

async function checkAuth({ access, secret }) {
  const res = await fetch(S3_BASE + "/?check_auth=1", {
    headers: { Authorization: authHeader(access, secret), Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error("archive.org 认证失败：HTTP " + res.status + " " + text.slice(0, 200));
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("archive.org 认证响应不是 JSON");
  }
  if (data && data.error) throw new Error("archive.org 拒绝凭据：" + JSON.stringify(data.error).slice(0, 200));
  const username = data && data.username;
  if (!username) throw new Error("archive.org 认证响应缺少 username，无法确认身份");
  return { username, email: data.email || "" };
}

/**
 * 把文件流式 PUT 到 archive.org。
 * body 可以是 Bun.file（流式）或 Uint8Array（回退）。
 */
async function uploadFile({ access, secret, identifier, fileName, body, size, title, collection, mediatype, derive, signal }) {
  const url = S3_BASE + "/" + encodeURIComponent(identifier) + "/" + encodeURIComponent(fileName);

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    if (signal && signal.aborted) throw new Error("上传已取消");
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: authHeader(access, secret),
          "Content-Type": "application/octet-stream",
          "Content-Length": String(size),
          "x-archive-auto-make-bucket": "1",
          "x-archive-size-hint": String(size),
          "x-archive-keep-old-version": "1",
          "x-archive-meta-title": uriEncode(title || identifier),
          "x-archive-meta-mediatype": uriEncode(mediatype),
          "x-archive-meta-collection": uriEncode(collection),
          "x-archive-queue-derive": derive ? "1" : "0",
        },
        body,
        redirect: "follow",
        signal: signal || AbortSignal.timeout(1000 * 60 * 30),
      });

      if (res.ok) {
        const text = await res.text();
        return { status: res.status, response: text.slice(0, 400) };
      }

      const text = await res.text();
      const detail = "HTTP " + res.status + " " + text.slice(0, 300);
      if (!RETRYABLE.has(res.status)) throw new Error("archive.org 拒绝了上传：" + detail);

      lastError = new Error(detail);
    } catch (err) {
      if (signal && signal.aborted) throw new Error("上传已取消");
      lastError = err;
    }

    if (attempt < MAX_RETRY) await sleep(Math.min(1000 * Math.pow(2, attempt), 15000));
  }

  throw new Error("上传失败（已重试 " + MAX_RETRY + " 次）：" + (lastError && lastError.message));
}

/* ---------- 插件定义 ---------- */

const CONFIG_DEFAULTS = {
  accessKey: "",
  secretKey: "",
  collection: "opensource_media",
  derive: true,
};

const UPLOAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 1024,
      description: "工作区相对路径，例如 assets/generated/clip.mp4",
    },
    identifier: {
      type: "string",
      minLength: 5,
      maxLength: 100,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
      description: "存档条目 ID；省略则自动生成",
    },
    title: { type: "string", maxLength: 300, description: "条目标题，默认取文件名" },
    collection: { type: "string", maxLength: 100, description: "合集名，默认取插件配置" },
    mediatype: {
      type: "string",
      enum: ["movies", "image", "audio", "data"],
      description: "媒体类型，默认按扩展名推断",
    },
    derive: { type: "boolean", description: "是否让 archive.org 生成预览" },
  },
};

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

function normalizeConfig(raw) {
  const cfg = Object.assign({}, CONFIG_DEFAULTS, raw || {});
  cfg.accessKey = String(cfg.accessKey || "").trim();
  cfg.secretKey = String(cfg.secretKey || "").trim();
  cfg.collection = String(cfg.collection || CONFIG_DEFAULTS.collection).trim() || CONFIG_DEFAULTS.collection;
  cfg.derive = cfg.derive !== false;
  return cfg;
}

const plugin = {
  validateConfig(raw) {
    return normalizeConfig(raw);
  },

  createTools(ctx) {
    const config = normalizeConfig(ctx && ctx.config);
    const { cwd, files, resolvePath } = ctx || {};

    /** 把工作区相对路径解析为绝对路径（resolvePath 可能是异步的，必须 await） */
    async function toAbsolute(relPath) {
      const p = String(relPath || "").trim();
      if (!p) throw new Error("路径不能为空");
      // ctx.resolvePath 已经做了工作区越界校验，这里不要再重复判断
      if (typeof resolvePath === "function") {
        return String(await resolvePath(p, true));
      }
      if (typeof cwd === "string" && cwd) {
        return p.startsWith("/") ? p : cwd.replace(/\/$/, "") + "/" + p;
      }
      return p;
    }

    async function loadFile(relPath) {
      const abs = await toAbsolute(relPath);
      // 优先用 Bun.file：可流式上传，内存占用与文件大小无关
      if (typeof Bun !== "undefined" && Bun.file) {
        const file = Bun.file(abs);
        if (!(await file.exists())) throw new Error("文件不存在：" + relPath);
        return { body: file, size: file.size, fileName: baseName(abs) };
      }
      // 回退：一次性读入内存
      if (files && typeof files.readFile === "function") {
        const buf = await files.readFile(relPath, true);
        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        return { body: bytes, size: bytes.length, fileName: baseName(abs) };
      }
      throw new Error("当前运行环境无法读取工作区文件");
    }

    return [
      {
        name: "archive_upload",
        label: "永久存档到 archive.org",
        description:
          "把工作区里的视频或图片上传到 archive.org，返回永久可访问的公开存档地址。",
        promptSnippet:
          "把成片、关键帧或参考图上传到 archive.org 做永久保存，返回详情页与直链。",
        promptGuidelines: [
          "上传前确认用户已知晓：archive.org 的条目是公开可检索的。",
          "上传成功后必须把详情页链接原样告知用户，不要只给文件名。",
          "同一作品多次上传时沿用同一个 identifier，archive.org 会保留多个版本。",
        ],
        parameters: UPLOAD_SCHEMA,
        executionMode: "sequential",
        async execute(_toolCallId, args, signal) {
          const { access, secret } = readCredentials(config);
          authHeader(access, secret); // 提前校验

          const input = args || {};
          const file = await loadFile(input.path);
          const identifier = sanitizeIdentifier(input.identifier || genIdentifier(file.fileName));
          const mediatype = input.mediatype || guessMediatype(file.fileName);
          const collection = String(input.collection || config.collection).trim();
          const title = String(input.title || file.fileName).trim();
          const derive = input.derive === undefined ? config.derive : input.derive !== false;

          const result = await uploadFile({
            access,
            secret,
            identifier,
            fileName: file.fileName,
            body: file.body,
            size: file.size,
            title,
            collection,
            mediatype,
            derive,
            signal,
          });

          const detailsUrl = "https://archive.org/details/" + identifier;
          const downloadUrl =
            "https://archive.org/download/" + identifier + "/" + encodeURIComponent(file.fileName);

          const summary = [
            "已上传到 archive.org",
            "",
            "条目 ID：" + identifier,
            "文件：" + file.fileName + "（" + formatSize(file.size) + "）",
            "类型：" + mediatype,
            "合集：" + collection,
            "详情页：" + detailsUrl,
            "直链：" + downloadUrl,
            "",
            "注意：该存档为公开可检索内容。archive.org 生成预览可能需要几分钟。",
          ].join("\n");

          return {
            content: [{ type: "text", text: summary }],
            details: {
              identifier,
              fileName: file.fileName,
              size: file.size,
              mediatype,
              collection,
              title,
              detailsUrl,
              downloadUrl,
              httpStatus: result.status,
            },
          };
        },
      },
      {
        name: "archive_verify",
        label: "验证 archive.org 凭据",
        description: "检查插件里配置的 archive.org Access Key / Secret Key 是否有效。",
        promptSnippet: "配置 archive.org 凭据后，用它确认账号可用。",
        parameters: VERIFY_SCHEMA,
        executionMode: "sequential",
        async execute() {
          const { access, secret } = readCredentials(config);
          const info = await checkAuth({ access, secret });
          return {
            content: [
              {
                type: "text",
                text:
                  "archive.org 凭据有效\n\n账号：" +
                  info.username +
                  (info.email ? "\n邮箱：" + info.email : "") +
                  "\n绑定用户主页：https://archive.org/details/@" +
                  encodeURIComponent(info.username),
              },
            ],
            details: { username: info.username, email: info.email },
          };
        },
      },
    ];
  },
};

function genIdentifier(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, "");
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return sanitizeIdentifier("chequ-" + base + "-" + stamp);
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export { plugin as default };
