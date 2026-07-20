# Research Review

Re-research every beer in the cellar and surface anything worth updating — for a periodic
check-in, not a one-time task. Dry run first, apply only what's approved.

## Steps

1. Run the batch research pass (takes several minutes for ~35 beers; run it in the
   background and don't poll):
   ```bash
   python research_review.py research_review_$(date +%Y-%m-%d).md
   ```
   This only reads the DB and calls the Claude API — it never writes to the DB or touches
   git. It skips beers that are already imbibed or labeled `Test`.

2. Read the generated report. For each beer with a suggested change, summarize it for the
   user in chat (beer name, field, old value → new value). Skip beers with no changes —
   don't make the user read a wall of "no change".

3. Ask the user which suggested changes to apply. Don't apply anything without approval —
   that's the whole point of this workflow. Look out for the research agent proposing a
   *worse* estimate than what's already there (e.g. overwriting a brewer's own published
   window with a generic style-based guess) — flag those explicitly rather than presenting
   every diff as equally trustworthy.

4. Apply the approved subset in one batch (one commit, not one per beer):
   ```bash
   python apply_research.py '[{"id": 90, "drink_after": "2027-11", "drink_by": "2032-11", "research": "..."}]'
   ```
   This updates the DB, rebuilds `docs/`, and does a single commit + push for the whole
   batch. Since this changes what unauthenticated visitors see on the public GitHub Pages
   site, per project convention this still counts as a deliberate release — the approval
   in step 3 covers that; no separate confirmation needed before the push.

5. Delete the report file once applied (it's a working artifact, not something to keep
   tracked in the repo).

## Cost/efficiency notes
- Each beer costs one Claude Haiku API call with web search — cheap, but 35 beers takes a
  few minutes sequentially. Don't parallelize with a thread pool without checking in first;
  it's not worth the complexity unless the cellar grows a lot.
- Good cadence: quarterly, or whenever a bunch of new beers have had time to accumulate
  outside info (bottle logs, reviews) since they were added.
