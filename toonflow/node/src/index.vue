<template>
  <nodeSkeleton v-bind="nodeProps" style="width: 360px">
    <div class="archiveBody nodrag nopan nowheel" :aria-busy="uploading">
      <!-- 预览区 -->
      <div class="previewArea">
        <img v-if="previewUrl && isImage" :src="previewUrl" class="previewMedia" alt="待存档图片" />
        <video v-else-if="previewUrl && isVideo" :src="previewUrl" class="previewMedia" controls />
        <audio v-else-if="previewUrl && isAudio" :src="previewUrl" class="audioPreview" controls />

        <div v-else-if="connected" class="placeholder">
          <icon-cloud-off :size="34" stroke="1.4" aria-hidden="true" />
          <span>{{ copying ? "正在读取上游素材…" : "上游素材不可用" }}</span>
        </div>

        <div v-else class="placeholder">
          <icon-upload :size="34" stroke="1.4" aria-hidden="true" />
          <span>连接图片 / 视频 / 音频节点，或直接选择文件</span>
          <el-button size="small" :disabled="uploading" @click.stop="fileInput?.click()">选择文件</el-button>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept="image/*,video/*,audio/*"
          hidden
          aria-label="选择要存档的文件"
          @change="onPickFile" />
      </div>

      <!-- 文件信息 -->
      <div v-if="sourceLabel" class="fileInfo">
        <span class="fileName">{{ sourceLabel }}</span>
        <span class="meta">
          <span v-if="sourceMime" class="mimeTag">{{ shortMime }}</span>
          <span v-if="sourceSize">{{ formatSize(sourceSize) }}</span>
        </span>
      </div>

      <!-- 归档信息（上传前填写） -->
      <div class="metaForm nodrag nopan nowheel" @pointerdown.stop @dblclick.stop>
        <div class="metaRow">
          <label class="metaLabel">标题</label>
          <el-input v-model="title" size="small" placeholder="默认取文件名" :disabled="uploading" clearable />
        </div>
        <div class="metaRow">
          <label class="metaLabel">条目 ID</label>
          <el-input v-model="identifier" size="small" placeholder="留空自动生成" :disabled="uploading" clearable />
        </div>
        <div class="metaRow">
          <label class="metaLabel">描述</label>
          <el-input
            v-model="description"
            type="textarea"
            :rows="2"
            resize="none"
            size="small"
            placeholder="可选，会显示在归档页"
            :disabled="uploading" />
        </div>

        <button class="moreToggle" type="button" @pointerdown.stop @click.stop="moreVisible = !moreVisible">
          {{ moreVisible ? "收起" : "更多信息（作者 / 标签 / 合集）" }}
        </button>

        <template v-if="moreVisible">
          <div class="metaRow">
            <label class="metaLabel">作者</label>
            <el-input v-model="creator" size="small" placeholder="可选" :disabled="uploading" clearable />
          </div>
          <div class="metaRow">
            <label class="metaLabel">标签</label>
            <el-input v-model="subject" size="small" placeholder="逗号分隔" :disabled="uploading" clearable />
          </div>
          <div class="metaRow">
            <label class="metaLabel">合集</label>
            <el-input v-model="collection" size="small" placeholder="opensource_media" :disabled="uploading" clearable />
          </div>
        </template>
      </div>

      <!-- 归档按钮（常驻） -->
      <el-button
        class="archiveButton"
        type="primary"
        :icon="IconWorldUpload"
        :loading="uploading"
        :disabled="!source || uploading"
        :class="{ archivedButton: !!result }"
        @pointerdown.stop
        @click.stop="requestArchive">
        {{ uploading ? `归档中 ${percent}%` : result ? "已归档 · 不可重复归档" : "归档到 archive.org" }}
      </el-button>

      <!-- 密钥入口 -->
      <button class="moreToggle" type="button" @pointerdown.stop @click.stop="keysVisible = !keysVisible">
        {{ accessKey ? "密钥已设置" : "未设置密钥，点这里填写" }}
      </button>
      <div v-if="keysVisible" class="keysArea nodrag nopan nowheel" @pointerdown.stop>
        <p class="keysHint">
          在 <a href="https://archive.org/account/s3.php" target="_blank" rel="noopener" @click.stop>archive.org/account/s3.php</a>
          生成后填入，只保存在本机浏览器。
        </p>
        <el-input v-model="accessKey" size="small" placeholder="Access Key" :disabled="uploading" />
        <el-input v-model="secretKey" size="small" type="password" show-password placeholder="Secret Key" :disabled="uploading" />
        <el-button size="small" @click.stop="saveKeys">保存密钥</el-button>
        <p v-if="keyMessage" class="keysMessage">{{ keyMessage }}</p>
      </div>

      <!-- 进度 -->
      <div v-if="uploading" class="progressArea" role="status" aria-live="polite">
        <el-progress :percentage="percent" :strokeWidth="4" :showText="false" />
        <span class="statusText">{{ percent }}% · 正在上传到 archive.org</span>
      </div>

      <!-- 归档成功：展示返回的链接 -->
      <div v-else-if="result" class="resultArea">
        <div class="resultHead">
          <icon-circle-check :size="15" aria-hidden="true" />
          <span>归档成功</span>
          <button class="copyButton" type="button" title="复制链接" @pointerdown.stop @click.stop="copyLink">
            {{ copied ? "已复制" : "复制" }}
          </button>
        </div>
        <p v-if="archivedAt" class="archivedAt">归档于 {{ formatTime(archivedAt) }}</p>
        <a :href="result.detailsUrl" target="_blank" rel="noopener" class="resultLink" @pointerdown.stop @click.stop>
          {{ result.detailsUrl }}
        </a>
        <div class="resultRow">
          <span class="resultKey">直链</span>
          <a :href="result.downloadUrl" target="_blank" rel="noopener" class="resultSubLink" @pointerdown.stop @click.stop>
            {{ result.downloadUrl }}
          </a>
        </div>
        <p class="resultHint">archive.org 需要几分钟生成预览与缩略图，稍后刷新详情页即可看到。</p>
        <button class="resetButton" type="button" @pointerdown.stop @click.stop="resetArchive">
          重新归档（清除本节点的归档记录，archive.org 上的条目不受影响）
        </button>
      </div>

      <!-- 错误 -->
      <p v-if="errorMessage" class="errorMessage" role="alert">{{ errorMessage }}</p>
      <p v-else-if="ingestError" class="errorMessage" role="alert">{{ ingestError }}</p>
    </div>
  </nodeSkeleton>

  <el-dialog
    v-model="confirmVisible"
    title="确认归档到 archive.org？"
    width="380px"
    align-center
    append-to-body
    class="archiveConfirm"
    :close-on-click-modal="!uploading">
    <div class="confirmBody">
      <div class="confirmRow">
        <span class="confirmKey">标题</span>
        <span class="confirmValue">{{ confirmInfo.title }}</span>
      </div>
      <div class="confirmRow">
        <span class="confirmKey">条目 ID</span>
        <span class="confirmValue mono">{{ confirmInfo.identifier }}</span>
      </div>
      <div class="confirmRow">
        <span class="confirmKey">文件</span>
        <span class="confirmValue">{{ confirmInfo.fileName }}</span>
      </div>
      <div class="confirmRow">
        <span class="confirmKey">类型</span>
        <span class="confirmValue">{{ confirmInfo.kind }}</span>
      </div>
      <p class="confirmWarning">上传后内容将公开可检索，且难以撤销。请确认素材与信息无误。</p>
    </div>
    <template #footer>
      <el-button :disabled="uploading" @click="confirmVisible = false">取消</el-button>
      <el-button type="primary" :loading="uploading" @click="confirmAndUpload">确认归档</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { ElButton, ElCard, ElDialog, ElInput, ElProgress } from "element-plus";
import { IconCircleCheck, IconCloudOff, IconKey, IconUpload, IconWorldUpload } from "@tabler/icons-vue";
import {
  getTargetValues,
  nodeSkeleton,
  useNode,
  useNodeInputs,
  type NodeHandle,
  type NodeMediaValue,
} from "@toonflow/nodes-scaffold/runtime";

defineOptions({
  inheritAttrs: false,
  icon: IconWorldUpload,
  // 一个端口同时接收图片、视频、音频 —— 与内置的音频/视频生成节点一致
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "VIDEO", "AUDIO"], label: "图片、视频、音频" },
    { id: "url", type: "source", dataType: "STRING", label: "存档地址" },
  ] satisfies NodeHandle[],
});

const { id, node, nodeProps, outputs, files, nodeEvent } = useNode({
  label: "永久存档",
  outputs: { url: { dataType: "STRING", value: "" } },
});

const inputs = useNodeInputs();

/* 只接受一条连线，避免多份素材覆盖同一份存档 */
nodeEvent.on("canConnect", (connection, context) => {
  const edges = context.edges.filter(
    edge =>
      edge.source !== connection.source ||
      edge.sourceHandle !== connection.sourceHandle ||
      edge.target !== connection.target ||
      edge.targetHandle !== connection.targetHandle,
  );
  return getTargetValues(id, "in", context.nodes, [...edges, connection]).length <= 1;
});

/* ---------- 凭据：只存在本机浏览器 ---------- */
const KEY_STORAGE = "chequ.archive.credentials";
const accessKey = ref("");
const secretKey = ref("");
const keysVisible = ref(false);
const keyMessage = ref("");

function loadKeys() {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    accessKey.value = typeof parsed?.access === "string" ? parsed.access : "";
    secretKey.value = typeof parsed?.secret === "string" ? parsed.secret : "";
  } catch {
    /* 忽略损坏的本地数据 */
  }
}
loadKeys();
if (!accessKey.value) keysVisible.value = true;

function saveKeys() {
  const access = accessKey.value.trim();
  const secret = secretKey.value.trim();
  if (!access || !secret) {
    keyMessage.value = "两个密钥都要填写";
    return;
  }
  try {
    localStorage.setItem(KEY_STORAGE, JSON.stringify({ access, secret }));
    keyMessage.value = "已保存到本机浏览器";
    keysVisible.value = false;
  } catch {
    keyMessage.value = "浏览器禁止本地存储，无法保存";
  }
}

/* ---------- 素材来源：上游连线优先 ---------- */
const localSource = shallowRef<NodeMediaValue | undefined>();
const copying = ref(false);

const incoming = computed(() => inputs.getTargetValues(id, "in"));
const connected = computed(() => incoming.value.length > 0);

const source = computed<NodeMediaValue | undefined>(() => {
  const value = incoming.value[0];
  if (value?.value && typeof value.value === "object" && "url" in value.value) {
    return value.value as NodeMediaValue;
  }
  return localSource.value;
});

const ingestError = ref("");
const previewUrl = files.useFileUrl(source, error => {
  ingestError.value = readError(error, "素材读取失败");
});

const sourceMime = computed(() => source.value?.mimeType ?? "");
const isImage = computed(() => sourceMime.value.startsWith("image/"));
const isVideo = computed(() => sourceMime.value.startsWith("video/"));
const isAudio = computed(() => sourceMime.value.startsWith("audio/"));

const shortMime = computed(() => {
  const mime = sourceMime.value;
  if (!mime) return "";
  if (mime.startsWith("image/")) return "图片";
  if (mime.startsWith("video/")) return "视频";
  if (mime.startsWith("audio/")) return "音频";
  return "文件";
});

const sourceLabel = computed(() => {
  const url = source.value?.url;
  if (!url) return "";
  const name = decodeURIComponent(url.split(/[\\/]/).pop() ?? "");
  return name.replace(/^[0-9a-f-]{36}(?=\.[a-zA-Z0-9]+$)/i, "素材") || name;
});

const fileInput = ref<HTMLInputElement>();
const sourceSize = ref(0);

async function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!/^(image|video|audio)\//.test(file.type)) {
    ingestError.value = "只支持图片、视频或音频文件";
    return;
  }
  ingestError.value = "";
  copying.value = true;
  try {
    const path = await files.uploadFile(file);
    sourceSize.value = file.size;
    localSource.value = { url: path, mimeType: file.type };
    if (!title.value) title.value = file.name.replace(/\.[^.]+$/, "");
  } catch (error) {
    ingestError.value = readError(error, "文件写入工作区失败");
  } finally {
    copying.value = false;
  }
}

/* 上游素材大小未知，读 blob 时补上 */
watch(previewUrl, async url => {
  if (!url || sourceSize.value) return;
  try {
    const head = await fetch(url, { method: "HEAD" });
    const length = Number(head.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 0) sourceSize.value = length;
  } catch {
    /* 拿不到大小不影响上传 */
  }
});

/* ---------- 上传 ---------- */
/* 归档信息持久化在 node.data.archive，随画布一起保存 */
type ArchiveState = {
  identifier?: string;
  title?: string;
  description?: string;
  creator?: string;
  subject?: string;
  collection?: string;
  result?: { identifier: string; detailsUrl: string; downloadUrl: string } | null;
  archivedAt?: number;
};

const nodeData = node.data as typeof node.data & { archive?: ArchiveState };
const savedArchive = nodeData.archive;

const identifier = ref(savedArchive?.identifier ?? "");
const title = ref(savedArchive?.title ?? "");
const description = ref(savedArchive?.description ?? "");
const creator = ref(savedArchive?.creator ?? "");
const subject = ref(savedArchive?.subject ?? "");
const collection = ref(savedArchive?.collection ?? "opensource_media");
const moreVisible = ref(false);

function persistArchive() {
  nodeData.archive = {
    identifier: identifier.value,
    title: title.value,
    description: description.value,
    creator: creator.value,
    subject: subject.value,
    collection: collection.value,
    result: result.value,
    archivedAt: archivedAt.value,
  };
}

/* 字段改动即时落盘，退出项目再打开不丢 */
watch([identifier, title, description, creator, subject, collection], persistArchive);

/* 复制节点时带上归档信息 */
nodeEvent.on("copy", () => ({ archive: { ...(nodeData.archive ?? {}) } }));
const uploading = ref(false);
const percent = ref(0);
const errorMessage = ref("");
const result = shallowRef<{ identifier: string; detailsUrl: string; downloadUrl: string } | null>(savedArchive?.result ?? null);
const archivedAt = ref<number>(savedArchive?.archivedAt ?? 0);
const copied = ref(false);

async function copyLink() {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.detailsUrl);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    errorMessage.value = "浏览器拒绝写剪贴板，请手动复制";
  }
}

const canUpload = computed(() => Boolean(source.value?.url) && !uploading.value);

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function sanitizeIdentifier(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .slice(0, 100);
  if (cleaned.length >= 5) return cleaned;
  return `chequ-${timestamp()}`;
}

function guessMediatype(mimeType: string, fileName: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "movies";
  if (mimeType.startsWith("audio/")) return "audio";
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["mp4", "mov", "mkv", "webm", "avi"].includes(ext)) return "movies";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)) return "image";
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) return "audio";
  return "data";
}

const uri = (value: string) => `uri(${encodeURIComponent(value)})`;

/* 归档前的确认信息 */
const confirmVisible = ref(false);

const confirmInfo = computed(() => {
  const mimeType = source.value?.mimeType ?? "";
  const fileName = buildFileName(originalFileName.value, mimeType);
  const kindLabel = mimeType.startsWith("image/")
    ? "图片"
    : mimeType.startsWith("video/")
      ? "视频"
      : mimeType.startsWith("audio/")
        ? "音频"
        : "文件";
  const sizeText = sourceSize.value ? ` · ${formatSize(sourceSize.value)}` : "";
  return {
    title: title.value.trim() || fileName,
    identifier: identifier.value.trim() ? sanitizeIdentifier(identifier.value) : "（自动生成）",
    fileName,
    kind: `${kindLabel}${sizeText}`,
  };
});

function requestArchive() {
  if (!canUpload.value || !source.value) return;
  /* 已经归档过就不允许重复提交，避免在 archive.org 上留下多份重复条目 */
  if (result.value) {
    errorMessage.value =
      "该素材已经归档过，不能重复归档。如需重新归档，请点结果卡片里的「重新归档」，或更换上游素材。";
    return;
  }
  if (!accessKey.value.trim() || !secretKey.value.trim()) {
    keysVisible.value = true;
    errorMessage.value = "请先填写 archive.org 的 Access Key 与 Secret Key";
    return;
  }
  errorMessage.value = "";
  confirmVisible.value = true;
}

function confirmAndUpload() {
  confirmVisible.value = false;
  void startUpload();
}

async function startUpload() {
  if (!source.value || uploading.value) return;
  errorMessage.value = "";
  result.value = null;
  uploading.value = true;
  percent.value = 0;
  try {
    const response = await fetch(previewUrl.value);
    if (!response.ok) throw new Error(`读取素材失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    sourceSize.value = blob.size;

    /* 文件名要有信息量：标题 > 上游原始名 > 带时间戳的兜底
       注意不能用 previewUrl —— 那是 blob: URL，只有一串 UUID */
    const fileName = buildFileName(originalFileName.value, source.value.mimeType || blob.type);

    const itemId = identifier.value.trim() ? sanitizeIdentifier(identifier.value) : `chequ-${timestamp()}`;
    const mediatype = guessMediatype(source.value.mimeType || blob.type, fileName);
    const itemTitle = title.value.trim() || fileName;

    await putWithProgress(
      `https://s3.us.archive.org/${encodeURIComponent(itemId)}/${encodeURIComponent(fileName)}`,
      blob,
      {
        Authorization: `LOW ${accessKey.value.trim()}:${secretKey.value.trim()}`,
        "Content-Type": "application/octet-stream",
        "x-archive-auto-make-bucket": "1",
        "x-archive-size-hint": String(blob.size),
        "x-archive-keep-old-version": "1",
        ...buildMetaHeaders(itemTitle, mediatype),
        "x-archive-queue-derive": "1",
      },
    );

    const detailsUrl = `https://archive.org/details/${itemId}`;
    result.value = {
      identifier: itemId,
      detailsUrl,
      downloadUrl: `https://archive.org/download/${itemId}/${encodeURIComponent(fileName)}`,
    };
    archivedAt.value = Date.now();
    outputs.value.url.value = detailsUrl;
    persistArchive();
  } catch (error) {
    errorMessage.value = readError(error, "上传失败");
  } finally {
    uploading.value = false;
  }
}

function resetArchive() {
  result.value = null;
  archivedAt.value = 0;
  errorMessage.value = "";
  outputs.value.url.value = "";
  persistArchive();
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* 上游素材的原始文件名（来自 source.url，而不是预览用的 blob URL） */
const originalFileName = computed(() => {
  const url = source.value?.url ?? "";
  if (!url) return "";
  const withoutQuery = url.split("?")[0];
  const last = withoutQuery.split(/[\\/]/).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
});

function isUuidLike(name: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(name);
}

/** 去掉路径分隔符与文件系统保留字符，保留中文与空格 */
function sanitizeFileName(name: string) {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[-.\s]+/, "")
    .trim()
    .slice(0, 120);
}

function buildFileName(rawName: string, mimeType: string) {
  const extension = extensionFromMime(mimeType);
  const hasExtension = (value: string) => /\.[a-zA-Z0-9]{1,10}$/.test(value);

  /* 1) 用户填了标题就用标题 */
  const titleText = sanitizeFileName(title.value.trim());
  if (titleText) return hasExtension(titleText) ? titleText : `${titleText}${extension}`;

  /* 2) 上游原始文件名，排除 UUID 这种没有信息量的 */
  const original = sanitizeFileName(rawName);
  if (original && !isUuidLike(original)) {
    return hasExtension(original) ? original : `${original}${extension}`;
  }

  /* 3) 兜底：带时间戳，至少能区分不同批次 */
  return `chequ-${timestamp()}${extension || ".bin"}`;
}

function buildMetaHeaders(itemTitle: string, mediatype: string) {
  const headers: Record<string, string> = {
    "x-archive-meta-title": uri(itemTitle),
    "x-archive-meta-mediatype": uri(mediatype),
    "x-archive-meta-collection": uri(collection.value.trim() || "opensource_media"),
  };
  const descriptionText = description.value.trim();
  if (descriptionText) headers["x-archive-meta-description"] = uri(descriptionText);
  const creatorText = creator.value.trim();
  if (creatorText) headers["x-archive-meta-creator"] = uri(creatorText);
  const subjects = subject.value
    .split(/[,，]/)
    .map(item => item.trim())
    .filter(Boolean);
  if (subjects.length) headers["x-archive-meta-subject"] = uri(subjects.join(";"));
  return headers;
}

function putWithProgress(url: string, blob: Blob, headers: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) percent.value = Math.round((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        percent.value = 100;
        resolve();
        return;
      }
      if (xhr.status === 401 || xhr.status === 403) {
        reject(new Error("archive.org 拒绝了凭据，请检查 Access Key / Secret Key"));
        return;
      }
      reject(new Error(`archive.org 返回 HTTP ${xhr.status}：${(xhr.responseText || "").slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("网络中断，上传失败"));
    xhr.ontimeout = () => reject(new Error("上传超时"));
    xhr.timeout = 30 * 60 * 1000;
    xhr.send(blob);
  });
}

/* ---------- 工具函数 ---------- */
function extensionFromMime(mime: string) {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
  };
  return map[mime] ?? "";
}

function formatSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function readError(error: unknown, fallback: string) {
  const anyError = error as { message?: string; response?: { data?: { message?: string } } };
  return anyError?.response?.data?.message || anyError?.message || fallback;
}

/* 上游素材真的换了才清空结果；首次读取不算变化，避免冲掉上次的归档记录 */
let lastSourceUrl = "";
watch(
  () => source.value?.url ?? "",
  url => {
    if (!url) return;
    if (lastSourceUrl && lastSourceUrl !== url) {
      result.value = null;
      archivedAt.value = 0;
      errorMessage.value = "";
      sourceSize.value = 0;
      persistArchive();
    }
    lastSourceUrl = url;
  },
  { immediate: true },
);
</script>

<style scoped>
.archiveBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px;
}

.previewArea {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 132px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.12);
}

.previewMedia {
  max-width: 100%;
  max-height: 220px;
  display: block;
}

.audioPreview {
  width: 100%;
  padding: 0 10px;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 14px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  text-align: center;
}

.fileInfo {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.fileName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  gap: 8px;
  flex: none;
}

.mimeTag {
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(63, 194, 172, 0.16);
  color: #6fd7c4;
}

.progressArea {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.statusText {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.metaForm {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.metaRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.metaLabel {
  flex: none;
  width: 46px;
  padding-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.metaRow > :not(.metaLabel) {
  flex: 1;
  min-width: 0;
}

.moreToggle {
  align-self: flex-start;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: rgba(111, 215, 196, 0.85);
  font-size: 10px;
  line-height: 1.5;
  cursor: pointer;
  font-family: inherit;
}

.moreToggle:hover {
  text-decoration: underline;
}

.archiveButton {
  width: 100%;
}

/* 已归档后的按钮：仍然可点，点下去给出「不能重复归档」的提示 */
.archivedButton {
  --el-button-bg-color: rgba(63, 194, 172, 0.28);
  --el-button-border-color: rgba(63, 194, 172, 0.5);
  --el-button-text-color: #bfeee4;
  --el-button-hover-bg-color: rgba(63, 194, 172, 0.36);
  --el-button-hover-border-color: rgba(63, 194, 172, 0.6);
  --el-button-hover-text-color: #d8f7f0;
}

.archivedAt {
  margin: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.42);
}

.resetButton {
  align-self: flex-start;
  margin-top: 2px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.42);
  font-size: 10px;
  line-height: 1.6;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}

.resetButton:hover {
  color: #f0c0a0;
  text-decoration: underline;
}

.resultHead {
  display: flex;
  align-items: center;
  gap: 6px;
}

.copyButton {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid rgba(63, 194, 172, 0.4);
  border-radius: 999px;
  background: transparent;
  color: #6fd7c4;
  font-size: 10px;
  line-height: 1.6;
  cursor: pointer;
  font-family: inherit;
}

.copyButton:hover {
  background: rgba(63, 194, 172, 0.16);
}

.resultRow {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 10px;
}

.resultKey {
  flex: none;
  color: rgba(255, 255, 255, 0.4);
}

.resultSubLink {
  color: rgba(111, 215, 196, 0.8);
  word-break: break-all;
  text-decoration: none;
}

.resultSubLink:hover {
  text-decoration: underline;
}

.formHint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.resultArea {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(63, 194, 172, 0.1);
  border: 1px solid rgba(63, 194, 172, 0.28);
}

.resultLink {
  font-size: 11px;
  color: #6fd7c4;
  word-break: break-all;
  text-decoration: underline;
}

.resultHint {
  margin: 0;
  font-size: 10px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.45);
}

.errorMessage {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: #f0a0a0;
  background: rgba(220, 80, 80, 0.12);
}

.formCard {
  background: transparent;
}

.fieldRow + .fieldRow {
  margin-top: 8px;
}

.actionRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}

.keysArea {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.keysHint,
.keysMessage {
  margin: 0;
  font-size: 10px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.45);
}

.keysHint a {
  color: #6fd7c4;
}
</style>

<style>
/* 对话框 append-to-body，scoped 样式命中不了，单独用全局样式 */
.archiveConfirm .el-dialog__title {
  font-size: 15px;
  font-weight: 600;
}

.archiveConfirm .confirmBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.archiveConfirm .confirmRow {
  display: flex;
  gap: 10px;
  font-size: 12px;
  line-height: 1.7;
}

.archiveConfirm .confirmKey {
  flex: none;
  width: 56px;
  color: var(--el-text-color-secondary);
}

.archiveConfirm .confirmValue {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  color: var(--el-text-color-primary);
}

.archiveConfirm .confirmValue.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.archiveConfirm .confirmWarning {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
}
</style>
