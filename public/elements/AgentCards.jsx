import { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Bot, Calculator, CloudSun, Film, ChevronDown, ChevronUp, Wrench, HelpCircle, Sparkles } from "lucide-react"

const iconMap = {
    "calculator": Calculator,
    "cloud-sun": CloudSun,
    "film": Film,
    "help": HelpCircle,
}

const sendMessage = (message) => {
    // Use Chainlit's global sendUserMessage API for custom elements
    if (typeof sendUserMessage === "function") {
        sendUserMessage(message)
    }
}

export default function AgentCards() {
    const [expandedIndex, setExpandedIndex] = useState(null)

    const toggleExpanded = (idx) => {
        setExpandedIndex(expandedIndex === idx ? null : idx)
    }

    return (
        <div className="flex flex-col gap-2 p-2">
            {/* Welcome Message */}
            <p className="text-xs text-muted-foreground leading-tight mb-1">
                Welcome to the new and enhanced chatbot. This chatbot leverages multiple agents, selected intelligently to answer your question.
            </p>

            {/* Agent Cards */}
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
                                        className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-muted transition-colors self-center"
                                        aria-label={isExpanded ? "Collapse details" : "Expand details"}
                                    >
                                        <span className="text-xs text-muted-foreground">Info</span>
                                        {isExpanded ? (
                                            <ChevronUp className="h-3 w-3 text-muted-foreground relative top-[1px]" />
                                        ) : (
                                            <ChevronDown className="h-3 w-3 text-muted-foreground relative top-[1px]" />
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

            {/* Starter Prompts */}
            {props.starters && props.starters.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-2">
                    <h3 className="text-sm font-medium text-foreground">
                        Try these prompts:
                    </h3>
                    <div className="grid grid-cols-2 gap-1.5">
                        {props.starters.map((starter, idx) => {
                            const StarterIcon = iconMap[starter.icon] || Sparkles
                            return (
                                <button
                                    key={idx}
                                    onClick={() => sendMessage(starter.message)}
                                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-left rounded-md border border-border bg-background hover:bg-muted transition-colors"
                                >
                                    <StarterIcon className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    <span className="truncate">{starter.label}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
