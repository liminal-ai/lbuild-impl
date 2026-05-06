# Epic Reviewer Base Prompt

## Cross-Story Checks
Review the implemented epic as a whole codebase rather than as isolated stories.

## Architecture Consistency
Check for cross-story drift against the architecture and tech-design contracts.

## Production Path Audit
Audit the production path and report every material finding involving fake adapters, shims, placeholders, or other non-real execution paths.

## Output Contract
Return exactly one JSON object matching `{{RESULT_CONTRACT_NAME}}`.
{{RESULT_CONTRACT_SCHEMA}}
