"""E2E real-prompt harness — populates the dashboard with authentic traffic.

Fires 15 Mistral calls split between:
  - short factual replies (max_tokens=30)
  - medium explanations (max_tokens=200)
  - tool-call requests that exercise the proxy's extractToolCalls path

Requires MISTRAL_API_KEY in env. Caps each call at max_tokens to prevent runaway
output; total expected spend on mistral-small-latest is well under $0.01.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

PROXY = os.environ.get("AIRELAY_URL", "http://localhost:3000/proxy/v1/chat/completions")
KEY = os.environ.get("MISTRAL_API_KEY")
if not KEY:
    print("ERROR: MISTRAL_API_KEY not set", file=sys.stderr)
    sys.exit(2)

MODEL = "mistral-small-latest"

WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name"},
                "units": {"type": "string", "enum": ["celsius", "fahrenheit"]},
            },
            "required": ["city"],
        },
    },
}

CALC_TOOL = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": "Evaluate a math expression",
        "parameters": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    },
}

# (label, body) — kept compact; each prompt deliberately scoped.
PROMPTS = [
    # ── Short factual (5) ──
    ("short:capital", {"max_tokens": 30, "messages": [
        {"role": "user", "content": "Capital of France? One word."}]}),
    ("short:planets", {"max_tokens": 30, "messages": [
        {"role": "user", "content": "How many planets in our solar system?"}]}),
    ("short:math", {"max_tokens": 20, "messages": [
        {"role": "user", "content": "What is 17 * 23? Number only."}]}),
    ("short:greet", {"max_tokens": 30, "messages": [
        {"role": "user", "content": "Say hello in Spanish."}]}),
    ("short:color", {"max_tokens": 25, "messages": [
        {"role": "user", "content": "What color do you get mixing red and blue?"}]}),

    # ── Medium explanatory (5) — capped tight to avoid ultra-long ──
    ("med:gravity", {"max_tokens": 180, "messages": [
        {"role": "user", "content": "Explain gravity in 2 short paragraphs."}]}),
    ("med:tcp", {"max_tokens": 200, "messages": [
        {"role": "user", "content": "What is the TCP three-way handshake? Concise, ~5 sentences."}]}),
    ("med:async", {"max_tokens": 200, "messages": [
        {"role": "user", "content": "Briefly contrast async and threads in Node.js."}]}),
    ("med:gzip", {"max_tokens": 180, "messages": [
        {"role": "user", "content": "Why does gzip work so well on log files? 3-4 sentences."}]}),
    ("med:caching", {"max_tokens": 200, "messages": [
        {"role": "user", "content": "Explain LRU cache eviction in 3 sentences."}]}),

    # ── Tool-call requests (5) ── proxy should count the tool_calls in the response
    ("tool:weather-paris", {"max_tokens": 80,
        "tools": [WEATHER_TOOL], "tool_choice": "auto", "messages": [
        {"role": "user", "content": "What's the weather in Paris right now?"}]}),
    ("tool:weather-tokyo", {"max_tokens": 80,
        "tools": [WEATHER_TOOL], "tool_choice": "any", "messages": [
        {"role": "user", "content": "Forecast for Tokyo, in celsius."}]}),
    ("tool:calc-1", {"max_tokens": 60,
        "tools": [CALC_TOOL], "tool_choice": "any", "messages": [
        {"role": "user", "content": "Compute 12345 * 6789 for me."}]}),
    ("tool:calc-2", {"max_tokens": 60,
        "tools": [CALC_TOOL], "tool_choice": "any", "messages": [
        {"role": "user", "content": "What is the square root of 2 to 4 decimals?"}]}),
    ("tool:multi", {"max_tokens": 100,
        "tools": [WEATHER_TOOL, CALC_TOOL], "tool_choice": "auto", "messages": [
        {"role": "user", "content": "Tell me the weather in Berlin and compute 99*99."}]}),
]


def fire(label, body):
    body = {"model": MODEL, **body}
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        PROXY,
        data=payload,
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            dt = time.time() - t0
            usage = data.get("usage") or {}
            tcs = []
            for ch in data.get("choices") or []:
                msg = ch.get("message") or {}
                tcs.extend(msg.get("tool_calls") or [])
            return {
                "label": label,
                "status": resp.status,
                "ms": round(dt * 1000),
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "tool_calls": len(tcs),
                "tool_names": [tc.get("function", {}).get("name") for tc in tcs] or None,
            }
    except urllib.error.HTTPError as e:
        return {"label": label, "status": e.code, "ms": round((time.time() - t0) * 1000),
                "error": e.read().decode()[:120]}


def main():
    results = []
    for label, body in PROMPTS:
        r = fire(label, body)
        results.append(r)
        print(f"{r['status']:>3}  {r['ms']:>5} ms  {r['label']:<22} "
              f"in={r.get('prompt_tokens','-'):>4} out={r.get('completion_tokens','-'):>4} "
              f"tools={r.get('tool_calls', 0)}", flush=True)
        time.sleep(0.15)  # be polite to the upstream

    ok = [r for r in results if r["status"] == 200]
    tool_total = sum(r.get("tool_calls", 0) for r in ok)
    in_tot = sum((r.get("prompt_tokens") or 0) for r in ok)
    out_tot = sum((r.get("completion_tokens") or 0) for r in ok)
    print("─" * 70)
    print(f"calls={len(results)} ok={len(ok)} tool_calls_total={tool_total} "
          f"in_tokens={in_tot} out_tokens={out_tot}")


if __name__ == "__main__":
    main()
