import { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Bot, Calculator, CloudSun, Film, ChevronDown, ChevronUp, Wrench } from "lucide-react"

const iconMap = {
    "calculator": Calculator,
    "cloud-sun": CloudSun,
    "film": Film,
}

export default function AgentCards() {
    const [expandedIndex, setExpandedIndex] = useState(null)

    const toggleExpanded = (idx) => {
        setExpandedIndex(expandedIndex === idx ? null : idx)
    }

    return (
        <div className="flex flex-col gap-2 p-2">
            {props.agents?.map((agent, idx) => {
                const IconComponent = iconMap[agent.icon] || Bot
                const isExpanded = expandedIndex === idx
                const hasTools = agent.tools && agent.tools.length > 0

                return (
                    <Card key={idx} className="bg-card border border-border shadow-sm">
                        <CardHeader className="p-2 pb-1">
                            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                                <IconComponent className="h-4 w-4 text-foreground" />
                                <span className="flex-1">{agent.name}</span>
                                {hasTools && (
                                    <button
                                        onClick={() => toggleExpanded(idx)}
                                        className="flex items-center gap-1 p-0.5 rounded hover:bg-muted transition-colors self-center"
                                        aria-label={isExpanded ? "Collapse tools" : "Expand tools"}
                                    >
                                        <span className="text-xs text-muted-foreground">info</span>
                                        {isExpanded ? (
                                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                        )}
                                    </button>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-2 pt-0">
                            <p className="text-xs text-muted-foreground leading-tight">
                                {agent.description}
                            </p>
                            {isExpanded && hasTools && (
                                <div className="mt-2 pt-2 border-t border-border">
                                    <div className="flex flex-col gap-1.5">
                                        {agent.tools.map((tool, toolIdx) => (
                                            <div key={toolIdx} className="flex items-center gap-1">
                                                <Wrench className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-xs font-medium text-foreground">
                                                        {tool.name}
                                                    </span>
                                                    {tool.description && (
                                                        <p className="text-xs text-muted-foreground leading-tight">
                                                            {tool.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )
            })}
            <p className="text-xs text-muted-foreground text-center pt-1">
                Your query will be automatically routed to the right agent.
            </p>
        </div>
    )
}
