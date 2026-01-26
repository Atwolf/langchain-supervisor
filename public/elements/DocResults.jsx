import { Card, CardContent } from "@/components/ui/card"
import { FileText, ExternalLink } from "lucide-react"

export default function DocResults() {
    const documents = props.documents || []

    if (documents.length === 0) {
        return (
            <p className="text-xs text-muted-foreground">No documents found.</p>
        )
    }

    return (
        <div className="flex flex-col gap-2 p-2">
            <h4 className="text-xs font-medium text-muted-foreground">
                Sources ({documents.length})
            </h4>
            {documents.map((doc, idx) => (
                <Card key={idx} className="bg-muted/50 border border-border">
                    <CardContent className="p-2">
                        <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">
                                    {doc.page_name || "Untitled"}
                                </p>
                                {doc.page_snippet && (
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                        {doc.page_snippet}
                                    </p>
                                )}
                                {doc.page_url && (
                                    <a
                                        href={doc.page_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                                    >
                                        View source
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
