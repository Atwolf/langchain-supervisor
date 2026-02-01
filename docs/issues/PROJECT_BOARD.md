# GitHub Project Board Specification

## Board Configuration

**Project Name**: `Enterprise Agent Framework`

**Project Type**: GitHub Projects (new) - Table/Board hybrid

**Description**: Tracking epics and features for the enterprise multiagent framework, including observability, data layer extensions, and dynamic agent management.

---

## Columns / Status Values

Configure these status values in your GitHub Project:

| Status | Description | Automation |
|--------|-------------|------------|
| **Backlog** | Not yet ready for development | Default for new issues |
| **Ready** | Requirements clear, ready to pick up | Manual move |
| **In Progress** | Actively being worked on | Auto on assignment |
| **In Review** | PR submitted, awaiting review | Auto on PR link |
| **Done** | Completed and merged | Auto on issue close |
| **Blocked** | Waiting on dependency | Manual move |

---

## Custom Fields

Add these custom fields to your project:

### Epic (Single Select)
Track which epic each issue belongs to:
- `observability` - Agent Observability Epic
- `data-layer` - Enterprise Data Layer Epic
- `control-layer` - Agent Control Layer Epic

### Priority (Single Select)
- `P0-Critical` - Blocks other work, address immediately
- `P1-High` - Important for next milestone
- `P2-Medium` - Nice to have

### Effort (Single Select)
- `S` - Small (1-2 days)
- `M` - Medium (3-5 days)
- `L` - Large (1-2 weeks)

### Phase (Single Select)
Implementation phase for ordering work:
- `Phase 1 - Foundation`
- `Phase 2 - Core Services`
- `Phase 3 - Integration`

### Sprint (Iteration)
Two-week iterations for tracking velocity.

---

## Views

Create these views in your GitHub Project:

### 1. Board View (Default)
**Layout**: Board
**Group by**: Status
**Sort by**: Priority (P0 first)
**Filter**: `is:open`

Shows Kanban-style workflow with all open issues.

### 2. By Epic
**Layout**: Table
**Group by**: Epic
**Sort by**: Phase, then Priority
**Columns**: Title, Status, Assignee, Effort, Phase

Groups issues by their parent epic for planning.

### 3. By Phase
**Layout**: Board
**Group by**: Phase
**Sort by**: Priority
**Filter**: `is:open`

Shows work organized by implementation phase.

### 4. My Items
**Layout**: Table
**Filter**: `assignee:@me`
**Sort by**: Status, then Priority
**Columns**: Title, Status, Epic, Effort

Personal view for assigned work.

### 5. Blocked Items
**Layout**: Table
**Filter**: `status:Blocked OR label:blocked`
**Sort by**: Priority
**Columns**: Title, Epic, Blocked By, Assignee

Track and resolve blockers.

### 6. Ready for Review
**Layout**: Table
**Filter**: `status:"In Review"`
**Sort by**: Updated date
**Columns**: Title, Assignee, Linked PRs

PRs awaiting code review.

---

## Automation Rules

Configure these GitHub Actions or built-in automations:

### Auto-move on Assignment
```
When: Issue assigned
Then: Move to "In Progress"
```

### Auto-move on PR Link
```
When: Pull request linked to issue
Then: Move to "In Review"
```

### Auto-close on Merge
```
When: Linked PR merged
Then: Close issue, move to "Done"
```

### Stale Issues
```
When: Issue in "In Progress" > 14 days without update
Then: Add "stale" label, post comment requesting update
```

---

## Issue Templates

Create these issue templates in `.github/ISSUE_TEMPLATE/`:

### Feature Request (`feature.yml`)
```yaml
name: Feature Request
description: Propose a new feature for the agent framework
labels: ["feature"]
body:
  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: Brief overview of the feature
    validations:
      required: true
  - type: textarea
    id: context
    attributes:
      label: Context
      description: Background and motivation
  - type: textarea
    id: solution
    attributes:
      label: Proposed Solution
      description: High-level approach
  - type: dropdown
    id: epic
    attributes:
      label: Epic
      options:
        - observability
        - data-layer
        - control-layer
        - other
  - type: dropdown
    id: effort
    attributes:
      label: Estimated Effort
      options:
        - S - Small (1-2 days)
        - M - Medium (3-5 days)
        - L - Large (1-2 weeks)
```

### Bug Report (`bug.yml`)
```yaml
name: Bug Report
description: Report a bug in the agent framework
labels: ["bug"]
body:
  - type: textarea
    id: description
    attributes:
      label: Description
      description: What happened vs what you expected
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Steps to Reproduce
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: Python version, OS, package versions
```

---

## Milestones

Create these milestones for tracking progress:

### v0.2.0 - Foundation
**Due date**: End of Phase 1
**Description**: Database schema, agent attribution, audit logging
**Issues**: #3.1, #1.1, #2.1

### v0.3.0 - Core Services
**Due date**: End of Phase 2
**Description**: FastAPI CRUD, S3 storage, token tracking
**Issues**: #3.2, #2.2, #1.2

### v0.4.0 - Dynamic Agents
**Due date**: End of Phase 3
**Description**: Lifecycle management, query layer, hot-reload
**Issues**: #3.3, #1.3, #3.4

---

## Workflow Example

1. **Planning**: Product owner triages backlog, sets Priority and Phase
2. **Sprint Planning**: Team pulls items from "Ready" to "In Progress"
3. **Development**: Developer works on feature, creates branch
4. **Review**: PR submitted, issue auto-moves to "In Review"
5. **Merge**: PR approved and merged, issue auto-closes
6. **Retrospective**: Review velocity, adjust effort estimates

---

## Access and Permissions

| Role | Permissions |
|------|-------------|
| Maintainers | Full admin access, manage project |
| Contributors | Add/edit issues, move items |
| Community | View project, comment on issues |

---

## Integration with Issues

When creating issues from this documentation:

1. Add issue to project using "Projects" sidebar
2. Set custom fields: Epic, Priority, Effort, Phase
3. Link to parent epic issue using "Tracked by" or description
4. Set milestone based on Phase

### Linking Example
In child issue description:
```markdown
Part of #1 <!-- Link to epic issue number -->

Blocked by:
- #2 <!-- Previous dependency -->
```
