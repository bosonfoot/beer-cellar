"""
research_agent.py — Background agent that searches for a beer's optimal drink window.

Called after a beer is added via the web UI. Uses the Claude API with a web_search
server-side tool to find drink_after / drink_by dates, then writes them to the DB.

How it works:
  1. We send Claude a prompt with the beer details and the web_search tool available.
  2. Claude decides to search the web (it calls the tool internally — Anthropic runs
     the actual search, not our code).
  3. Claude reads the results and returns a JSON object with drink_after, drink_by,
     and a research note.
  4. We parse the JSON and write it to the DB.

The agentic "loop" here is simple: we handle pause_turn (API hit an internal limit
and needs to be resumed) but in practice most beer research finishes in one round.
"""

import json
import os

import anthropic
import db

SYSTEM_PROMPT = """You are a beer cellar research assistant. Given a beer's name, brewery, style,
and vintage year, search the web for its optimal drinking window.

Priority sources (best to worst):
1. The brewery's own bottle log or website
2. Beer review sites that mention "drink by", "peak", "drinking window", or "aging"
3. General style aging guides as a last resort

Return ONLY a JSON object — no prose before or after — with these fields:
{
  "drink_after": "YYYY-MM or null",
  "drink_by": "YYYY-MM or null",
  "research": "2-3 sentences citing your source and reasoning"
}

Date format: YYYY-MM (year and month). If only a year is known, use YYYY-01.
If you cannot find reliable aging information, set the date fields to null."""


def run(beer_id, name, brewer, style=None, year=None):
    """Research drink window for a beer and update the DB. Silently returns on any error."""
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f'Research the drinking window for: "{name}" by {brewer}'
    if style:
        prompt += f', Style: {style}'
    if year:
        prompt += f', Vintage: {year}'

    messages = [{"role": "user", "content": prompt}]

    # web_search is a server-side tool — Anthropic runs the actual search.
    # We don't implement execute_tool(); the results come back embedded in the response.
    tools = [{"type": "web_search_20250305", "name": "web_search"}]

    response = None
    try:
        for _ in range(5):  # max 5 continuations for pause_turn
            response = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=tools,
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                break

            if response.stop_reason == "pause_turn":
                # API hit its internal tool-call limit — re-send to continue.
                # Server-side tool results are already embedded in response.content,
                # so we just append the assistant turn and loop.
                messages = [
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": response.content},
                ]
                continue

            break  # unexpected stop reason; use whatever we have

    except Exception:
        return

    if not response:
        return

    # Find the final text block and parse the JSON out of it
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        return

    try:
        # Claude should return pure JSON, but extract it robustly in case there's prose
        start = text.find("{")
        end = text.rfind("}") + 1
        if start < 0 or end <= start:
            return
        data = json.loads(text[start:end])
        db.update_beer_research(
            beer_id,
            drink_after=data.get("drink_after") or None,
            drink_by=data.get("drink_by") or None,
            research=data.get("research") or None,
        )
    except (json.JSONDecodeError, Exception):
        pass
