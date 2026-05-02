import { ArrowRight, ClipboardList } from "lucide-react"
import { useState } from "react"

export default function QaEntrypoint() {
    const [starting, setStarting] = useState(false)
    const title = props.title || "Architecture QA Wizard"
    const description =
        props.description ||
        "Collect system, component, data, messaging, and integration details into a target JSON model."

    const startWizard = async () => {
        if (starting || typeof callAction !== "function") return
        setStarting(true)
        try {
            await callAction({
                name: "qa_start",
                payload: {},
                label: "Start QA Wizard",
                icon: "clipboard-list",
            })
        } finally {
            setStarting(false)
        }
    }

    return (
        <button
            type="button"
            onClick={startWizard}
            disabled={starting}
            className="group w-full rounded-lg border border-border bg-muted/60 p-4 text-left transition hover:border-primary/60 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-wait disabled:opacity-70"
        >
            <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-background text-primary">
                    <ClipboardList className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-base font-semibold text-foreground">
                            {title}
                        </h3>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">
                            {starting ? "Starting" : "Start"}
                            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                        </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {description}
                    </p>
                </div>
            </div>
        </button>
    )
}
