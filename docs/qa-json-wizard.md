# QA JSON Wizard

The QA JSON Wizard is a proof-of-concept Chainlit flow for collecting architecture facts into a deterministic JSON model. It is designed as a scaffold for an internal enterprise workflow where the collected model can later feed diagram generation, review automation, persistence, or downstream governance checks.

The important architectural boundary is that the wizard does not use the supervisor LLM. It is a form-driven interaction that uses Chainlit custom elements and action callbacks to collect structured input, then normalizes that input server-side before rendering JSON back into the chat.

## Runtime Flow

1. `@cl.on_chat_start` in `chainlit_app.py` initializes the normal supervisor graph and sends a `QaEntrypoint` custom element.
2. `public/elements/QaEntrypoint.jsx` renders an isolated card labeled `Architecture QA Wizard`.
3. Clicking the card calls Chainlit's custom element action API with the `qa_start` action name.
4. `@cl.action_callback("qa_start")` calls `run_qa_wizard()`.
5. `run_qa_wizard()` sends an `AskElementMessage` containing `public/elements/QaWizard.jsx`, along with the Python-owned wizard definition, option lists, and latest session model.
6. The wizard renders stages and fields from the definition, keeps a mutable draft model in the browser, and submits the draft payload with `submitElement({ model })`.
7. `chainlit_app.py` receives the submitted payload, calls `normalize_model()` from `src/qa_wizard.py`, stores the normalized model in `cl.user_session["qa_model"]`, and removes the transient ask message so Chainlit does not leave a generic submit confirmation in the thread.
8. The normalized model is passed to `build_qa_c4_artifact()` in `src/qa_c4.py`, which creates a deterministic C4 view model and C4 code string.
9. The chat renders one `QaModelResult` custom element with `Diagram`, `JSON`, and `C4 Code` tabs plus quick iteration actions.

This action-first entrypoint replaced the slash command approach. Chainlit slash commands are composer-driven and require a user message submission before backend handling runs. The explicit card action is a cleaner UX because the callback fires immediately when the user clicks the card.

## Service Boundary

The wizard has a narrow contract with the rest of the application:

- It can read the wizard definition and option lists from `src/qa_wizard.py`.
- It can read a prior session-scoped model from `cl.user_session`.
- It can submit a candidate model to the backend.
- It can render a browser-owned C4 diagram from a backend-generated view model.
- It does not call the supervisor, sub-agents, MCP tools, or model providers.
- It does not persist records to PostgreSQL, local files, or external systems.

That keeps the POC simple and prevents the deterministic collection workflow from leaking into the conversational agent abstraction layer. The browser owns rendering and fast validation; the backend remains the normalization and target JSON contract boundary.

## Key Files

- `chainlit_app.py` wires the Chainlit callbacks, sends the entrypoint card, opens the wizard, stores the latest model in `cl.user_session`, and renders JSON responses.
- `src/qa_wizard.py` owns the composable wizard definition, option lists, the empty model factory, stable id generation, JSON formatting, and normalization.
- `src/qa_c4.py` transforms the normalized model into a simple C4 diagram view model and C4-PlantUML-style code string. It does not invoke Graphviz, PlantUML, Mermaid, or any external renderer.
- `public/elements/QaEntrypoint.jsx` renders the isolated start card and invokes the `qa_start` action.
- `public/elements/QaWizard.jsx` renders the definition-driven custom form, validates required fields, supports repeated item sections, resolves dynamic options, and submits the draft model.
- `public/elements/QaModelResult.jsx` renders the generated result with `Diagram`, `JSON`, and `C4 Code` tabs.
- `docs/qa-json-wizard.md` documents this contract and should be updated when the target model or interaction boundary changes.

## Composable Definition

The content layer is now declared in `QA_WIZARD_DEFINITION` rather than hardcoded as React phase branches. The definition contains:

- `id`, `version`, and `title` for the wizard contract.
- `modelTemplate`, which seeds the browser draft model.
- Ordered `stages`, each with schema descriptors for `text`, `textarea`, `multiselect`, `boolean`, `repeat`, and `review` steps.
- Repeat-section metadata such as `itemTemplate`, `itemSteps`, `minItems`, and `idStrategy`.
- Option bindings through either `optionsKey` for static taxonomies or `optionsSource.type = "modelCollection"` for component relationship fields.

This gives the POC a narrower customization surface: product or platform engineers can add or move simple questions by changing schema descriptors, while the renderer remains generic and the backend still controls final normalization.

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

## C4 Result

The C4 layer is a deterministic post-processing boundary over the normalized model. It intentionally avoids native runtime dependencies such as Graphviz `dot`.

`src/qa_c4.py` maps the model into:

- `diagram.nodes`, with node kinds for people, containers, databases, queues, and external systems.
- `diagram.edges`, derived from the relationship arrays in the normalized model.
- `c4Code`, a C4-PlantUML-style text representation that can be copied into a C4-compatible renderer later if the integration environment supports one.
- `stats`, containing basic node and relationship counts for the UI.

`public/elements/QaModelResult.jsx` renders the diagram directly as SVG inside Chainlit. This keeps the POC dependency surface small for enterprise scaffold usage: the Python service creates data, and the browser owns presentation.

## Required Fields

The wizard definition currently marks these fields as required:

- System: `name`, `description`, `users`, `entry_points`, `edge_layers`
- Containers: at least one item, plus each item's `name`, `type`, `framework`, `description`, and explicit `is_paa` choice
- Data stores: each added item's `name`, `type`, `read_components`, and `write_components`
- Messaging: each added item's `name`, `technology`, `publish_components`, and `consume_components`
- External systems: each added item's `name`, `description`, `protocol`, `connected_components`, and `integration_direction`

The repeated item phases do not require a data store, messaging resource, or external system to exist before the user can continue. Once a user adds one of those items, the item's required fields must be complete before moving forward or submitting.

## Id Generation

`src/qa_wizard.py` generates stable ids from item names with `slugify()` and `_unique_id()`.

Examples:

- `Customer API` becomes `container_customer_api`
- A second item named `Customer API` becomes `container_customer_api_2`

Ids are regenerated during normalization so the backend remains the source of truth. This keeps the scaffold simple and makes hand-authored or copied payloads easier to repair.

## Option Lists

All first-party option lists live in `QA_OPTIONS` in `src/qa_wizard.py`. The custom element receives those options as props so the frontend does not need to hardcode enterprise taxonomy values.

To add or rename options, update `QA_OPTIONS` first. The frontend will render the new values automatically for schema fields that reference the matching `optionsKey`. Freeform `Other` entries are appended directly into the relevant arrays to keep the model contract flat.

## Action Callbacks

The wizard uses these Chainlit action callbacks:

- `qa_start` opens the wizard from the entrypoint card.
- `qa_restart` reopens the wizard with `cl.user_session["qa_model"]` as the initial model.
- `qa_show_json` resends the latest session-scoped result with the diagram, JSON, and C4 code tabs.
- `qa_show_diagram` remains as a compatibility alias for older rendered action controls and sends the same tabbed result.

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

- Add simple fields by extending `QA_WIZARD_DEFINITION` and, if the target JSON shape changes, the JSON factory and normalizers in `src/qa_wizard.py`.
- Add a new field type by registering a renderer in `QaWizard.jsx` and then using that type from `QA_WIZARD_DEFINITION`.
- Extend diagram behavior by updating `src/qa_c4.py` for backend artifact generation and `QaModelResult.jsx` for browser presentation.
- Add taxonomy governance by replacing `QA_OPTIONS` values with values loaded from a service or configuration file.
- Add stricter validation by keeping browser validation for fast UX and mirroring critical rules in `normalize_model()`.
- Add persistence through a dedicated save callback rather than writing directly from the custom element.

## Validation

Recommended local checks:

```bash
uv run python -m py_compile chainlit_app.py src/qa_wizard.py src/qa_c4.py
uv run chainlit run chainlit_app.py
```

Manual browser validation:

1. Open `http://localhost:8000`.
2. Click `Architecture QA Wizard`.
3. Confirm the wizard opens immediately without sending a chat message.
4. Try advancing with missing required fields and confirm validation errors render.
5. Complete a sample model with at least one container, data store, messaging resource, and external system.
6. Submit and verify the chat renders one tabbed result element.
7. Confirm the `Diagram`, `JSON`, and `C4 Code` tabs all render usable content.
8. Click `Restart QA Wizard` and confirm the previous model preloads.
9. Click `Show Last Result` and confirm the same normalized result is resent.
