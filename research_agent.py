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
import re

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


def run(beer_id, name, brewer, style=None, year=None, date_bottled=None):
    """Research drink window for a beer and update the DB."""
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print(f'[research] No ANTHROPIC_API_KEY in environment — skipping')
        return

    print(f'[research] Starting research for beer {beer_id}: "{name}" by {brewer}')
    client = anthropic.Anthropic(api_key=api_key)

    # Fall back to the year portion of date_bottled if no explicit vintage year
    effective_year = year or (date_bottled.split('-')[0] if date_bottled else None)

    prompt = f'Research the drinking window for: "{name}" by {brewer}'
    if style:
        prompt += f', Style: {style}'
    if effective_year:
        prompt += f', Vintage: {effective_year}'
    if date_bottled:
        prompt += f', Bottled: {date_bottled}'

    print(f'[research] Prompt: {prompt}')
    messages = [{"role": "user", "content": prompt}]

    # web_search is a server-side tool — Anthropic runs the actual search.
    # We don't implement execute_tool(); the results come back embedded in the response.
    tools = [{"type": "web_search_20250305", "name": "web_search"}]

    response = None
    try:
        for i in range(5):  # max 5 continuations for pause_turn
            print(f'[research] API call #{i+1}...')
            response = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=tools,
                messages=messages,
            )

            print(f'[research] stop_reason={response.stop_reason}, content types={[b.type for b in response.content]}')

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

    except Exception as e:
        print(f'[research] API error: {type(e).__name__}: {e}')
        return

    if not response:
        print(f'[research] No response received')
        return

    # Find the final text block — Claude emits an intro text before searching,
    # so we want the LAST text block which contains the JSON result.
    text_blocks = [b.text for b in response.content if b.type == "text"]
    print(f'[research] Text blocks ({len(text_blocks)}): {text_blocks}')
    text = text_blocks[-1] if text_blocks else None
    print(f'[research] Using last text block: {text!r}')
    if not text:
        print(f'[research] No text block in response')
        return

    try:
        # Claude should return pure JSON, but extract it robustly in case there's prose
        start = text.find("{")
        end = text.rfind("}") + 1
        if start < 0 or end <= start:
            print(f'[research] No JSON object found in response')
            return
        data = json.loads(text[start:end])
        print(f'[research] Parsed: drink_after={data.get("drink_after")}, drink_by={data.get("drink_by")}')
        # Strip <cite ...>...</cite> tags that leak in from web search results
        research_text = data.get("research") or None
        if research_text:
            research_text = re.sub(r'<cite[^>]*>(.*?)</cite>', r'\1', research_text, flags=re.DOTALL).strip()
        db.update_beer_research(
            beer_id,
            drink_after=data.get("drink_after") or None,
            drink_by=data.get("drink_by") or None,
            research=research_text or None,
        )
        print(f'[research] DB updated for beer {beer_id}')
    except json.JSONDecodeError as e:
        print(f'[research] JSON parse error: {e}')
    except Exception as e:
        print(f'[research] Unexpected error: {type(e).__name__}: {e}')
