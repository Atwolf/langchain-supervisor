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
            className="group w-full overflow-hidden rounded-lg border border-border bg-muted/60 p-0 text-left transition hover:border-primary/60 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-wait disabled:opacity-70"
        >
            <div className="flex min-h-[104px] items-stretch">
                <div className="flex w-14 shrink-0 items-center justify-center text-primary sm:w-16">
                    <ClipboardList className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1 py-4 pl-1 pr-4">
                    <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold text-foreground">
                            {title}
                        </h3>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {description}
                    </p>
                </div>
                <span className="flex w-[18%] min-w-[92px] max-w-[150px] shrink-0 items-center justify-center gap-1 self-stretch bg-primary px-3 text-sm font-medium text-primary-foreground">
                    {starting ? "Starting" : "Start"}
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
            </div>
        </button>
    )
}
