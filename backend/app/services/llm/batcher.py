"""
Batch size calculator for LLM job tag extraction.

Gemini 2.5 Flash limits (conservative):
  - Max input tokens per call: 80,000
  - Taxonomy overhead: ~1,300 tokens
  - Per job estimate: chars/4 + 30 tokens overhead
  - Per job output: ~50 tokens

We cap at MAX_TOKENS_PER_CALL to stay well within limits and keep
response JSON manageable.
"""

MAX_TOKENS_PER_CALL = 80_000
TAXONOMY_OVERHEAD_TOKENS = 1_300
PER_JOB_OVERHEAD_TOKENS = 30
CHARS_PER_TOKEN = 4  # rough estimate
MAX_BATCH_SIZE = 50  # hard cap regardless of token calc


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def calculate_batches(jobs: list[dict]) -> list[list[dict]]:
    """
    Given a list of jobs ({job_id, description}), split into optimal batches.

    - If all jobs fit in one call → returns a single batch (smooshed).
    - Otherwise → splits into batches of up to MAX_BATCH_SIZE jobs,
      respecting the token budget.

    Each batch is guaranteed to fit within MAX_TOKENS_PER_CALL.
    """
    if not jobs:
        return []

    batches: list[list[dict]] = []
    current_batch: list[dict] = []
    current_tokens = TAXONOMY_OVERHEAD_TOKENS

    for job in jobs:
        job_tokens = estimate_tokens(job["description"]) + PER_JOB_OVERHEAD_TOKENS

        # Start a new batch if adding this job would exceed limits
        if current_batch and (
            current_tokens + job_tokens > MAX_TOKENS_PER_CALL
            or len(current_batch) >= MAX_BATCH_SIZE
        ):
            batches.append(current_batch)
            current_batch = []
            current_tokens = TAXONOMY_OVERHEAD_TOKENS

        current_batch.append(job)
        current_tokens += job_tokens

    if current_batch:
        batches.append(current_batch)

    return batches
