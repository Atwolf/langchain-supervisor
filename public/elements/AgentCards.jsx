import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Bot } from "lucide-react"

export default function AgentCards() {
    return (
        <div className="flex flex-col gap-2 p-2">
            <p className="text-xs text-muted-foreground text-center">
                Your query will be automatically routed to the right agent.
            </p>
            {props.agents?.map((agent, idx) => (
                <Card key={idx} className="bg-card border border-border shadow-sm">
                    <CardHeader className="p-2 pb-1">
                        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                            <Bot className="h-4 w-4 text-primary" />
                            {agent.name}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-2 pt-0">
                        <p className="text-xs text-muted-foreground leading-tight">
                            {agent.description}
                        </p>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
