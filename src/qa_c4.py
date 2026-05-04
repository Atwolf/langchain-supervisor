"""C4 view-model generation for normalized QA wizard models."""

from __future__ import annotations

import re
from typing import Any


def build_qa_c4_artifact(model: dict[str, Any]) -> dict[str, Any]:
    """Build a browser-renderable C4 artifact from a normalized QA model."""
    model = _as_dict(model)
    system = _as_dict(model.get("system"))
    system_name = _clean_string(system.get("name")) or "Architecture System"

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    c4_ids: dict[str, str] = {}

    people = []
    for index, user in enumerate(_clean_list(system.get("users")), start=1):
        node = {
            "id": f"person_{index}",
            "kind": "person",
            "group": "people",
            "label": user,
            "description": "Primary user",
            "technology": "",
        }
        people.append(node)
        nodes.append(node)
        c4_ids[node["id"]] = _identifier(node["id"])

    containers = []
    for container in _as_list(model.get("containers")):
        item = _as_dict(container)
        item_id = _clean_string(item.get("id"))
        name = _clean_string(item.get("name"))
        if not item_id or not name:
            continue

        node = {
            "id": item_id,
            "kind": "container",
            "group": "system",
            "label": name,
            "description": _clean_string(item.get("description")),
            "technology": _join(
                [
                    *_clean_list(item.get("type")),
                    *_clean_list(item.get("framework")),
                    "PAA" if item.get("is_paa") is True else "",
                ]
            ),
        }
        containers.append(node)
        nodes.append(node)
        c4_ids[item_id] = _identifier(item_id)

    data_stores = []
    for data_store in _as_list(model.get("data_stores")):
        item = _as_dict(data_store)
        item_id = _clean_string(item.get("id"))
        name = _clean_string(item.get("name"))
        if not item_id or not name:
            continue

        node = {
            "id": item_id,
            "kind": "database",
            "group": "system",
            "label": name,
            "description": "Data store",
            "technology": _join(item.get("type")),
        }
        data_stores.append((item, node))
        nodes.append(node)
        c4_ids[item_id] = _identifier(item_id)

    message_channels = []
    for channel in _as_list(model.get("messaging")):
        item = _as_dict(channel)
        item_id = _clean_string(item.get("id"))
        name = _clean_string(item.get("name"))
        if not item_id or not name:
            continue

        node = {
            "id": item_id,
            "kind": "queue",
            "group": "system",
            "label": name,
            "description": "Message channel",
            "technology": _join(item.get("technology")),
        }
        message_channels.append((item, node))
        nodes.append(node)
        c4_ids[item_id] = _identifier(item_id)

    external_systems = []
    for external in _as_list(model.get("external_systems")):
        item = _as_dict(external)
        item_id = _clean_string(item.get("id"))
        name = _clean_string(item.get("name"))
        if not item_id or not name:
            continue

        node = {
            "id": item_id,
            "kind": "external",
            "group": "external",
            "label": name,
            "description": _clean_string(item.get("description")),
            "technology": _join(item.get("protocol")),
        }
        external_systems.append((item, node))
        nodes.append(node)
        c4_ids[item_id] = _identifier(item_id)

    entry_target = containers[0]["id"] if containers else None
    if entry_target:
        for person in people:
            edges.append(
                {
                    "source": person["id"],
                    "target": entry_target,
                    "label": "Uses",
                    "technology": _join(
                        [
                            *_clean_list(system.get("entry_points")),
                            *_clean_list(system.get("edge_layers")),
                        ]
                    ),
                }
            )

    for item, node in data_stores:
        for component_id in _clean_list(item.get("read_components")):
            edges.append(_edge(component_id, node["id"], "Reads from"))
        for component_id in _clean_list(item.get("write_components")):
            edges.append(_edge(component_id, node["id"], "Writes to"))

    for item, node in message_channels:
        for component_id in _clean_list(item.get("publish_components")):
            edges.append(_edge(component_id, node["id"], "Publishes to"))
        for component_id in _clean_list(item.get("consume_components")):
            edges.append(_edge(node["id"], component_id, "Consumed by"))

    for item, node in external_systems:
        label = "Integrates with"
        protocol = _join(item.get("protocol"))
        directions = {
            value.lower()
            for value in _clean_list(item.get("integration_direction"))
        }
        for component_id in _clean_list(item.get("connected_components")):
            if "inbound only" in directions and "outbound only" not in directions:
                edges.append(_edge(node["id"], component_id, label, protocol))
            else:
                edges.append(_edge(component_id, node["id"], label, protocol))

    edge_list = [
        edge
        for edge in edges
        if edge["source"] in c4_ids and edge["target"] in c4_ids
    ]

    return {
        "title": f"C4 Container Diagram: {system_name}",
        "systemName": system_name,
        "diagram": {
            "nodes": nodes,
            "edges": edge_list,
            "boundary": {
                "id": "system_boundary",
                "label": system_name,
            },
        },
        "c4Code": _build_c4_code(system_name, nodes, edge_list, c4_ids),
        "stats": {
            "nodes": len(nodes),
            "relationships": len(edge_list),
        },
    }


def _build_c4_code(
    system_name: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, str]],
    c4_ids: dict[str, str],
) -> str:
    lines = [
        "@startuml",
        "!include <C4/C4_Container>",
        "LAYOUT_LEFT_RIGHT()",
        f"title C4 Container Diagram - {_quote(system_name)}",
        "",
    ]

    people = [node for node in nodes if node["group"] == "people"]
    system_nodes = [node for node in nodes if node["group"] == "system"]
    external_nodes = [node for node in nodes if node["group"] == "external"]

    for node in people:
        lines.append(
            f'Person({c4_ids[node["id"]]}, "{_quote(node["label"])}", '
            f'"{_quote(node["description"])}")'
        )

    lines.append(f'System_Boundary(system_boundary, "{_quote(system_name)}") {{')
    for node in system_nodes:
        macro = {
            "container": "Container",
            "database": "ContainerDb",
            "queue": "ContainerQueue",
        }.get(node["kind"], "Container")
        lines.append(
            f'  {macro}({c4_ids[node["id"]]}, "{_quote(node["label"])}", '
            f'"{_quote(node["technology"])}", "{_quote(node["description"])}")'
        )
    lines.append("}")

    for node in external_nodes:
        lines.append(
            f'System_Ext({c4_ids[node["id"]]}, "{_quote(node["label"])}", '
            f'"{_quote(node["description"])}")'
        )

    lines.append("")
    for edge in edges:
        technology = _clean_string(edge.get("technology"))
        if technology:
            lines.append(
                f'Rel({c4_ids[edge["source"]]}, {c4_ids[edge["target"]]}, '
                f'"{_quote(edge["label"])}", "{_quote(technology)}")'
            )
        else:
            lines.append(
                f'Rel({c4_ids[edge["source"]]}, {c4_ids[edge["target"]]}, '
                f'"{_quote(edge["label"])}")'
            )

    lines.append("@enduml")
    return "\n".join(lines)


def _edge(source: str, target: str, label: str, technology: str = "") -> dict[str, str]:
    return {
        "source": source,
        "target": target,
        "label": label,
        "technology": technology,
    }


def _identifier(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", value).strip("_")
    if not normalized:
        return "node"
    if normalized[0].isdigit():
        return f"node_{normalized}"
    return normalized


def _quote(value: Any) -> str:
    return _clean_string(value).replace("\\", "\\\\").replace('"', '\\"')


def _join(value: Any) -> str:
    return " / ".join(_clean_list(value))


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
