"""QA wizard configuration and JSON normalization helpers."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any

QA_WIZARD_TIMEOUT_SECONDS = 3600

QA_OPTIONS: dict[str, list[str]] = {
    "user_types": [
        "End users / customers",
        "Internal employees",
        "Administrators / operators",
        "Automated clients",
        "Third-party partners",
    ],
    "entry_points": [
        "Web browser / web application",
        "Mobile app",
        "REST API",
        "CLI tool",
    ],
    "edge_layers": [
        "Kong",
        "Apigee",
        "AWS API Gateway",
        "NGINX",
        "None",
    ],
    "container_types": [
        "Web app",
        "Backend API",
        "Background worker",
        "Scheduled job",
        "Event consumer",
    ],
    "frameworks": [
        "React",
        "Spring Boot",
        "FastAPI",
        ".NET Core",
        "Node.js",
        "Go",
    ],
    "data_store_types": [
        "PostgreSQL / MySQL / MariaDB",
        "MongoDB",
        "Oracle",
        "Microsoft SQL Server",
        "Redis / Memcached",
        "Elasticsearch / OpenSearch",
        "Object storage",
    ],
    "messaging_technologies": [
        "Apache Kafka",
        "RabbitMQ / AMQP",
        "Solace",
        "NATS",
        "Cloud queue / topic",
    ],
    "external_protocols": [
        "HTTP / REST",
        "gRPC",
        "SOAP",
        "Kafka / event stream",
        "AMQP",
        "LDAP",
    ],
    "integration_directions": [
        "Outbound only",
        "Inbound only",
        "Bidirectional",
    ],
}

TARGET_MODEL_TEMPLATE: dict[str, Any] = {
    "system": {
        "name": "",
        "description": "",
        "users": [],
        "entry_points": [],
        "edge_layers": [],
    },
    "containers": [],
    "data_stores": [],
    "messaging": [],
    "external_systems": [],
}


def empty_model() -> dict[str, Any]:
    """Return a fresh target model instance."""
    return deepcopy(TARGET_MODEL_TEMPLATE)


def model_to_json(model: dict[str, Any]) -> str:
    """Serialize a model for display with stable indentation."""
    return json.dumps(model, indent=2, ensure_ascii=False)


def slugify(value: str, prefix: str) -> str:
    """Create a stable JSON id segment from a user-facing name."""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    normalized = normalized.strip("_")
    return f"{prefix}_{normalized}" if normalized else prefix


def normalize_model(raw_model: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize user-submitted wizard state into the target JSON model."""
    raw_model = _as_dict(raw_model)
    model = empty_model()

    raw_system = _as_dict(raw_model.get("system"))
    model["system"] = {
        "name": _clean_string(raw_system.get("name")),
        "description": _clean_string(raw_system.get("description")),
        "users": _clean_list(raw_system.get("users")),
        "entry_points": _clean_list(raw_system.get("entry_points")),
        "edge_layers": _clean_list(raw_system.get("edge_layers")),
    }

    model["containers"] = _normalize_containers(raw_model.get("containers"))
    component_ids = {item["id"] for item in model["containers"]}

    model["data_stores"] = _normalize_data_stores(
        raw_model.get("data_stores"),
        component_ids,
    )
    model["messaging"] = _normalize_messaging(
        raw_model.get("messaging"),
        component_ids,
    )
    model["external_systems"] = _normalize_external_systems(
        raw_model.get("external_systems"),
        component_ids,
    )

    return model


def _normalize_containers(raw_items: Any) -> list[dict[str, Any]]:
    containers = []
    seen_ids: set[str] = set()

    for index, item in enumerate(_as_list(raw_items), start=1):
        raw_item = _as_dict(item)
        name = _clean_string(raw_item.get("name"))
        if not name:
            continue

        item_id = _unique_id(slugify(name, "container"), seen_ids, index)
        containers.append(
            {
                "id": item_id,
                "name": name,
                "type": _clean_list(raw_item.get("type")),
                "framework": _clean_list(raw_item.get("framework")),
                "description": _clean_string(raw_item.get("description")),
                "is_paa": bool(raw_item.get("is_paa")),
            }
        )

    return containers


def _normalize_data_stores(
    raw_items: Any,
    component_ids: set[str],
) -> list[dict[str, Any]]:
    data_stores = []
    seen_ids: set[str] = set()

    for index, item in enumerate(_as_list(raw_items), start=1):
        raw_item = _as_dict(item)
        name = _clean_string(raw_item.get("name"))
        if not name:
            continue

        item_id = _unique_id(slugify(name, "data_store"), seen_ids, index)
        data_stores.append(
            {
                "id": item_id,
                "name": name,
                "type": _clean_list(raw_item.get("type")),
                "read_components": _component_refs(
                    raw_item.get("read_components"),
                    component_ids,
                ),
                "write_components": _component_refs(
                    raw_item.get("write_components"),
                    component_ids,
                ),
            }
        )

    return data_stores


def _normalize_messaging(
    raw_items: Any,
    component_ids: set[str],
) -> list[dict[str, Any]]:
    messaging = []
    seen_ids: set[str] = set()

    for index, item in enumerate(_as_list(raw_items), start=1):
        raw_item = _as_dict(item)
        name = _clean_string(raw_item.get("name"))
        if not name:
            continue

        item_id = _unique_id(slugify(name, "message"), seen_ids, index)
        messaging.append(
            {
                "id": item_id,
                "name": name,
                "technology": _clean_list(raw_item.get("technology")),
                "publish_components": _component_refs(
                    raw_item.get("publish_components"),
                    component_ids,
                ),
                "consume_components": _component_refs(
                    raw_item.get("consume_components"),
                    component_ids,
                ),
            }
        )

    return messaging


def _normalize_external_systems(
    raw_items: Any,
    component_ids: set[str],
) -> list[dict[str, Any]]:
    external_systems = []
    seen_ids: set[str] = set()

    for index, item in enumerate(_as_list(raw_items), start=1):
        raw_item = _as_dict(item)
        name = _clean_string(raw_item.get("name"))
        if not name:
            continue

        item_id = _unique_id(slugify(name, "external"), seen_ids, index)
        external_systems.append(
            {
                "id": item_id,
                "name": name,
                "description": _clean_string(raw_item.get("description")),
                "protocol": _clean_list(raw_item.get("protocol")),
                "connected_components": _component_refs(
                    raw_item.get("connected_components"),
                    component_ids,
                ),
                "integration_direction": _clean_list(
                    raw_item.get("integration_direction")
                ),
            }
        )

    return external_systems


def _component_refs(raw_values: Any, component_ids: set[str]) -> list[str]:
    values = _clean_list(raw_values)
    if not component_ids:
        return []
    return [value for value in values if value in component_ids]


def _unique_id(base_id: str, seen_ids: set[str], index: int) -> str:
    item_id = base_id
    if item_id in seen_ids:
        item_id = f"{base_id}_{index}"
    while item_id in seen_ids:
        index += 1
        item_id = f"{base_id}_{index}"
    seen_ids.add(item_id)
    return item_id


def _clean_string(value: Any) -> str:
    return str(value or "").strip()


def _clean_list(value: Any) -> list[str]:
    cleaned = []
    seen = set()

    for item in _as_list(value):
        text = _clean_string(item)
        if text and text not in seen:
            cleaned.append(text)
            seen.add(text)

    return cleaned


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]
