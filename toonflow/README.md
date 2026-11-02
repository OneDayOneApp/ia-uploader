# Toonflow 插件 · 永久存档到 archive.org

[Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) 的工具插件，把工作区里的**视频和图片**上传到 Internet Archive，获得永久、公开、可引用的存档地址。

上传协议与本仓库的 [ia-uploader](../README.md) 一致，只是从「桌面/命令行工具」变成了「Agent 可调用的工具」。

## 它做什么

在 Toonflow 的对话里说一句：

> 把 `assets/generated/成片.mp4` 上传到 archive.org，标题叫「小蝌蚪找妈妈」。

Agent 会调用 `archive_upload`，并返回：

- **详情页**：`https://archive.org/details/<identifier>`
- **直链**：`https://archive.org/download/<identifier>/<文件名>`

## 提供的工具

| 工具 | 作用 |
| --- | --- |
| `archive_upload` | 上传文件到 archive.org |
| `archive_verify` | 校验 Access Key / Secret Key 是否有效 |

### `archive_upload` 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `path` | 是 | 工作区相对路径，例如 `assets/generated/clip.mp4` |
| `identifier` | 否 | 存档条目 ID，5–100 位字母数字或 `._-`；省略则自动生成 |
| `title` | 否 | 条目标题，默认取文件名 |
| `collection` | 否 | 合集名，默认 `opensource_media` |
| `mediatype` | 否 | `movies` / `image` / `audio` / `data`，默认按扩展名推断 |
| `derive` | 否 | 是否让 archive.org 生成预览，默认 `true` |

## 安装

把 `archiveUpload.tool.js` 放进 Toonflow 数据目录的 `tools/` 下。

**独立部署（Docker）**

```bash
docker cp archiveUpload.tool.js toonflow-app-toonflow-1:/app/data/tools/
docker exec toonflow-app-toonflow-1 chown bun:bun /app/data/tools/archiveUpload.tool.js
docker exec toonflow-app-toonflow-1 chmod 644 /app/data/tools/archiveUpload.tool.js
```

文件必须可读（644），否则服务端加载会在插件列表里报 `loadError`。

## 配置

1. 登录 <https://archive.org>
2. 打开 <https://archive.org/account/s3.php> 生成 **Access Key** 与 **Secret Key**
3. 在「设置 → 插件市场 → 已安装 → 永久存档到 archive.org → 配置」中填入

也可以用环境变量（优先级低于插件配置）：`IA_ACCESS_KEY` / `IA_SECRET_KEY`。

### 远程访问时怎么办

Toonflow 的「配置」按钮只在**本机访问**时可用 —— 服务端要求 TCP 源地址是 `127.0.0.1`。
通过域名或反向代理访问时按钮是禁用的，这时直接写数据文件：

`settings.json` → `toolConfigs.archiveUpload`

```json
{
  "toolConfigs": {
    "archiveUpload": {
      "accessKey": "你的KEY",
      "secretKey": "你的SECRET",
      "collection": "opensource_media",
      "derive": true
    }
  }
}
```

写完重启 Toonflow 容器生效。

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

与 `ia-upload-cli` 使用同一套接口，差异只在于：

- 文件来自 Toonflow 工作区，通过 `ctx.resolvePath` 解析（**注意它是异步的**）
- 大文件用 `Bun.file()` 作为 `fetch` body 流式上传
- 网络失败与 HTTP 429/5xx 自动重试（指数退避，最多 4 次）

### 踩过的坑

1. **元数据双重编码** —— 先百分号编码，再套 `uri(...)`，直接传中文会乱码。
2. **凭据校验失败也返回 200** —— `GET /?check_auth=1` 出错时仍是 HTTP 200，要靠响应体的 `error` 判断。
3. **上传成功 ≠ 立即可见** —— archive.org 异步处理，条目和文件通常 1–5 分钟才完整出现。
4. **插件清单是单行 JSON** —— 文件首行 `/*! toonflowTool:{...} */` 不能换行，且 `github` 字段必填。

## 安全

- 上传后条目**公开可检索**，请勿上传隐私内容或未授权素材。
- 凭据只存本地配置，错误信息里会打码，不写入日志。
- 使用须遵守 Internet Archive 的[服务条款](https://archive.org/about/terms.php)。

## 许可

MIT，与本仓库一致。
