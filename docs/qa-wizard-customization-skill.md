---
name: qa-wizard-customizer
description: Use when customizing the composable Chainlit QA Wizard by changing stages, questions, option lists, repeated sections, relationship fields, or the target architecture JSON contract.
---

# QA Wizard Customizer

Use this skill to customize the composable QA Wizard while preserving the service boundary between schema definition, browser draft collection, and backend target-model normalization.

## Core Boundary

- `src/qa_wizard.py` owns the trusted schema, option lists, model template, JSON formatting, and backend normalization.
- `public/elements/QaWizard.jsx` owns generic rendering, draft state, stage navigation, browser validation, option resolution, and submit.
- `chainlit_app.py` owns Chainlit orchestration through `AskElementMessage`, action callbacks, and `cl.user_session`.
- Do not route this workflow through the supervisor, sub-agents, MCP tools, or model providers.

## Before Editing

1. Read `QA_WIZARD_DEFINITION`, `QA_OPTIONS`, and `normalize_model()` in `src/qa_wizard.py`.
2. Read the field registry in `public/elements/QaWizard.jsx` and confirm the requested field type exists.
3. Identify whether the change affects only collection UX or also the normalized target JSON contract.
4. If the normalized target JSON changes, update both the schema/model template and backend normalizer.

## Add or Move a Simple Question

1. Add or move a step descriptor in `QA_WIZARD_DEFINITION["stages"]`.
2. Use an existing field type: `text`, `textarea`, `multiselect`, `boolean`, `repeat`, or `review`.
3. Set a stable `id`, a model `path`, user-facing `label`, and `required` behavior.
4. For static options, add or reuse an `optionsKey` in `QA_OPTIONS`.
5. If the `path` writes into a new target-model field, update `TARGET_MODEL_TEMPLATE` and `normalize_model()`.
6. Run a manual wizard smoke check.

Example descriptor:

```python
{
    "id": "system-owner",
    "type": "text",
    "path": "system.owner",
    "label": "Who owns this system?",
    "required": True,
    "requiredMessage": "System owner is required.",
}
```

## Add or Rename Options

1. Update the relevant list in `QA_OPTIONS`.
2. Confirm the schema field references that list with `optionsKey`.
3. Do not hardcode taxonomy values in `QaWizard.jsx`.
4. If renaming an option can affect downstream reporting, document or migrate existing saved models before production use.

## Add a Repeated Section

1. Add a `repeat` step to the appropriate stage in `QA_WIZARD_DEFINITION`.
2. Define `path`, `title`, `itemLabel`, `addLabel`, `minItems`, `itemTemplate`, and `itemSteps`.
3. Add an `idStrategy` if the section needs generated ids.
4. Add a matching array to `TARGET_MODEL_TEMPLATE`.
5. Add a backend normalizer for the new repeated collection.
6. Add relationship filtering if other sections can reference it.

## Add a Relationship Field

1. Use a `multiselect` field with `allowOther: False`.
2. Set `optionsSource.type` to `modelCollection`.
3. Set `optionsSource.path` to the source collection.
4. Set `valuePath` to `id` and `labelPath` to the display name field.
5. Update backend normalization to reject or strip stale ids against the normalized source collection.

Example descriptor:

```python
{
    "id": "queue-producers",
    "type": "multiselect",
    "path": "producer_components",
    "label": "Producer components",
    "allowOther": False,
    "required": True,
    "optionsSource": {
        "type": "modelCollection",
        "path": "containers",
        "valuePath": "id",
        "labelPath": "name",
    },
}
```

## Add a New Field Type

1. Add a React field component in `QaWizard.jsx`.
2. Register it in `fieldRegistry`.
3. Teach `fieldIsComplete()` how to validate required values for that type.
4. Add preview/draft normalization only if the field needs coercion.
5. Use the new `type` from `QA_WIZARD_DEFINITION`.

## P1 Guardrails

- Browser validation is not a trust boundary. For production or downstream automation, add backend validation before `normalize_model()`.
- Current relationship ids are name-derived. For long-lived drafts, persistence, or editing workflows, create stable item ids once and treat names as mutable labels.
- Do not claim a schema-only change is complete if `normalize_model()` still ignores the new path.

## Verification

Run the lightweight backend check:

```bash
uv run python -m py_compile chainlit_app.py src/qa_wizard.py
```

Then manually verify:

1. Open the Chainlit app.
2. Start the QA Wizard.
3. Trigger required-field validation.
4. Complete all affected stages.
5. Confirm review JSON matches the intended draft model.
6. Submit and confirm backend-rendered JSON matches the target contract.
7. Restart and confirm the latest model preloads.
