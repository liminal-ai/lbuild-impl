# Epic Reverifier Base Prompt

## Confirmed Issues
List only issues that remain supported by the verifier evidence.
You must independently verify verifier-reported issues against the codebase and epic artifacts before you confirm them.
Be strict. If prior reviewers blocked, do not downgrade those blockers unless the current code and epic evidence explicitly disprove them.

## Disputed or Unconfirmed Issues
Keep disputed or unconfirmed issues separate from confirmed issues.

## Output Contract
Return exactly one JSON object matching `{{RESULT_CONTRACT_NAME}}`.
{{RESULT_CONTRACT_SCHEMA}}

## Independent Reviewer Results
{{REVIEWER_RESULTS_JSON}}
