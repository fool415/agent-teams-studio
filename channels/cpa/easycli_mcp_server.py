import base64
import json
import mimetypes
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid

# Ensure UTF-8 for stdio on Windows
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = (
    os.environ.get("EASYCLI_BASE_URL")
    or os.environ.get("CPA_BASE_URL")
    or "http://127.0.0.1:8317/v1"
).rstrip("/")
EXPLICIT_API_KEY = os.environ.get("EASYCLI_API_KEY") or os.environ.get("CPA_API_KEY")
API_KEYS = (
    [EXPLICIT_API_KEY]
    if EXPLICIT_API_KEY
    else ["sk-cliproxyapi-master-key", "123456"]
)
DEFAULT_TEXT_MODEL = os.environ.get("EASYCLI_DEFAULT_MODEL") or "gpt-6-astra"
DEFAULT_IMAGE_MODEL = os.environ.get("EASYCLI_DEFAULT_IMAGE_MODEL") or "gpt-image-1.5"
DEFAULT_IMAGE_DIR = os.environ.get("EASYCLI_IMAGE_OUTPUT_DIR") or os.path.join(
    os.path.expanduser("~"), "Pictures", "easycli-images"
)
PREFERRED_IMAGE_MODELS = [
    "gpt-image-2.6",
    "gpt-image-2.5",
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-2.6-flare",
    "gpt-image-2.5-flare",
    "grok-imagine-image-2.0",
    "grok-imagine-image",
    "gemini-3-pro-image",
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image",
]
MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MiB per inline MCP image block

DATA_URL_RE = re.compile(
    r"data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)"
)


def send_response(response):
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def make_text_result(text, is_error=False):
    return {
        "content": [{"type": "text", "text": text}],
        "isError": is_error,
    }


def is_image_model(model_name):
    if not model_name:
        return False
    lower = model_name.strip().lower()
    if "/" in lower:
        lower = lower.rsplit("/", 1)[-1]
    return (
        lower.startswith("gpt-image-")
        or lower.startswith("dall-e-")
        or lower.startswith("imagen-")
        or lower.startswith("grok-imagine-image")
        or lower.endswith("-image")
        or lower.endswith("-image-preview")
    )


def detect_image_format(data, fallback_ext="png"):
    """Detect image extension, MIME type, and (width, height) from raw bytes."""
    ext = fallback_ext.lower().lstrip(".") or "png"
    if ext == "jpg":
        ext = "jpeg"
    mime = f"image/{ext}"
    dims = None

    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        ext, mime = "png", "image/png"
        dims = struct.unpack(">II", data[16:24])
    elif data.startswith(b"\xff\xd8\xff"):
        ext, mime = "jpeg", "image/jpeg"
        dims = _parse_jpeg_size(data)
    elif len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        ext, mime = "webp", "image/webp"
        dims = _parse_webp_size(data)
    elif data.startswith((b"GIF87a", b"GIF89a")) and len(data) >= 10:
        ext, mime = "gif", "image/gif"
        dims = struct.unpack("<HH", data[6:10])

    return ext, mime, dims


def _parse_jpeg_size(data):
    idx = 2
    n = len(data)
    while idx + 4 < n:
        if data[idx] != 0xFF:
            idx += 1
            continue
        marker = data[idx + 1]
        if marker in (0xD8, 0xD9, 0x00) or (0xD0 <= marker <= 0xD7):
            idx += 2
            continue
        seg_len = struct.unpack(">H", data[idx + 2 : idx + 4])[0]
        if seg_len < 2 or idx + 2 + seg_len > n:
            break
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if idx + 9 <= n:
                h, w = struct.unpack(">HH", data[idx + 5 : idx + 9])
                return (w, h)
            break
        idx += 2 + seg_len
    return None


def _parse_webp_size(data):
    if len(data) < 30:
        return None
    chunk = data[12:16]
    if chunk == b"VP8 " and len(data) >= 30:
        w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        return (w, h)
    if chunk == b"VP8L" and len(data) >= 25:
        b0, b1, b2, b3 = data[21:25]
        w = 1 + (((b1 & 0x3F) << 8) | b0)
        h = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
        return (w, h)
    if chunk == b"VP8X" and len(data) >= 30:
        w = 1 + int.from_bytes(data[24:27], "little")
        h = 1 + int.from_bytes(data[27:30], "little")
        return (w, h)
    return None


def _request_with_auth(path, body=None, headers=None, timeout=180, method=None):
    """Send HTTP request to EasyCLIProxyAPI with auth fallback on HTTP 401."""
    url = f"{BASE_URL}{path}"
    base_headers = dict(headers or {})
    last_http_err = None

    for idx, api_key in enumerate(API_KEYS):
        req_headers = dict(base_headers)
        req_headers["Authorization"] = f"Bearer {api_key}"
        req = urllib.request.Request(
            url, data=body, headers=req_headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw), None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            last_http_err = (e.code, err_body)
            if e.code == 401 and idx + 1 < len(API_KEYS):
                continue
            return None, (e.code, err_body)
        except urllib.error.URLError as e:
            return None, (
                None,
                f"无法连接本地 EasyCLIProxyAPI ({BASE_URL}): {e.reason}。请确认 CLIProxyAPI / EasyCLIProxyAPI 已启动。",
            )
        except Exception as e:
            return None, (None, f"请求 EasyCLIProxyAPI 失败: {str(e)}")

    return None, last_http_err


def _fetch_model_ids():
    data, err = _request_with_auth("/models", timeout=10)
    if err is not None:
        return None, err
    return [m.get("id") for m in data.get("data", []) if m.get("id")], None


def _resolve_save_path(output_path, index, total, ext, prefix="easycli"):
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    unique = uuid.uuid4().hex[:6]
    default_name = f"{prefix}_{timestamp}_{index + 1}_{unique}.{ext}"

    if not output_path:
        os.makedirs(DEFAULT_IMAGE_DIR, exist_ok=True)
        return os.path.join(DEFAULT_IMAGE_DIR, default_name)

    expanded = os.path.abspath(os.path.expanduser(output_path))
    is_dir_hint = (
        output_path.endswith(("/", "\\"))
        or os.path.isdir(expanded)
        or not os.path.splitext(expanded)[1]
    )
    if is_dir_hint:
        os.makedirs(expanded, exist_ok=True)
        return os.path.join(expanded, default_name)

    parent = os.path.dirname(expanded)
    if parent:
        os.makedirs(parent, exist_ok=True)
    if total <= 1:
        return expanded
    stem, user_ext = os.path.splitext(expanded)
    final_ext = user_ext or f".{ext}"
    return f"{stem}_{index + 1}{final_ext}"


def _download_image_bytes(url):
    if url.startswith("data:"):
        match = DATA_URL_RE.search(url)
        if not match:
            raise ValueError("无法解析 data:image URL")
        b64_clean = re.sub(r"\s+", "", match.group(2))
        return base64.b64decode(b64_clean)
    req = urllib.request.Request(url, headers={"User-Agent": "easycli-gpt-mcp/1.1"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def _format_error(err, action_label):
    code, detail = err
    if code is None:
        return detail
    return f"{action_label}失败 (HTTP {code}): {detail}"


def _materialize_image_items(
    items,
    model_used,
    output_path=None,
    fallback_ext="png",
    include_image_content=True,
    prefix="easycli",
):
    saved_lines = []
    image_blocks = []
    total = len(items)

    for idx, item in enumerate(items):
        raw_bytes = None
        if item.get("b64_json"):
            raw_bytes = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            raw_bytes = _download_image_bytes(item["url"])

        if not raw_bytes:
            continue

        ext, mime, dims = detect_image_format(raw_bytes, fallback_ext=fallback_ext)
        save_path = _resolve_save_path(output_path, idx, total, ext, prefix=prefix)
        with open(save_path, "wb") as f:
            f.write(raw_bytes)

        dim_str = f"{dims[0]}x{dims[1]}" if dims else "未知尺寸"
        size_kb = len(raw_bytes) / 1024.0
        line = f"- 图片 {idx + 1}: {save_path} ({mime}, {dim_str}, {size_kb:.1f} KB)"
        if item.get("revised_prompt"):
            line += f"\n  提示词润色: {item['revised_prompt']}"
        saved_lines.append(line)

        if include_image_content and len(raw_bytes) <= MAX_INLINE_IMAGE_BYTES:
            image_blocks.append(
                {
                    "type": "image",
                    "data": base64.b64encode(raw_bytes).decode("ascii"),
                    "mimeType": mime,
                }
            )
        elif include_image_content and len(raw_bytes) > MAX_INLINE_IMAGE_BYTES:
            saved_lines.append("  （文件超过 10 MiB，已跳过内联预览，请直接读取上述本地文件）")

    if not saved_lines:
        return make_text_result("接口未返回有效的图片数据。", is_error=True)

    header = f"生图完成（模型: {model_used}，共 {len(saved_lines)} 张）：\n"
    content = [{"type": "text", "text": header + "\n".join(saved_lines)}]
    content.extend(image_blocks)
    return {"content": content, "isError": False}


def _should_fallback_image_model(err):
    code, detail = err
    if code not in (400, 404):
        return False
    low = (detail or "").lower()
    return any(
        kw in low
        for kw in ("model_not_found", "unknown provider", "does not exist", "unsupported model", "not found")
    )


def call_image_generation(
    prompt,
    model=None,
    output_path=None,
    size=None,
    quality=None,
    n=1,
    background=None,
    output_format="png",
    include_image_content=True,
):
    if not prompt or not str(prompt).strip():
        return make_text_result("生图失败: prompt 不能为空。", is_error=True)

    explicit_model = bool(model and str(model).strip())
    chosen_model = str(model).strip() if explicit_model else DEFAULT_IMAGE_MODEL

    payload = {
        "model": chosen_model,
        "prompt": str(prompt),
    }
    if n is not None:
        payload["n"] = max(1, min(int(n), 4))
    if size:
        payload["size"] = str(size)
    if quality:
        payload["quality"] = str(quality)
    if background:
        payload["background"] = str(background)
    if output_format:
        payload["output_format"] = str(output_format).lower()

    data, err = _request_with_auth(
        "/images/generations",
        body=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        timeout=300,
    )

    if err is not None and not explicit_model and _should_fallback_image_model(err):
        models, m_err = _fetch_model_ids()
        if m_err is None and models:
            available = [m for m in models if is_image_model(m)]
            ordered = [m for m in PREFERRED_IMAGE_MODELS if m in available] + [
                m for m in available if m not in PREFERRED_IMAGE_MODELS
            ]
            for cand in ordered:
                if cand == chosen_model:
                    continue
                payload["model"] = cand
                data, err = _request_with_auth(
                    "/images/generations",
                    body=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    timeout=300,
                )
                if err is None:
                    chosen_model = cand
                    break

    if err is not None:
        return make_text_result(_format_error(err, "生图"), is_error=True)

    items = data.get("data") or []
    return _materialize_image_items(
        items,
        model_used=chosen_model,
        output_path=output_path,
        fallback_ext=output_format or "png",
        include_image_content=include_image_content,
        prefix="easycli_gen",
    )


def _encode_multipart_formdata(fields, files):
    boundary = f"----EasyCLIMCPBoundary{uuid.uuid4().hex}"
    chunks = []
    for name, value in fields:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8")
        )
        chunks.append(f"{value}\r\n".encode("utf-8"))

    for field_name, filename, content_type, data_bytes in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode(
                "utf-8"
            )
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(data_bytes)
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def call_image_edit(
    prompt,
    image_paths,
    mask_path=None,
    model=None,
    output_path=None,
    size=None,
    quality=None,
    n=1,
    background=None,
    output_format="png",
    include_image_content=True,
):
    if not prompt or not str(prompt).strip():
        return make_text_result("改图失败: prompt 不能为空。", is_error=True)

    if isinstance(image_paths, str):
        image_paths = [image_paths]
    if not image_paths:
        return make_text_result("改图失败: 请至少提供一张输入图片路径 (image_paths)。", is_error=True)

    chosen_model = str(model).strip() if model and str(model).strip() else DEFAULT_IMAGE_MODEL
    files = []
    image_field = "image" if len(image_paths) == 1 else "image[]"

    for raw_path in image_paths:
        abs_path = os.path.abspath(os.path.expanduser(raw_path))
        if not os.path.isfile(abs_path):
            return make_text_result(f"改图失败: 找不到输入图片 {abs_path}", is_error=True)
        with open(abs_path, "rb") as f:
            img_bytes = f.read()
        _, mime, _ = detect_image_format(img_bytes)
        guessed_mime = mimetypes.guess_type(abs_path)[0]
        content_type = mime if mime != "image/png" or guessed_mime is None else guessed_mime
        files.append((image_field, os.path.basename(abs_path), content_type, img_bytes))

    if mask_path:
        abs_mask = os.path.abspath(os.path.expanduser(mask_path))
        if not os.path.isfile(abs_mask):
            return make_text_result(f"改图失败: 找不到蒙版图片 {abs_mask}", is_error=True)
        with open(abs_mask, "rb") as f:
            mask_bytes = f.read()
        _, mask_mime, _ = detect_image_format(mask_bytes)
        files.append(("mask", os.path.basename(abs_mask), mask_mime, mask_bytes))

    fields = [
        ("model", chosen_model),
        ("prompt", str(prompt)),
    ]
    if n is not None:
        fields.append(("n", str(max(1, min(int(n), 4)))))
    if size:
        fields.append(("size", str(size)))
    if quality:
        fields.append(("quality", str(quality)))
    if background:
        fields.append(("background", str(background)))
    if output_format:
        fields.append(("output_format", str(output_format).lower()))

    body, content_type_header = _encode_multipart_formdata(fields, files)
    data, err = _request_with_auth(
        "/images/edits",
        body=body,
        headers={"Content-Type": content_type_header},
        timeout=300,
    )
    if err is not None:
        return make_text_result(_format_error(err, "改图"), is_error=True)

    items = data.get("data") or []
    return _materialize_image_items(
        items,
        model_used=chosen_model,
        output_path=output_path,
        fallback_ext=output_format or "png",
        include_image_content=include_image_content,
        prefix="easycli_edit",
    )


def _extract_chat_images_and_text(message):
    text_parts = []
    image_items = []
    content = message.get("content")

    if isinstance(content, str):
        text_parts.append(content)
        for match in DATA_URL_RE.finditer(content):
            b64_clean = re.sub(r"\s+", "", match.group(2))
            image_items.append({"b64_json": b64_clean})
    elif isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")
            if ptype in ("text", "output_text") and part.get("text"):
                text_parts.append(part["text"])
            elif ptype == "image_url":
                img_obj = part.get("image_url") or {}
                url = img_obj.get("url") if isinstance(img_obj, dict) else None
                if url:
                    image_items.append({"url": url})
            elif ptype == "image" and part.get("b64_json"):
                image_items.append({"b64_json": part["b64_json"]})

    for img in message.get("images") or []:
        if isinstance(img, dict):
            if img.get("b64_json"):
                image_items.append({"b64_json": img["b64_json"]})
            elif img.get("url"):
                image_items.append({"url": img["url"]})
            elif isinstance(img.get("image_url"), dict) and img["image_url"].get("url"):
                image_items.append({"url": img["image_url"]["url"]})

    return "\n".join(text_parts), image_items


def call_openai_chat(prompt, model=DEFAULT_TEXT_MODEL, system_prompt=None):
    if is_image_model(model):
        return call_image_generation(prompt=prompt, model=model)

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
    }
    data, err = _request_with_auth(
        "/chat/completions",
        body=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        timeout=180,
    )
    if err is not None:
        return make_text_result(_format_error(err, "调用 GPT 代理"), is_error=True)

    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return make_text_result(
            f"代理返回格式异常: {json.dumps(data, ensure_ascii=False)}",
            is_error=True,
        )

    text_out, image_items = _extract_chat_images_and_text(message)
    if not image_items:
        return make_text_result(text_out)

    img_res = _materialize_image_items(
        image_items,
        model_used=model,
        prefix="easycli_chat",
    )
    combined_content = []
    if text_out.strip():
        combined_content.append({"type": "text", "text": text_out})
    combined_content.extend(img_res.get("content", []))
    return {"content": combined_content, "isError": img_res.get("isError", False)}


def list_models():
    models, err = _fetch_model_ids()
    if err is not None:
        return make_text_result(_format_error(err, "获取模型列表"), is_error=True)

    image_models = [m for m in models if is_image_model(m)]
    lines = ["当前 EasyCLIProxyAPI 可用模型列表："]
    lines.extend(f"- {m}" for m in models)
    if image_models:
        lines.append("")
        lines.append("其中支持生图/改图的模型：")
        lines.extend(f"- {m}" for m in image_models)
    return make_text_result("\n".join(lines))


TOOLS = [
    {
        "name": "ask_gpt",
        "description": "向本地 EasyCLIProxyAPI 运行的模型提问、发送代码或请求生成内容（若传入 gpt-image-* 等生图模型会自动路由至生图接口）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "要发送给模型的具体问题或指令",
                },
                "model": {
                    "type": "string",
                    "description": "可选模型名称（例如 gpt-6-astra, gpt-6.1-sol, gpt-5.6-terra 等），默认 gpt-6-astra",
                },
                "system_prompt": {
                    "type": "string",
                    "description": "可选系统设定",
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "generate_image",
        "description": "使用本地 EasyCLIProxyAPI (/v1/images/generations) 根据文本提示词生成图片，自动保存到本地并返回路径与图片预览。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "生图提示词（描述画面内容、风格、构图、光线等）",
                },
                "model": {
                    "type": "string",
                    "description": "可选生图模型名称（如 gpt-image-1.5, gpt-image-2, gpt-image-2.5, gpt-image-2.6, grok-imagine-image 等），默认 gpt-image-1.5",
                },
                "output_path": {
                    "type": "string",
                    "description": "可选保存路径（文件或目录）；留空则自动保存至用户图片目录 ~/Pictures/easycli-images",
                },
                "size": {
                    "type": "string",
                    "description": "可选输出尺寸（如 1024x1024, 1024x1536, 1536x1024, auto）",
                },
                "quality": {
                    "type": "string",
                    "description": "可选画质（low, medium, high, auto）",
                },
                "n": {
                    "type": "integer",
                    "description": "可选生成数量（1~4，默认 1）",
                    "minimum": 1,
                    "maximum": 4,
                },
                "background": {
                    "type": "string",
                    "description": "可选背景模式（transparent, opaque, auto）",
                },
                "output_format": {
                    "type": "string",
                    "description": "可选图片格式（png, jpeg, webp，默认 png）",
                },
                "include_image_content": {
                    "type": "boolean",
                    "description": "是否在返回中附带 MCP 图片内联预览（默认 true）",
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "edit_image",
        "description": "使用本地 EasyCLIProxyAPI (/v1/images/edits) 基于参考图或蒙版执行图生图/局部重绘/图片编辑，并保存结果到本地。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "改图或图生图提示词",
                },
                "image_paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "输入参考图片的本地文件路径列表",
                },
                "image_path": {
                    "type": "string",
                    "description": "单张参考图片的本地文件路径（与 image_paths 二选一）",
                },
                "mask_path": {
                    "type": "string",
                    "description": "可选蒙版图片路径（PNG 透明区域表示重绘区域）",
                },
                "model": {
                    "type": "string",
                    "description": "可选生图/改图模型名称，默认 gpt-image-1.5",
                },
                "output_path": {
                    "type": "string",
                    "description": "可选保存路径（文件或目录）；留空则自动保存至 ~/Pictures/easycli-images",
                },
                "size": {
                    "type": "string",
                    "description": "可选输出尺寸（如 1024x1024, 1024x1536, 1536x1024, auto）",
                },
                "quality": {
                    "type": "string",
                    "description": "可选画质（low, medium, high, auto）",
                },
                "n": {
                    "type": "integer",
                    "description": "可选生成数量（1~4，默认 1）",
                    "minimum": 1,
                    "maximum": 4,
                },
                "background": {
                    "type": "string",
                    "description": "可选背景模式（transparent, opaque, auto）",
                },
                "output_format": {
                    "type": "string",
                    "description": "可选图片格式（png, jpeg, webp，默认 png）",
                },
                "include_image_content": {
                    "type": "boolean",
                    "description": "是否在返回中附带 MCP 图片内联预览（默认 true）",
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "list_available_gpt_models",
        "description": "获取本地 EasyCLIProxyAPI 当前所有在线、可用的文本与生图模型名称列表。",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
]


def handle_tool_call(tool_name, arguments):
    if tool_name == "ask_gpt":
        prompt = arguments.get("prompt", "")
        model = arguments.get("model") or DEFAULT_TEXT_MODEL
        system_prompt = arguments.get("system_prompt")
        return call_openai_chat(prompt, model, system_prompt)

    if tool_name == "generate_image":
        return call_image_generation(
            prompt=arguments.get("prompt", ""),
            model=arguments.get("model"),
            output_path=arguments.get("output_path"),
            size=arguments.get("size"),
            quality=arguments.get("quality"),
            n=arguments.get("n", 1),
            background=arguments.get("background"),
            output_format=arguments.get("output_format", "png"),
            include_image_content=arguments.get("include_image_content", True),
        )

    if tool_name == "edit_image":
        image_paths = arguments.get("image_paths")
        if not image_paths and arguments.get("image_path"):
            image_paths = [arguments["image_path"]]
        return call_image_edit(
            prompt=arguments.get("prompt", ""),
            image_paths=image_paths or [],
            mask_path=arguments.get("mask_path"),
            model=arguments.get("model"),
            output_path=arguments.get("output_path"),
            size=arguments.get("size"),
            quality=arguments.get("quality"),
            n=arguments.get("n", 1),
            background=arguments.get("background"),
            output_format=arguments.get("output_format", "png"),
            include_image_content=arguments.get("include_image_content", True),
        )

    if tool_name == "list_available_gpt_models":
        return list_models()

    return None


def handle_message(msg):
    method = msg.get("method")
    msg_id = msg.get("id")

    if method == "initialize":
        send_response(
            {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": "easycli-gpt-mcp",
                        "version": "1.1.0",
                    },
                },
            }
        )
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send_response(
            {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"tools": TOOLS},
            }
        )
    elif method == "tools/call":
        params = msg.get("params", {})
        tool_name = params.get("name")
        arguments = params.get("arguments") or {}
        result = handle_tool_call(tool_name, arguments)
        if result is not None:
            send_response(
                {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": result,
                }
            )
        else:
            send_response(
                {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "error": {
                        "code": -32601,
                        "message": f"Tool not found: {tool_name}",
                    },
                }
            )
    elif method == "ping":
        send_response({"jsonrpc": "2.0", "id": msg_id, "result": {}})
    elif method in ("prompts/list", "resources/list"):
        key = method.split("/")[0]
        send_response({"jsonrpc": "2.0", "id": msg_id, "result": {key: []}})
    else:
        if msg_id is not None:
            send_response(
                {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not supported: {method}",
                    },
                }
            )


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = None
        try:
            msg = json.loads(line)
            handle_message(msg)
        except Exception as e:
            if isinstance(msg, dict) and msg.get("id") is not None:
                send_response(
                    {
                        "jsonrpc": "2.0",
                        "id": msg.get("id"),
                        "error": {
                            "code": -32603,
                            "message": f"Internal error: {str(e)}",
                        },
                    }
                )


if __name__ == "__main__":
    main()
