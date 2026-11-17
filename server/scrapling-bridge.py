#!/usr/bin/env python3
"""
Safe Scrapling bridge for AgentTeams Studio sandbox tools.
Reads JSON parameters from stdin and outputs clean JSON result to stdout.
Enforces protocol checks and SSRF protection against local/private networks.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import socket
import sys
from typing import Any
from urllib.parse import urlparse

DEFAULT_CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


FAKE_IP_NET = ipaddress.ip_network("198.18.0.0/15")


def _is_blocked_ip(ip_str: str, allow_fake_ip: bool = False) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    if allow_fake_ip and isinstance(ip, ipaddress.IPv4Address) and ip in FAKE_IP_NET:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _validate_public_url(raw_url: str) -> str:
    url = str(raw_url or "").strip()
    if not url:
        raise ValueError("url 不能为空")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"安全拦截：仅允许 http/https 协议 ({parsed.scheme})")
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("无效 URL：缺少主机名")
    if hostname in ("localhost", "ip6-localhost") or hostname.endswith((".local", ".internal", ".localhost")):
        raise ValueError(f"安全拦截：禁止访问本地/内网主机名 ({hostname})")

    # Check literal IP first
    literal_ip = None
    try:
        literal_ip = ipaddress.ip_address(hostname)
    except ValueError:
        literal_ip = None

    if literal_ip is not None:
        if _is_blocked_ip(str(literal_ip)):
            raise ValueError(f"安全拦截：禁止访问内网或回环 IP ({hostname})")
    else:
        try:
            infos = socket.getaddrinfo(hostname, None)
        except socket.gaierror as dns_err:
            raise ValueError(f"DNS 解析失败 ({hostname}): {dns_err}") from dns_err
        for info in infos:
            addr = info[4][0]
            # Strip IPv6 zone id if present
            addr_clean = addr.split("%")[0]
            if _is_blocked_ip(addr_clean, allow_fake_ip=True):
                raise ValueError(f"安全拦截：域名解析指向受保护内网 IP ({hostname} -> {addr_clean})")

    return url


def _extract_markdown(page: Any, css_selector: str | None) -> tuple[str, str]:
    from markdownify import markdownify as to_markdown

    title_sel = page.css("title::text")
    title = title_sel.get() if hasattr(title_sel, "get") else ""
    title = str(title or "").strip()

    target_html = ""
    if css_selector:
        matched = page.css(css_selector)
        if matched:
            parts: list[str] = []
            for node in matched[:20]:
                html_frag = getattr(node, "html_content", None)
                if html_frag:
                    parts.append(str(html_frag))
                else:
                    parts.append(str(node))
            target_html = "\n".join(parts)
    else:
        body = page.css("body")
        if body and len(body) > 0:
            target_html = str(getattr(body[0], "html_content", None) or page.html_content or "")
        else:
            target_html = str(getattr(page, "html_content", "") or "")

    if not target_html:
        return title, ""

    markdown = to_markdown(target_html, strip=["script", "style", "noscript", "svg"]).strip()
    # Collapse excessive blank lines
    lines = [line.rstrip() for line in markdown.splitlines()]
    compact_lines: list[str] = []
    blank_streak = 0
    for line in lines:
        if line == "":
            blank_streak += 1
            if blank_streak <= 2:
                compact_lines.append("")
        else:
            blank_streak = 0
            compact_lines.append(line)
    return title, "\n".join(compact_lines).strip()


def main() -> int:
    # Silence third-party scrapling info logs on stdout so stdout remains pure JSON
    logging.disable(logging.WARNING)
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print(json.dumps({"ok": False, "error": "缺少输入参数"}, ensure_ascii=False))
        return 1

    try:
        payload = json.loads(raw_input)
        url = _validate_public_url(payload.get("url", ""))
        mode = str(payload.get("mode") or "fast").strip().lower()
        if mode not in ("fast", "stealth"):
            mode = "fast"
        css_selector = str(payload.get("cssSelector") or "").strip() or None
        max_chars = int(payload.get("maxChars") or 8000)
        max_chars = max(500, min(max_chars, 32000))

        # Redirect any stray stdout prints inside scrapling fetchers to stderr
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            if mode == "stealth":
                from scrapling.fetchers import StealthyFetcher

                exec_path = os.environ.get("SCRAPLING_CHROME_PATH", DEFAULT_CHROME_PATH)
                kwargs: dict[str, Any] = {"headless": True, "disable_resources": True}
                if os.path.exists(exec_path):
                    kwargs["executable_path"] = exec_path
                page = StealthyFetcher.fetch(url, **kwargs)
            else:
                from scrapling.fetchers import Fetcher

                page = Fetcher.get(url, stealthy_headers=True, timeout=15)
        finally:
            sys.stdout = old_stdout

        title, content = _extract_markdown(page, css_selector)
        truncated = len(content) > max_chars
        result = {
            "ok": True,
            "url": url,
            "status": int(getattr(page, "status", 0) or 0),
            "mode": mode,
            "title": title,
            "content": content[:max_chars],
            "totalChars": len(content),
            "truncated": truncated,
        }
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(err)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
