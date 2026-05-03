# Agent Prompt: Integrate the Composable QA Wizard into an Existing Chainlit App

You are a senior engineer integrating the composable QA Wizard from `langchain-supervisor` into an existing Chainlit application. Treat the wizard as a deterministic form workflow, not an LLM-routed agent capability. Preserve clean service boundaries: Chainlit owns orchestration, the browser custom element owns draft collection and fast UX validation, and the backend owns target-model normalization.

## Source Pieces to Copy

Copy these files or their equivalent code blocks from the source repository:

- `src/qa_wizard.py`: `QA_WIZARD_DEFINITION`, `QA_OPTIONS`, `QA_WIZARD_TIMEOUT_SECONDS`, `empty_model()`, `model_to_json()`, and `normalize_model()`.
- `public/elements/QaWizard.jsx`: schema-driven renderer, path helpers, field registry, validation, repeat sections, and review field.
- `public/elements/QaEntrypoint.jsx`: optional start-card custom element.
- Chainlit callback pattern from `chainlit_app.py`: `send_qa_model()`, `send_qa_entrypoint()`, `run_qa_wizard()`, and action callbacks for `qa_start`, `qa_restart`, and `qa_show_json`.

Do not copy the supervisor, MCP, Anthropic, agent mode picker, or unrelated app boot logic unless the target app already needs them.

## Integration Steps

1. Identify the target app's Chainlit entrypoint.
   - Find the existing `@cl.on_chat_start`, `@cl.on_message`, and any existing `@cl.action_callback` handlers.
   - Confirm where custom elements live in the target app, usually `public/elements/`.
   - Confirm whether the target app already uses `cl.user_session` for session-scoped state.

2. Add the backend wizard service boundary.
   - Place `src/qa_wizard.py` or an equivalent module under the target app's source tree.
   - Keep `QA_WIZARD_DEFINITION` and `QA_OPTIONS` backend-owned.
   - Keep `normalize_model()` specific to the target architecture JSON contract.
   - Do not make the React element the source of truth for target JSON correctness.

3. Add the Chainlit custom elements.
   - Copy `QaWizard.jsx` into the target app's `public/elements/`.
   - Copy `QaEntrypoint.jsx` only if the target app wants the same start-card UX.
   - Preserve the custom element name `QaWizard` unless you update the `cl.CustomElement(name=...)` call accordingly.

4. Wire the start flow without coupling it to agent boot.
   - Add `send_qa_entrypoint()` to render the optional start card.
   - Add `run_qa_wizard()` to send `cl.AskElementMessage` with:

```python
cl.CustomElement(
    name="QaWizard",
    props={
        "definition": QA_WIZARD_DEFINITION,
        "options": QA_OPTIONS,
        "initialModel": cl.user_session.get("qa_model") or empty_model(),
    },
)
```

   - Register `qa_start`, `qa_restart`, and `qa_show_json` action callbacks.
   - Send the QA entrypoint early in `@cl.on_chat_start`, before optional LLM, MCP, or external service bootstrapping when possible.

5. Preserve the session contract.
   - Store the latest normalized model in `cl.user_session["qa_model"]`.
   - Keep the draft model in the browser until submit.
   - On submit, pass the browser payload through backend normalization before rendering, persisting, or sending downstream.

6. Decide how to handle the current P1 risks before production use.
   - For a POC, document that browser validation is UX-only.
   - Before relying on generated JSON, add backend validation against `QA_WIZARD_DEFINITION`.
   - Before long-lived editing or persistence, replace name-derived relationship ids with stable draft ids.

7. Verify locally.
   - Run `uv run python -m py_compile <chainlit_entrypoint>.py <qa_wizard_module>.py`.
   - Start the target Chainlit app.
   - Open the QA Wizard, confirm required-field validation, complete all stages, submit JSON, restart, and confirm the previous model preloads.

## Acceptance Criteria

- The QA Wizard opens without invoking the supervisor, LLM, MCP tools, or agent router.
- The browser renders stages from the backend `definition` prop.
- Static options come from `QA_OPTIONS`, not hardcoded React arrays.
- Component relationship fields resolve from the draft model's component collection.
- Submit renders normalized JSON in chat and stores it in `cl.user_session["qa_model"]`.
- Restart opens the wizard with the latest session model.

## Known Integration Hazards

- Backend validation is not implemented yet; `normalize_model()` can produce clean-looking JSON from incomplete payloads.
- Relationship ids are currently derived from component names; renames can strip or rebind relationships.
- `normalize_model()` is architecture-specific; schema changes that alter target JSON still require Python normalizer changes.
- `QaWizard.jsx` is internally modular but still one large file; extracting it into a reusable package will require splitting renderer, fields, path utilities, options, validation, and draft normalization.
