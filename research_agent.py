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
import sys

import anthropic
import db

# Windows defaults stdout to cp1252 when redirected to a file/pipe, which can't encode
# characters (e.g. en-dash, arrows) that web search results sometimes contain — that
# crashes the debug prints below and silently kills research for that beer.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(errors='replace')

SYSTEM_PROMPT = """You are a beer cellar research assistant. Given a beer's name, brewery, style,
and vintage year, search the web for its optimal drinking window.

Priority sources (best to worst):
1. Brewer's own bottling/cellar notes provided in the prompt — these are the most authoritative source
2. The brewery's own bottle log or website
3. Beer review sites that mention "drink by", "peak", "drinking window", or "aging"
4. General style aging guides as a last resort

Return ONLY a JSON object — no prose before or after — with these fields:
{
  "drink_after": "YYYY-MM or null",
  "drink_by": "YYYY-MM or null",
  "research": "2-3 sentences citing your source and reasoning"
}

Date format: YYYY-MM (year and month). If only a year is known, use YYYY-01.

If no official window is published, do NOT return null — instead apply a style-based estimate
using the bottling date (or vintage year) as the starting point:
  - Lambic / gueuze / spontaneous wild ale: drink_after = bottling + 2yr, drink_by = bottling + 7yr
  - Barrel-aged sour / mixed-fermentation ale: drink_after = bottling + 1yr, drink_by = bottling + 5yr
  - Belgian strong ale / barleywine / imperial stout: drink_after = bottling + 2yr, drink_by = bottling + 8yr
  - Standard ale / lager / IPA: drink_after = bottling + 0yr, drink_by = bottling + 1yr

When using an estimate, note it clearly in the research field:
"No official window published. Estimated [drink_after]–[drink_by] based on [style] aging characteristics and bottling date [YYYY-MM]."

Only return null for drink_after/drink_by if the bottling date and style are both completely unknown.

If prior research findings are provided in the prompt, treat them as your own earlier work, not
a blank slate:
- Only change a date or the research note if you find something MORE authoritative than what's
  already there (an official brewer/bottle-log source beats a style-based estimate; a specific
  quote beats a vague one). Don't replace a sourced finding with a re-derived generic estimate
  just because this search didn't happen to surface the same source again.
- If you don't find anything better than the prior finding, return the prior values UNCHANGED —
  do not paraphrase or shorten a good research note for its own sake.
- Never return null for a field that already has a value just because this search came up empty.
  A failed search is not evidence the beer doesn't exist or that the prior data is wrong."""


def run(beer_id, name, brewer, style=None, year=None, date_bottled=None, considerations=None):
    """Research drink window for a beer and update the DB."""
    data = fetch_research(name, brewer, style=style, year=year,
                           date_bottled=date_bottled, considerations=considerations)
    if data:
        db.update_beer_research(
            beer_id,
            drink_after=data.get('drink_after'),
            drink_by=data.get('drink_by'),
            research=data.get('research'),
        )
        print(f'[research] DB updated for beer {beer_id}')


def fetch_research(name, brewer, style=None, year=None, date_bottled=None, considerations=None,
                    existing_drink_after=None, existing_drink_by=None, existing_research=None):
    """Search the web for a beer's drinking window. Returns {drink_after, drink_by, research}
    or None on failure — does NOT write to the DB.

    Pass existing_* to re-research a beer that already has findings — the model is instructed
    to only overwrite them with something more authoritative, not re-derive from scratch."""
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print(f'[research] No ANTHROPIC_API_KEY in environment — skipping')
        return None

    print(f'[research] Starting research for "{name}" by {brewer}')
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
    if considerations:
        prompt += f'\n\nBrewer\'s bottling/cellar notes (highest-priority source):\n{considerations}'
    if existing_drink_after or existing_drink_by or existing_research:
        prompt += (
            f'\n\nYour prior findings for this beer (only overwrite if you find something more '
            f'authoritative — see instructions):\n'
            f'  drink_after: {existing_drink_after or "unknown"}\n'
            f'  drink_by: {existing_drink_by or "unknown"}\n'
            f'  research: {existing_research or "none"}'
        )

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
        return None

    if not response:
        print(f'[research] No response received')
        return None

    # Find the final text block — Claude emits an intro text before searching,
    # so we want the LAST text block which contains the JSON result.
    text_blocks = [b.text for b in response.content if b.type == "text"]
    print(f'[research] Text blocks ({len(text_blocks)}): {text_blocks}')
    text = text_blocks[-1] if text_blocks else None
    print(f'[research] Using last text block: {text!r}')
    if not text:
        print(f'[research] No text block in response')
        return None

    try:
        # Claude should return pure JSON, but extract it robustly in case there's prose
        start = text.find("{")
        end = text.rfind("}") + 1
        if start < 0 or end <= start:
            print(f'[research] No JSON object found in response')
            return None
        data = json.loads(text[start:end])
        print(f'[research] Parsed: drink_after={data.get("drink_after")}, drink_by={data.get("drink_by")}')
        # Strip <cite ...>...</cite> tags that leak in from web search results
        research_text = data.get("research") or None
        if research_text:
            research_text = re.sub(r'<cite[^>]*>(.*?)</cite>', r'\1', research_text, flags=re.DOTALL).strip()
        return {
            'drink_after': data.get('drink_after') or None,
            'drink_by': data.get('drink_by') or None,
            'research': research_text or None,
        }
    except json.JSONDecodeError as e:
        print(f'[research] JSON parse error: {e}')
        return None
    except Exception as e:
        print(f'[research] Unexpected error: {type(e).__name__}: {e}')
        return None
