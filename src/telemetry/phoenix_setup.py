"""
Arize Phoenix Observability Setup.

Initializes OpenTelemetry tracing with the Arize Phoenix exporter and
auto-instruments LangChain/LangGraph for full supervisor-to-subagent
trace visibility.

Environment Variables:
    PHOENIX_COLLECTOR_ENDPOINT: Phoenix collector URL
        (default: http://localhost:6006/v1/traces)
    PHOENIX_PROJECT_NAME: Project name in Phoenix dashboard
        (default: langchain-supervisor)
    PHOENIX_TRACING_ENABLED: Set to "false" to disable tracing
        (default: true)
"""

import os


def init_phoenix_tracing():
    """
    Initialize Arize Phoenix tracing with LangChain auto-instrumentation.

    This sets up OpenTelemetry with the Phoenix OTLP exporter and instruments
    all LangChain/LangGraph operations. When the supervisor delegates to a
    subagent via tool calls, the subagent's execution (including its own tool
    calls) appears as nested spans under the supervisor's trace.

    Returns:
        The TracerProvider if tracing is enabled, None otherwise.
    """
    enabled = os.environ.get("PHOENIX_TRACING_ENABLED", "true").lower() != "false"
    if not enabled:
        return None

    endpoint = os.environ.get(
        "PHOENIX_COLLECTOR_ENDPOINT", "http://localhost:6006/v1/traces"
    )
    project_name = os.environ.get("PHOENIX_PROJECT_NAME", "langchain-supervisor")

    from phoenix.otel import register
    from openinference.instrumentation.langchain import LangChainInstrumentor

    tracer_provider = register(
        project_name=project_name,
        endpoint=endpoint,
    )

    LangChainInstrumentor().instrument(tracer_provider=tracer_provider)

    print(f"Phoenix tracing initialized: project={project_name}, endpoint={endpoint}")
    return tracer_provider
