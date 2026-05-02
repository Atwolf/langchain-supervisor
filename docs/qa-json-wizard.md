# QA JSON Wizard

The QA JSON Wizard is a proof-of-concept Chainlit flow for collecting architecture facts into a deterministic JSON model. It is designed as a scaffold for an internal enterprise workflow where the collected model can later feed diagram generation, review automation, persistence, or downstream governance checks.

The important architectural boundary is that the wizard does not use the supervisor LLM. It is a form-driven interaction that uses Chainlit custom elements and action callbacks to collect structured input, then normalizes that input server-side before rendering JSON back into the chat.

## Runtime Flow

1. `@cl.on_chat_start` in `chainlit_app.py` initializes the normal supervisor graph and sends a `QaEntrypoint` custom element.
2. `public/elements/QaEntrypoint.jsx` renders an isolated card labeled `Architecture QA Wizard`.
3. Clicking the card calls Chainlit's custom element action API with the `qa_start` action name.
4. `@cl.action_callback("qa_start")` calls `run_qa_wizard()`.
5. `run_qa_wizard()` sends an `AskElementMessage` containing `public/elements/QaWizard.jsx`.
6. The wizard drives a multi-phase form in the browser and submits the final payload with `submitElement({ model })`.
7. `chainlit_app.py` receives the submitted payload, calls `normalize_model()` from `src/qa_wizard.py`, stores the normalized model in `cl.user_session["qa_model"]`, and renders formatted JSON in chat.
8. The rendered JSON message includes `qa_restart` and `qa_show_json` actions for quick iteration.

This action-first entrypoint replaced the slash command approach. Chainlit slash commands are composer-driven and require a user message submission before backend handling runs. The explicit card action is a cleaner UX because the callback fires immediately when the user clicks the card.

## Service Boundary

The wizard has a narrow contract with the rest of the application:

- It can read option lists from `src/qa_wizard.py`.
- It can read a prior session-scoped model from `cl.user_session`.
- It can submit a candidate model to the backend.
- It does not call the supervisor, sub-agents, MCP tools, or model providers.
- It does not persist records to PostgreSQL, local files, or external systems.

That keeps the POC simple and prevents the deterministic collection workflow from leaking into the conversational agent abstraction layer.

## Key Files

- `chainlit_app.py` wires the Chainlit callbacks, sends the entrypoint card, opens the wizard, stores the latest model in `cl.user_session`, and renders JSON responses.
- `src/qa_wizard.py` owns option lists, the empty model factory, stable id generation, JSON formatting, and normalization.
- `public/elements/QaEntrypoint.jsx` renders the isolated start card and invokes the `qa_start` action.
- `public/elements/QaWizard.jsx` renders the multi-phase custom form, validates required fields, supports repeated item sections, and submits the target model.
- `docs/qa-json-wizard.md` documents this contract and should be updated when the target model or interaction boundary changes.

## JSON Contract

The submitted and normalized model has this shape:

```json
{
  "system": {
    "name": "",
    "description": "",
    "users": [],
    "entry_points": [],
    "edge_layers": []
  },
  "containers": [
    {
      "id": "",
      "name": "",
      "type": [],
      "framework": [],
      "description": "",
      "is_paa": false
    }
  ],
  "data_stores": [
    {
      "id": "",
      "name": "",
      "type": [],
      "read_components": [],
      "write_components": []
    }
  ],
  "messaging": [
    {
      "id": "",
      "name": "",
      "technology": [],
      "publish_components": [],
      "consume_components": []
    }
  ],
  "external_systems": [
    {
      "id": "",
      "name": "",
      "description": "",
      "protocol": [],
      "connected_components": [],
      "integration_direction": []
    }
  ]
}
```

Relationship fields store component ids, not display labels:

- `data_stores[].read_components`
- `data_stores[].write_components`
- `messaging[].publish_components`
- `messaging[].consume_components`
- `external_systems[].connected_components`

The frontend derives relationship options from the current component list. The backend then filters relationship arrays against the normalized component id set so stale ids are not preserved if a component is renamed or removed.

## Required Fields

The wizard currently treats these fields as required:

- System: `name`, `description`, `users`, `entry_points`, `edge_layers`
- Containers: at least one item, plus each item's `name`, `type`, `framework`, `description`, and explicit `is_paa` choice
- Data stores: each added item's `name`, `type`, `read_components`, and `write_components`
- Messaging: each added item's `name`, `technology`, `publish_components`, and `consume_components`
- External systems: each added item's `name`, `description`, `protocol`, `connected_components`, and `integration_direction`

The repeated item phases do not require a data store, messaging resource, or external system to exist before the user can continue. Once a user adds one of those items, the item's required fields must be complete before moving forward or submitting.

## Id Generation

`src/qa_wizard.py` generates stable ids from item names with `slugify()` and `_unique_id()`.

Examples:

- `Customer API` becomes `customer-api`
- A second item named `Customer API` becomes `customer-api-2`

Ids are regenerated during normalization so the backend remains the source of truth. This keeps the scaffold simple and makes hand-authored or copied payloads easier to repair.

## Option Lists

All first-party option lists live in `QA_OPTIONS` in `src/qa_wizard.py`. The custom element receives those options as props so the frontend does not need to hardcode enterprise taxonomy values.

To add or rename options, update `QA_OPTIONS` first. The frontend will render the new values automatically for the existing phases. Freeform `Other` entries are appended directly into the relevant arrays to keep the model contract flat.

## Action Callbacks

The wizard uses three Chainlit action callbacks:

- `qa_start` opens the wizard from the entrypoint card.
- `qa_restart` reopens the wizard with `cl.user_session["qa_model"]` as the initial model.
- `qa_show_json` resends the latest session-scoped model.

The callbacks are intentionally small. They are orchestration hooks, while validation and normalization remain in the custom element and `src/qa_wizard.py`.

## Persistence

This POC stores the latest generated model only in `cl.user_session`. It does not write to the Chainlit data layer, PostgreSQL, or a file export.

For enterprise usage, persistence should be added behind an explicit service boundary. Recommended next steps:

- Add a model repository/service that accepts the normalized JSON contract.
- Store ownership metadata such as user id, tenant id, thread id, and timestamps outside the target JSON model.
- Keep the submitted architecture model immutable once saved, then create revisions for subsequent edits.
- Add export actions only after persistence and authorization rules are clear.

## Extension Points

Common follow-on changes should be made at these boundaries:

- Add fields by extending the JSON factory and normalizers in `src/qa_wizard.py`, then adding matching controls in `QaWizard.jsx`.
- Add downstream diagram generation by consuming the normalized model after `normalize_model()` returns.
- Add taxonomy governance by replacing `QA_OPTIONS` values with values loaded from a service or configuration file.
- Add stricter validation by keeping browser validation for fast UX and mirroring critical rules in `normalize_model()`.
- Add persistence through a dedicated save callback rather than writing directly from the custom element.

## Validation

Recommended local checks:

```bash
uv run python -m py_compile chainlit_app.py src/qa_wizard.py
uv run chainlit run chainlit_app.py
```

Manual browser validation:

1. Open `http://localhost:8000`.
2. Click `Architecture QA Wizard`.
3. Confirm the wizard opens immediately without sending a chat message.
4. Try advancing with missing required fields and confirm validation errors render.
5. Complete a sample model with at least one container, data store, messaging resource, and external system.
6. Submit and verify the chat renders formatted JSON.
7. Click `Restart QA Wizard` and confirm the previous model preloads.
8. Click `Show Last JSON` and confirm the same normalized JSON is resent.
