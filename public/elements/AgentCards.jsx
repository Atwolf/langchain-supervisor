import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Bot, Calculator, CloudSun, Film } from "lucide-react"

const iconMap = {
    "calculator": Calculator,
    "cloud-sun": CloudSun,
    "film": Film,
}

export default function AgentCards() {
    return (
        <div className="flex flex-col gap-2 p-2">
            {props.agents?.map((agent, idx) => {
                const IconComponent = iconMap[agent.icon] || Bot
                return (
                    <Card key={idx} className="bg-card border border-border shadow-sm">
                        <CardHeader className="p-2 pb-1">
                            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                                <IconComponent className="h-4 w-4 text-foreground" />
                                {agent.name}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-2 pt-0">
                            <p className="text-xs text-muted-foreground leading-tight">
                                {agent.description}
                            </p>
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
