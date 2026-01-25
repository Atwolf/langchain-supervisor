import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Bot, Wrench } from "lucide-react"

export default function AgentCards() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {props.agents?.map((agent, idx) => (
                <Card key={idx} className="bg-card border border-border shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Bot className="h-5 w-5 text-primary" />
                            {agent.name}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {agent.description}
                        </p>
                        {agent.tools && agent.tools.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Wrench className="h-3 w-3" />
                                    <span>Tools</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {agent.tools.map((tool, toolIdx) => (
                                        <Badge
                                            key={toolIdx}
                                            variant="secondary"
                                            className="text-xs font-normal"
                                        >
                                            {tool}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
