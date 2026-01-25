"""
Chainlit Middleware for LangChain v1.x Compatibility

This module provides a workaround for the incompatibility between
Chainlit's callback handler and LangChain v1.x.

The LangchainCallbackHandler no longer works because LangChain v1
restructured its callback system. This middleware uses LangChain's
new middleware architecture instead.

Usage:
    from src.middleware import ChainlitMiddlewareTracer

    # For agents with tools:
    agent = create_agent(
        model=llm,
        tools=tools,
        middleware=[ChainlitMiddlewareTracer()]
    )
"""

from collections.abc import Callable
from typing import Any

try:
    from chainlit.context import context_var
    from chainlit.step import Step
    from chainlit.utils import utc_now
except ImportError:
    # Graceful fallback if chainlit is not installed
    context_var = None
    Step = None
    utc_now = None

try:
    from langchain.agents.middleware import AgentMiddleware
    from langchain.tools.tool_node import ToolCallRequest
    from langchain_core.load.dump import dumps
    from langchain_core.messages import ToolMessage
    from langgraph.types import Command
except ImportError:
    # Graceful fallback for basic usage
    AgentMiddleware = object
    ToolCallRequest = None
    ToolMessage = None
    Command = None


class ChainlitMiddlewareTracer(AgentMiddleware if AgentMiddleware != object else object):
    """
    Middleware tracer for LangChain v1.x agents integrating with Chainlit.

    This middleware tracks tool calls and displays them as steps in the
    Chainlit UI, providing real-time visibility into agent execution.

    Features:
    - Tracks tool invocations as Chainlit Steps
    - Shows tool inputs and outputs
    - Handles errors gracefully
    - Works with LangGraph agents
    """

    def __init__(self):
        if AgentMiddleware != object:
            super().__init__()
        self.active_steps: dict[str, Step] = {}
        self.parent_step_id: str | None = None

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ):
        """
        Wrap tool calls to track them in Chainlit UI.

        Args:
            request: The tool call request
            handler: The tool execution handler

        Returns:
            The tool execution result
        """
        tool_name = request.tool_call["name"]
        tool_input = request.tool_call["args"]

        # Get parent step if in Chainlit context
        parent_step_id = None
        if context_var:
            ctx = context_var.get()
            if ctx and ctx.current_step:
                parent_step_id = ctx.current_step.id

        # Create a step for this tool call
        step = Step(name=tool_name, type="tool", parent_id=parent_step_id)
        step.start = utc_now()

        # Format the tool input
        try:
            step.input, step.language = self._process_content(tool_input)
            step.show_input = step.language or False
        except Exception:
            step.input = str(tool_input)
            step.show_input = True

        await step.send()

        # Execute the tool
        try:
            result = await handler(request)

            # Format the output
            try:
                step.output, step.language = self._process_content(result.content)
            except Exception:
                step.output = str(result)

            step.end = utc_now()
            await step.update()
            return result

        except Exception as e:
            # Mark step as error
            step.is_error = True
            step.output = str(e)
            step.end = utc_now()
            await step.update()
            raise

    def _process_content(self, content: Any) -> tuple[dict | str, str | None]:
        """
        Process content for display in Chainlit.

        Args:
            content: The content to process

        Returns:
            Tuple of (formatted content, language hint)
        """
        if content is None:
            return {}, None
        if isinstance(content, str):
            return {"content": content}, "json"
        else:
            return dumps(content), "json"
