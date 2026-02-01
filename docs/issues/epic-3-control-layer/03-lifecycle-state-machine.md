# [Feature] Agent lifecycle state machine

**Labels**: `feature`, `control-plane`, `effort-m`

**Part of**: [Epic] Agent Control Layer (#3.0)

---

## Summary

Implement a state machine for agent lifecycle management with validated transitions, ensuring agents move through draft → active → deprecated → archived states in a controlled manner.

## Context

The database schema (#3.1) includes an `agent_state` enum, but there's no enforcement of valid state transitions.

**Current State Enum** (`datalayer/database/init/10-agent-control-layer.sql`):
```sql
CREATE TYPE agent_state AS ENUM ('draft', 'active', 'deprecated', 'archived');
```

**State Meanings**:
- `draft` - Being developed, not visible to users
- `active` - Available for routing
- `deprecated` - Still works but discouraged, shows warning
- `archived` - Completely disabled, not loaded

## Problem Statement

Without a state machine:

1. **Invalid transitions** - Agents could jump from draft to archived
2. **No side effects** - State changes don't trigger necessary actions
3. **No validation** - Nothing prevents activating incomplete agents
4. **No audit trail** - State changes aren't tracked separately

## Proposed Solution

### 1. State Transition Diagram

```
                    ┌─────────────┐
                    │   DRAFT     │
                    │  (initial)  │
                    └──────┬──────┘
                           │ activate()
                           │ [validate_for_activation]
                           ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  ARCHIVED   │◀────│   ACTIVE    │────▶│ DEPRECATED  │
│  (terminal) │     │  (routing)  │     │  (warning)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
       ▲                   ▲                   │
       │                   │ reactivate()      │ archive()
       │                   └───────────────────┘
       │
       └─────── archive() (from any state)
```

### 2. State Machine Implementation

```python
# src/control_layer/state_machine.py

from enum import Enum
from typing import Callable, Dict, List, Optional, Set
from dataclasses import dataclass

from src.control_layer.models import Agent, AgentState


class TransitionError(Exception):
    """Raised when a state transition is invalid."""
    pass


class ValidationError(Exception):
    """Raised when validation fails before transition."""
    pass


@dataclass
class Transition:
    """Defines a valid state transition."""
    from_state: AgentState
    to_state: AgentState
    name: str
    validators: List[Callable[["Agent"], None]] = None
    side_effects: List[Callable[["Agent"], None]] = None

    def __post_init__(self):
        self.validators = self.validators or []
        self.side_effects = self.side_effects or []


class AgentStateMachine:
    """
    State machine for agent lifecycle management.

    Enforces valid transitions and executes side effects.
    """

    # Define all valid transitions
    TRANSITIONS: Dict[str, Transition] = {}

    @classmethod
    def _register_transition(cls, transition: Transition):
        key = f"{transition.from_state.value}:{transition.to_state.value}"
        cls.TRANSITIONS[key] = transition

    @classmethod
    def get_allowed_transitions(cls, current_state: AgentState) -> List[str]:
        """Get list of valid transition names from current state."""
        return [
            t.name for t in cls.TRANSITIONS.values()
            if t.from_state == current_state
        ]

    @classmethod
    async def transition(
        cls,
        agent: Agent,
        target_state: AgentState,
        context: Optional[dict] = None,
    ) -> Agent:
        """
        Attempt to transition agent to a new state.

        Args:
            agent: The agent to transition
            target_state: The desired target state
            context: Optional context for validators/side effects

        Returns:
            Updated agent

        Raises:
            TransitionError: If transition is not allowed
            ValidationError: If pre-transition validation fails
        """
        key = f"{agent.state.value}:{target_state.value}"
        transition = cls.TRANSITIONS.get(key)

        if not transition:
            allowed = cls.get_allowed_transitions(agent.state)
            raise TransitionError(
                f"Cannot transition from {agent.state.value} to {target_state.value}. "
                f"Allowed transitions: {allowed}"
            )

        # Run validators
        for validator in transition.validators:
            try:
                await validator(agent, context or {})
            except Exception as e:
                raise ValidationError(f"Validation failed: {e}") from e

        # Store previous state for side effects
        previous_state = agent.state

        # Update state
        agent.state = target_state

        # Run side effects (don't fail on side effect errors, just log)
        for side_effect in transition.side_effects:
            try:
                await side_effect(agent, previous_state, context or {})
            except Exception as e:
                # Log but don't fail - state already changed
                import logging
                logging.error(f"Side effect failed: {e}")

        return agent


# ========== Validators ==========

async def validate_has_routing(agent: Agent, context: dict):
    """Validate agent has routing description."""
    if not agent.route_description or len(agent.route_description.strip()) < 10:
        raise ValidationError(
            "Agent must have a meaningful route_description (min 10 chars)"
        )


async def validate_has_tools_or_mcps(agent: Agent, context: dict):
    """Validate agent has at least one tool or MCP."""
    if not agent.tools and not agent.mcps:
        raise ValidationError(
            "Agent must have at least one tool or MCP server configured"
        )


async def validate_mcps_healthy(agent: Agent, context: dict):
    """Validate all MCPs are reachable."""
    for agent_mcp in agent.mcps:
        mcp = agent_mcp.mcp
        if mcp.health_check_url:
            # TODO: Actually check health endpoint
            pass


async def validate_not_in_use(agent: Agent, context: dict):
    """Validate agent isn't actively handling requests."""
    # Check if there are recent active sessions using this agent
    # This would query steps table for recent activity
    pass


# ========== Side Effects ==========

async def notify_loader_of_activation(agent: Agent, prev_state: AgentState, context: dict):
    """Notify the dynamic loader that an agent was activated."""
    from src.control_layer.events import publish_event
    await publish_event("agent.activated", {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
    })


async def notify_loader_of_deactivation(agent: Agent, prev_state: AgentState, context: dict):
    """Notify the dynamic loader that an agent was deactivated."""
    from src.control_layer.events import publish_event
    await publish_event("agent.deactivated", {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
    })


async def log_deprecation_warning(agent: Agent, prev_state: AgentState, context: dict):
    """Log warning when agent is deprecated."""
    import logging
    logging.warning(
        f"Agent '{agent.name}' has been deprecated. "
        f"Consider migrating to an alternative."
    )


async def cleanup_agent_resources(agent: Agent, prev_state: AgentState, context: dict):
    """Clean up resources when agent is archived."""
    # Disconnect MCP servers
    # Clear caches
    # etc.
    pass


# ========== Register Transitions ==========

# DRAFT -> ACTIVE
AgentStateMachine._register_transition(Transition(
    from_state=AgentState.DRAFT,
    to_state=AgentState.ACTIVE,
    name="activate",
    validators=[
        validate_has_routing,
        validate_has_tools_or_mcps,
        validate_mcps_healthy,
    ],
    side_effects=[
        notify_loader_of_activation,
    ],
))

# ACTIVE -> DEPRECATED
AgentStateMachine._register_transition(Transition(
    from_state=AgentState.ACTIVE,
    to_state=AgentState.DEPRECATED,
    name="deprecate",
    validators=[],
    side_effects=[
        log_deprecation_warning,
    ],
))

# DEPRECATED -> ACTIVE (reactivate)
AgentStateMachine._register_transition(Transition(
    from_state=AgentState.DEPRECATED,
    to_state=AgentState.ACTIVE,
    name="reactivate",
    validators=[
        validate_has_routing,
        validate_has_tools_or_mcps,
    ],
    side_effects=[
        notify_loader_of_activation,
    ],
))

# DEPRECATED -> ARCHIVED
AgentStateMachine._register_transition(Transition(
    from_state=AgentState.DEPRECATED,
    to_state=AgentState.ARCHIVED,
    name="archive",
    validators=[],
    side_effects=[
        notify_loader_of_deactivation,
        cleanup_agent_resources,
    ],
))

# ACTIVE -> ARCHIVED (emergency)
AgentStateMachine._register_transition(Transition(
    from_state=AgentState.ACTIVE,
    to_state=AgentState.ARCHIVED,
    name="emergency_archive",
    validators=[],
    side_effects=[
        notify_loader_of_deactivation,
        cleanup_agent_resources,
    ],
))

# DRAFT -> ARCHIVED (abandon)
AgentStateMachine._register_transition(Transition(
    from_state=AgentState.DRAFT,
    to_state=AgentState.ARCHIVED,
    name="abandon",
    validators=[],
    side_effects=[
        cleanup_agent_resources,
    ],
))
```

### 3. Integrate with CRUD

```python
# src/control_layer/crud.py (updated)

from src.control_layer.state_machine import AgentStateMachine, TransitionError, ValidationError

async def update_agent_state(
    db: AsyncSession,
    agent_id: UUID,
    new_state: AgentState,
    change_reason: Optional[str] = None,
) -> models.Agent:
    """
    Update agent state using state machine.

    Args:
        agent_id: ID of agent to update
        new_state: Target state
        change_reason: Reason for state change (for audit)

    Returns:
        Updated agent

    Raises:
        TransitionError: If transition not allowed
        ValidationError: If validation fails
    """
    agent = await get_agent(db, agent_id)
    if not agent:
        raise ValueError("Agent not found")

    # Use state machine for transition
    agent = await AgentStateMachine.transition(
        agent,
        new_state,
        context={"db": db, "change_reason": change_reason},
    )

    # Create version record
    await create_state_change_version(db, agent, new_state, change_reason)

    await db.commit()
    await db.refresh(agent)
    return agent


async def create_state_change_version(
    db: AsyncSession,
    agent: models.Agent,
    new_state: AgentState,
    reason: Optional[str],
):
    """Create version record specifically for state changes."""
    version = models.AgentVersion(
        agent_id=agent.id,
        version=agent.version,
        snapshot={"state_change": True, "new_state": new_state.value},
        change_reason=reason or f"State changed to {new_state.value}",
        changed_by=None,  # TODO: Get from auth context
    )
    db.add(version)
    agent.version += 1
```

### 4. API Endpoint for State Changes

```python
# src/control_layer/routes/agents.py (add endpoint)

@router.post("/{agent_id}/state")
async def change_agent_state(
    agent_id: UUID,
    new_state: schemas.AgentState,
    reason: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Change agent lifecycle state.

    Valid transitions:
    - draft → active (requires validation)
    - active → deprecated
    - deprecated → active (reactivate)
    - deprecated → archived
    - active → archived (emergency)
    - draft → archived (abandon)
    """
    try:
        agent = await crud.update_agent_state(db, agent_id, new_state, reason)
        return agent
    except TransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/{agent_id}/allowed-transitions")
async def get_allowed_transitions(
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get list of allowed state transitions for an agent."""
    agent = await crud.get_agent(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    transitions = AgentStateMachine.get_allowed_transitions(agent.state)
    return {"currentState": agent.state.value, "allowedTransitions": transitions}
```

### 5. Event System for Side Effects

```python
# src/control_layer/events.py

import asyncio
from typing import Callable, Dict, List

# Simple in-memory event bus (replace with Redis/Kafka in production)
_subscribers: Dict[str, List[Callable]] = {}


def subscribe(event_type: str, handler: Callable):
    """Subscribe to an event type."""
    if event_type not in _subscribers:
        _subscribers[event_type] = []
    _subscribers[event_type].append(handler)


async def publish_event(event_type: str, data: dict):
    """Publish an event to all subscribers."""
    handlers = _subscribers.get(event_type, [])
    for handler in handlers:
        try:
            if asyncio.iscoroutinefunction(handler):
                await handler(data)
            else:
                handler(data)
        except Exception as e:
            import logging
            logging.error(f"Event handler error for {event_type}: {e}")
```

## Technical Details

### Files to Create/Modify

| File | Description |
|------|-------------|
| `src/control_layer/state_machine.py` | State machine implementation |
| `src/control_layer/events.py` | Event system for side effects |
| `src/control_layer/crud.py` | Add state change methods |
| `src/control_layer/routes/agents.py` | Add state endpoints |

### Valid Transition Matrix

| From \ To | draft | active | deprecated | archived |
|-----------|-------|--------|------------|----------|
| draft     | -     | ✓      | -          | ✓        |
| active    | -     | -      | ✓          | ✓        |
| deprecated| -     | ✓      | -          | ✓        |
| archived  | -     | -      | -          | -        |

### Validation Requirements by Transition

| Transition | Validations |
|------------|-------------|
| draft → active | route_description, tools/MCPs, MCP health |
| * → archived | none (always allowed) |
| deprecated → active | route_description, tools/MCPs |

## Acceptance Criteria

- [ ] State machine enforces valid transitions
- [ ] Invalid transitions raise clear errors
- [ ] Validators run before state change
- [ ] Side effects execute after state change
- [ ] State changes create version records
- [ ] API endpoint for state changes
- [ ] API endpoint for allowed transitions
- [ ] Unit tests for all transitions
- [ ] Integration tests for full workflow

## Testing Strategy

### Unit Tests
```python
async def test_draft_to_active_requires_tools():
    agent = Agent(state=AgentState.DRAFT, tools=[], mcps=[])
    with pytest.raises(ValidationError, match="tool or MCP"):
        await AgentStateMachine.transition(agent, AgentState.ACTIVE)

async def test_cannot_go_from_archived():
    agent = Agent(state=AgentState.ARCHIVED)
    with pytest.raises(TransitionError):
        await AgentStateMachine.transition(agent, AgentState.ACTIVE)

async def test_side_effects_called():
    side_effect_called = False
    async def mock_side_effect(*args):
        nonlocal side_effect_called
        side_effect_called = True

    # Temporarily add side effect
    agent = Agent(state=AgentState.ACTIVE)
    await AgentStateMachine.transition(agent, AgentState.DEPRECATED)
    # Verify side effect was called
```

### Integration Tests
- Full lifecycle: draft → active → deprecated → archived
- Verify version history contains state changes
- Verify events published

## Dependencies

- Blocked by: #3.1 Database Schema, #3.2 FastAPI CRUD
- Blocks: #3.4 Dynamic Loader (needs activation events)

## Out of Scope

- Scheduled state changes (e.g., auto-deprecate after X days)
- Approval workflows for activation
- State change notifications (email, Slack)
- Rollback on side effect failure
