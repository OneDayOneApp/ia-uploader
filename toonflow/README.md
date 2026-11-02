# Toonflow 插件 · 永久存档到 archive.org

[Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) 的 Internet Archive 归档插件，提供**两种形态**：

| 形态 | 文件 | 触发方式 | 适合 |
| --- | --- | --- | --- |
| **工具插件** | [`archiveUpload.tool.js`](archiveUpload.tool.js) | 对话中由 Agent 调用 | 说一句话就归档 |
| **画布节点** | [`node/`](node/README.md) | 拖到无限画布上连线 | 编排成生成流水线 |

两者使用同一套上传协议 —— 与本仓库的 [ia-uploader](../README.md) 一致。

---

## 一、工具插件

把工作区里的**视频和图片**上传到 Internet Archive，Agent 自动调用。

> 把 `assets/generated/成片.mp4` 上传到 archive.org，标题叫「小蝌蚪找妈妈」。

返回详情页与直链。

### 安装

```bash
docker cp archiveUpload.tool.js toonflow-app-toonflow-1:/app/data/tools/
docker exec toonflow-app-toonflow-1 chown bun:bun /app/data/tools/archiveUpload.tool.js
docker exec toonflow-app-toonflow-1 chmod 644 /app/data/tools/archiveUpload.tool.js
```

### 提供的工具

| 工具 | 作用 |
| --- | --- |
| `archive_upload` | 上传文件，返回详情页 + 直链 |
| `archive_verify` | 校验 Access Key / Secret Key |

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `path` | 是 | 工作区相对路径，例如 `assets/generated/clip.mp4` |
| `identifier` | 否 | 条目 ID，5–100 位字母数字或 `._-`；省略自动生成 |
| `title` | 否 | 标题，默认取文件名 |
| `collection` | 否 | 合集，默认 `opensource_media` |
| `mediatype` | 否 | `movies` / `image` / `audio` / `data`，默认按扩展名推断 |
| `derive` | 否 | 是否生成预览，默认 `true` |

---

## 二、画布节点

见 [`node/README.md`](node/README.md)。

```
[图片节点] ──┐
[视频节点] ──┼─→ [永久存档] ──→ 存档地址
[音频节点] ──┘
```

一个端口同时接收 **图片 / 视频 / 音频**，上传前可填标题、条目 ID、描述、作者、标签、合集；
归档成功后展示详情页与直链，记录随画布持久保存，重复点击会提示不能重复归档。

### 安装

```bash
# 直接用构建好的产物（推荐）
docker cp node/archiveNode.umd.js toonflow-app-toonflow-1:/app/data/nodes/
docker exec toonflow-app-toonflow-1 chmod 644 /app/data/nodes/archiveNode.umd.js
```

需要自己改代码时看 [`node/README.md`](node/README.md) 里的构建说明 ——
注意 Toonflow 的**生产镜像裁掉了 vite**，必须在独立环境编译。

---

## 配置

两种形态都使用同一组 archive.org 凭据：

1. 登录 <https://archive.org>
2. 打开 <https://archive.org/account/s3.php> 生成 **Access Key** 与 **Secret Key**

| 形态 | 凭据存放位置 |
| --- | --- |
| 工具插件 | Toonflow 数据目录的 `settings.json` → `toolConfigs.archiveUpload`，或环境变量 `IA_ACCESS_KEY` / `IA_SECRET_KEY` |
| 画布节点 | **浏览器 `localStorage`**，只在当前浏览器，不进服务器 |

> **注意**：Toonflow 的「配置」按钮只在**本机访问**时可用（服务端要求 TCP 源地址是 `127.0.0.1`）。
> 通过域名或反向代理访问时按钮是禁用的，这时直接写 `settings.json`。

---

## 上传协议

```http
PUT https://s3.us.archive.org/<identifier>/<文件名>
Authorization: LOW <access>:<secret>
Content-Type: application/octet-stream
x-archive-auto-make-bucket: 1
x-archive-size-hint:        <字节数>
x-archive-meta-title:       uri(<百分号编码>)
x-archive-meta-mediatype:   uri(movies|image|audio|data)
x-archive-meta-collection:  uri(<合集名>)
x-archive-queue-derive:     0|1
```

### 踩过的坑

1. **元数据双重编码** —— 先百分号编码，再套 `uri(...)`，直接传中文会乱码。
2. **凭据校验失败也返回 200** —— `GET /?check_auth=1` 出错时仍是 HTTP 200，要靠响应体的 `error` 字段判断。
3. **上传成功 ≠ 立即可见** —— archive.org 异步处理，条目和缩略图通常 1–5 分钟才完整出现。
4. **大文件流式上传** —— 工具插件用 `Bun.file()` 作为 `fetch` body；画布节点用 XHR 直传并拿到进度。
5. **画布节点改完必须重建** —— UMD 有浏览器缓存，改完要强制刷新。

---

## 安全

- 上传后条目**公开可检索**，请勿上传隐私内容或未授权素材。
- 凭据不入库、不写日志；错误信息中会打码。
- 使用须遵守 Internet Archive 的[服务条款](https://archive.org/about/terms.php)。

## 许可

MIT，与本仓库一致。
