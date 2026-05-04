import { Braces, Code2, Network, RefreshCw } from "lucide-react"
import { useMemo, useState } from "react"

const TABS = [
    { id: "diagram", label: "Diagram", icon: Network },
    { id: "json", label: "JSON", icon: Braces },
    { id: "code", label: "C4 Code", icon: Code2 },
]

const ACTION_ICONS = {
    braces: Braces,
    network: Network,
    "refresh-cw": RefreshCw,
}

const NODE_STYLE = {
    person: {
        fill: "#eef2ff",
        stroke: "#6366f1",
        eyebrow: "Person",
    },
    container: {
        fill: "#e0f2fe",
        stroke: "#0284c7",
        eyebrow: "Container",
    },
    database: {
        fill: "#ecfdf5",
        stroke: "#059669",
        eyebrow: "Database",
    },
    queue: {
        fill: "#fff7ed",
        stroke: "#ea580c",
        eyebrow: "Queue",
    },
    external: {
        fill: "#f8fafc",
        stroke: "#64748b",
        eyebrow: "External System",
    },
}

const truncate = (value, limit) => {
    const text = String(value || "").trim()
    return text.length > limit ? `${text.slice(0, limit - 1)}...` : text
}

const wrap = (value, limit = 28, maxLines = 2) => {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean)
    const lines = []
    let current = ""

    words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word
        if (candidate.length > limit && current) {
            lines.push(current)
            current = word
        } else {
            current = candidate
        }
    })
    if (current) lines.push(current)

    const clipped = lines.slice(0, maxLines)
    if (lines.length > maxLines) {
        clipped[maxLines - 1] = truncate(clipped[maxLines - 1], limit)
    }
    return clipped.length ? clipped : [""]
}

const positionRows = (nodes, x, top, gap) =>
    nodes.reduce((positions, node, index) => {
        positions[node.id] = { x, y: top + index * gap }
        return positions
    }, {})

const layoutDiagram = (diagram) => {
    const nodes = diagram?.nodes || []
    const people = nodes.filter((node) => node.group === "people")
    const systemNodes = nodes.filter((node) => node.group === "system")
    const external = nodes.filter((node) => node.group === "external")
    const rows = Math.max(people.length, systemNodes.length, external.length, 3)
    const height = Math.max(420, rows * 108 + 120)

    return {
        width: 1080,
        height,
        nodeWidth: 230,
        nodeHeight: 78,
        boundary: {
            x: 300,
            y: 46,
            width: 420,
            height: height - 92,
        },
        positions: {
            ...positionRows(people, 36, 96, 112),
            ...positionRows(systemNodes, 395, 96, 112),
            ...positionRows(external, 812, 96, 112),
        },
    }
}

const edgeAnchors = (source, target, layout) => {
    const nodeWidth = layout.nodeWidth
    const nodeHeight = layout.nodeHeight
    const sourceRight = source.x <= target.x

    return {
        sx: source.x + (sourceRight ? nodeWidth : 0),
        sy: source.y + nodeHeight / 2,
        tx: target.x + (sourceRight ? 0 : nodeWidth),
        ty: target.y + nodeHeight / 2,
    }
}

const Node = ({ node, position, layout }) => {
    const style = NODE_STYLE[node.kind] || NODE_STYLE.container
    const labelLines = wrap(node.label, 25, 2)
    const technology = truncate(node.technology, 34)
    const description = truncate(node.description, 40)

    return (
        <g transform={`translate(${position.x}, ${position.y})`}>
            <rect
                width={layout.nodeWidth}
                height={layout.nodeHeight}
                rx="8"
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth="1.5"
                strokeDasharray={node.kind === "external" ? "6 4" : undefined}
            />
            <text x="14" y="18" fill={style.stroke} fontSize="10" fontWeight="700">
                {style.eyebrow}
            </text>
            <text x="14" y="38" fill="#0f172a" fontSize="14" fontWeight="700">
                {labelLines.map((line, index) => (
                    <tspan key={line || index} x="14" dy={index === 0 ? 0 : 16}>
                        {line}
                    </tspan>
                ))}
            </text>
            {technology && (
                <text x="14" y="62" fill="#334155" fontSize="10">
                    {technology}
                </text>
            )}
            {!technology && description && (
                <text x="14" y="62" fill="#475569" fontSize="10">
                    {description}
                </text>
            )}
        </g>
    )
}

const Edge = ({ edge, index, layout }) => {
    const source = layout.positions[edge.source]
    const target = layout.positions[edge.target]
    if (!source || !target) return null

    const { sx, sy, tx, ty } = edgeAnchors(source, target, layout)
    const curve = Math.max(56, Math.abs(tx - sx) * 0.35)
    const labelX = (sx + tx) / 2
    const labelY = (sy + ty) / 2 - 8 + ((index % 3) - 1) * 12
    const label = edge.technology ? `${edge.label}: ${edge.technology}` : edge.label

    return (
        <g>
            <path
                d={`M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`}
                fill="none"
                stroke="#475569"
                strokeWidth="1.4"
                markerEnd="url(#arrowhead)"
            />
            <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fill="#334155"
                fontSize="10"
                paintOrder="stroke"
                stroke="#ffffff"
                strokeWidth="4"
                strokeLinejoin="round"
            >
                {truncate(label, 42)}
            </text>
        </g>
    )
}

const EmptyDiagram = () => (
    <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        No C4 nodes are available for this model.
    </div>
)

const DiagramView = ({ artifact }) => {
    const diagram = artifact?.diagram || { nodes: [], edges: [] }
    const nodes = diagram.nodes || []
    const layout = useMemo(() => layoutDiagram(diagram), [diagram])

    if (!nodes.length) return <EmptyDiagram />

    return (
        <div className="overflow-auto rounded-md border border-border bg-white">
            <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="min-h-[380px] w-full min-w-[760px]"
                role="img"
                aria-label={artifact?.title || "C4 container diagram"}
            >
                <defs>
                    <marker
                        id="arrowhead"
                        markerWidth="10"
                        markerHeight="10"
                        refX="9"
                        refY="3"
                        orient="auto"
                        markerUnits="strokeWidth"
                    >
                        <path d="M 0 0 L 9 3 L 0 6 z" fill="#475569" />
                    </marker>
                </defs>

                <rect width={layout.width} height={layout.height} fill="#ffffff" />
                <rect
                    x={layout.boundary.x}
                    y={layout.boundary.y}
                    width={layout.boundary.width}
                    height={layout.boundary.height}
                    rx="12"
                    fill="#f8fafc"
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                    strokeDasharray="8 5"
                />
                <text
                    x={layout.boundary.x + 16}
                    y={layout.boundary.y + 26}
                    fill="#0f172a"
                    fontSize="15"
                    fontWeight="700"
                >
                    {artifact?.systemName || diagram?.boundary?.label || "System"}
                </text>

                {(diagram.edges || []).map((edge, index) => (
                    <Edge key={`${edge.source}-${edge.target}-${index}`} edge={edge} index={index} layout={layout} />
                ))}

                {nodes.map((node) => (
                    <Node key={node.id} node={node} position={layout.positions[node.id]} layout={layout} />
                ))}
            </svg>
        </div>
    )
}

const CodeBlock = ({ value }) => (
    <pre className="max-h-[560px] overflow-auto rounded-md border border-border bg-muted p-3 text-[11px] leading-relaxed text-foreground">
        {value}
    </pre>
)

const ResultActions = ({ actions }) => {
    const [busyAction, setBusyAction] = useState(null)

    const runAction = async (action) => {
        if (busyAction || typeof callAction !== "function") return
        setBusyAction(action.name)
        try {
            await callAction({
                name: action.name,
                payload: {},
                label: action.label,
                icon: action.icon,
            })
        } finally {
            setBusyAction(null)
        }
    }

    return (
        <div className="flex flex-wrap gap-2">
            {(actions || []).map((action) => {
                const Icon = ACTION_ICONS[action.icon] || Braces
                const isBusy = busyAction === action.name
                return (
                    <button
                        key={action.name}
                        type="button"
                        onClick={() => runAction(action)}
                        disabled={Boolean(busyAction)}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-wait disabled:opacity-60"
                    >
                        <Icon className="h-4 w-4" />
                        {isBusy ? "Working" : action.label}
                    </button>
                )
            })}
        </div>
    )
}

export default function QaModelResult() {
    const [activeTab, setActiveTab] = useState("diagram")
    const artifact = props.artifact || {}
    const json = props.json || JSON.stringify(props.model || {}, null, 2)
    const c4Code = artifact.c4Code || props.c4Code || ""
    const title = props.title || artifact.title || "Architecture QA Result"

    return (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="text-base font-semibold text-foreground">{title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {artifact.stats?.nodes || 0} nodes / {artifact.stats?.relationships || 0} relationships
                    </p>
                </div>
                <ResultActions actions={props.actions || []} />
            </div>

            <div className="flex flex-wrap gap-1 border-b border-border">
                {TABS.map((tab) => {
                    const Icon = tab.icon
                    const selected = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition ${
                                selected
                                    ? "border-primary text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    )
                })}
            </div>

            {activeTab === "diagram" && <DiagramView artifact={artifact} />}
            {activeTab === "json" && <CodeBlock value={json} />}
            {activeTab === "code" && <CodeBlock value={c4Code} />}
        </div>
    )
}
