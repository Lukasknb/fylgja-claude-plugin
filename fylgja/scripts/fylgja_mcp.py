#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = ["fastmcp>=3.0", "py-key-value-aio[disk]"]
# ///
"""Thin CLI bridge between the Fylgja plugin hooks and the Fylgja MCP server.

Commands:
    login                                        one-time interactive OAuth (opens a browser)
    context REPO [SESSION_ID] [HOSTNAME] [CWD]   the repo's operational-memory bucket
    precheck COMMAND                             hazard facts matching a shell command
    remember JSON                                store one fact (JSON kwargs for fylgja_remember)

Hooks run non-interactively: without a cached OAuth token the script prints
nothing and exits 0 (fail-open) instead of popping a browser mid-session.
Auth reuses the server's OAuthProxy via fastmcp's OAuth client (DCR +
authorization-code flow). fastmcp 3.x keeps tokens in memory by default, so
a DiskStore under ~/.config/fylgja/mcp-tokens makes the one-time `login`
persist for every later hook invocation.

Env knobs: FYLGJA_MCP_URL, FYLGJA_TOKEN_DIR, FYLGJA_CONTEXT_LIMIT (default 15).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from fastmcp import Client
from fastmcp.client.auth import OAuth
from key_value.aio.stores.disk import DiskStore

MCP_URL = os.environ.get("FYLGJA_MCP_URL", "https://fylgja.lknblab.dev/mcp")
TOKEN_DIR = Path(os.environ.get("FYLGJA_TOKEN_DIR", "~/.config/fylgja/mcp-tokens")).expanduser()
CONTEXT_LIMIT = int(os.environ.get("FYLGJA_CONTEXT_LIMIT", "15"))

RITUAL = (
    "Fylgja operational facts below are authoritative for this repo's prod/deploy/CLI knowledge: "
    "consult them before re-deriving commands or procedures. Facts marked verify_before_relying are "
    "claims — verify against source-of-truth before trusting. When you resolve an error, receive a "
    "user correction, find a root cause, or re-derive a command that should have been known, call "
    "the fylgja_remember MCP tool immediately (syntax-exact command in content, trigger keywords set). "
    "Facts listed here are ALREADY stored — to re-confirm one, call fylgja_remember with its id as "
    "recalled_atom_id instead of re-saving it."
)


def _token_cache_present() -> bool:
    """An empty token dir means `login` never ran — hooks bail out silently."""
    return TOKEN_DIR.is_dir() and any(TOKEN_DIR.iterdir())


def _oauth() -> OAuth:
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_DIR.chmod(0o700)
    return OAuth(MCP_URL, token_storage=DiskStore(directory=TOKEN_DIR), client_name="fylgja-hooks")


async def _call(tool: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    async with Client(MCP_URL, auth=_oauth()) as client:
        result = await client.call_tool(tool, arguments)
    data = getattr(result, "data", None) or getattr(result, "structured_content", None)
    if isinstance(data, dict):
        return data
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
    return None


def _fmt_fact(fact: dict[str, Any]) -> str:
    flags = [str(fact.get("type", "fact")), str(fact.get("staleness", ""))]
    verified = fact.get("last_verified")
    if verified:
        flags.append(f"verified {str(verified)[:10]}")
    line = f"- [id {str(fact.get('id', ''))[:8]} | {' | '.join(f for f in flags if f)}] {fact.get('content', '')}"
    detail = fact.get("detail")
    if detail:
        line += f"\n  {detail}"
    return line


def _provenance_line(session_id: str, hostname: str, cwd: str) -> str:
    parts = [p for p in ((("session_id", session_id)), ("hostname", hostname), ("cwd", cwd)) if p[1]]
    if not parts:
        return ""
    rendered = ", ".join(f"{k}={v}" for k, v in parts)
    return (
        f"\nProvenance for this session — pass these on EVERY fylgja_remember call: {rendered}. "
        "This files facts into the per-session container instead of the eternal husk document.\n"
    )


def _print_context(data: dict[str, Any], repo: str, session_id: str, hostname: str, cwd: str) -> None:
    facts = data.get("facts") or []
    if not facts:
        return
    print(f"## Fylgja operational memory — {repo}\n")
    print(RITUAL)
    print(_provenance_line(session_id, hostname, cwd))
    print("\n".join(_fmt_fact(f) for f in facts))


def _print_precheck(data: dict[str, Any]) -> None:
    matches = data.get("matches") or []
    if not matches:
        return
    print("Fylgja operational memory — stored hazards matching this command (verify staleness bands):")
    print("\n".join(_fmt_fact(m) for m in matches))


async def _login() -> None:
    async with Client(MCP_URL, auth=_oauth()) as client:
        await client.ping()
        tools = await client.list_tools()
    print(f"authenticated against {MCP_URL}; {len(tools)} tools visible")


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    command, args = argv[0], argv[1:]

    if command == "login":
        asyncio.run(_login())
        return 0

    # Hook mode: never block a session on auth or network problems.
    if not _token_cache_present():
        return 0
    try:
        if command == "context":
            repo = args[0]
            session_id = args[1] if len(args) > 1 else ""
            hostname = args[2] if len(args) > 2 else ""
            cwd = args[3] if len(args) > 3 else ""
            data = asyncio.run(_call("fylgja_context", {"repo": repo, "limit": CONTEXT_LIMIT}))
            if data:
                _print_context(data, repo, session_id, hostname, cwd)
        elif command == "precheck":
            data = asyncio.run(_call("fylgja_precheck", {"command": args[0]}))
            if data:
                _print_precheck(data)
        elif command == "remember":
            data = asyncio.run(_call("fylgja_remember", json.loads(args[0])))
            print(json.dumps(data, indent=2))
        else:
            print(f"unknown command: {command}", file=sys.stderr)
            return 2
    except Exception as exc:  # noqa: BLE001 — hooks must fail open, never crash a session
        print(f"fylgja_mcp: {exc}", file=sys.stderr)
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
